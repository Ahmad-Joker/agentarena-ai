import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, RunStatus } from "@prisma/client";
import { assertTransition, deriveBenchmarkStatus } from "@/lib/domain/run-state";
import { safeRelativePath, testCaseSchema, type Profile, type StarterFile, type Weights } from "@/lib/domain/schemas";
import { HarnessRouterError, describeError } from "@/lib/harnessrouter/errors";
import type { AgentStreamEvent } from "@/lib/harnessrouter/types";
import type { AgentAdapter, AgentRunResult } from "@/lib/agents/types";
import { evaluateBenchmark, rankOutcomes } from "@/lib/evaluation/engine";
import type { Sandbox } from "@/lib/evaluation/sandbox";
import { redactDeep, redactString, truncate } from "@/lib/security/redact";
import { Semaphore } from "./semaphore";
import { z } from "zod";

class RunTimeoutError extends Error {
  constructor() {
    super("Run exceeded the benchmark time limit");
    this.name = "RunTimeoutError";
  }
}
class RunCancelledError extends Error {
  constructor() {
    super("Run cancelled by user");
    this.name = "RunCancelledError";
  }
}

export interface OrchestratorDeps {
  prisma: PrismaClient;
  adapterFor: (provider: "SIMULATED" | "HARNESSROUTER") => AgentAdapter;
  sandbox: Sandbox;
  /** Process-wide cap across all benchmarks (MAX_CONCURRENT_RUNS). */
  globalLimit: number;
  /** Fixture key lookup for demo tasks (by task content hash). */
  fixtureKeyFor?: (contentHash: string) => string | undefined;
  /** Secrets to scrub from anything persisted. */
  secrets?: string[];
  maxRetries?: number;
  log?: (msg: string, err?: unknown) => void;
}

const MAX_ARTIFACT_BYTES = 200_000;
const DELTA_FLUSH_MS = 500;

/**
 * Runs benchmarks: launches one independent run per agent, enforces concurrency and
 * timeouts, records events, collects results, then evaluates and ranks.
 * State lives in Postgres; this class only holds in-flight AbortControllers.
 */
export class BenchmarkOrchestrator {
  private readonly global: Semaphore;
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelledBenchmarks = new Set<string>();
  private readonly active = new Set<string>();
  /** Only runs created before this instance existed can have been orphaned by a previous process. */
  private readonly createdAt = new Date();

  constructor(private readonly deps: OrchestratorDeps) {
    this.global = new Semaphore(deps.globalLimit);
  }

  isActive(benchmarkId: string): boolean {
    return this.active.has(benchmarkId);
  }

  /** Starts a PENDING benchmark. Resolves when all runs and evaluation have finished. */
  async start(benchmarkId: string): Promise<void> {
    const { prisma } = this.deps;
    const claimed = await prisma.benchmark.updateMany({
      where: { id: benchmarkId, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Benchmark is not pending (already started or finished)");
    this.active.add(benchmarkId);
    try {
      const bench = await prisma.benchmark.findUniqueOrThrow({
        where: { id: benchmarkId },
        include: { task: true, runs: { include: { agent: true } } },
      });
      const local = new Semaphore(bench.maxConcurrency);
      await Promise.allSettled(bench.runs.map((run) => this.executeRun(bench, run, local)));
      await this.evaluate(benchmarkId);
    } catch (err) {
      this.deps.log?.(`Benchmark ${benchmarkId} orchestration error`, err);
    } finally {
      await this.finalizeBenchmark(benchmarkId).catch((err) => this.deps.log?.("finalize failed", err));
      this.active.delete(benchmarkId);
      this.cancelledBenchmarks.delete(benchmarkId);
    }
  }

  async cancelBenchmark(benchmarkId: string): Promise<void> {
    this.cancelledBenchmarks.add(benchmarkId);
    const runs = await this.deps.prisma.agentRun.findMany({ where: { benchmarkId }, select: { id: true } });
    await Promise.all(runs.map((r) => this.cancelRun(r.id)));
    if (!this.active.has(benchmarkId)) await this.finalizeBenchmark(benchmarkId, true);
  }

  async cancelRun(runId: string): Promise<void> {
    const ctrl = this.controllers.get(runId);
    if (ctrl) {
      ctrl.abort(new RunCancelledError());
      return;
    }
    // Not started yet (waiting for a slot) or orphaned: cancel directly if still pending.
    await this.deps.prisma.agentRun.updateMany({
      where: { id: runId, status: "PENDING" },
      data: { status: "CANCELLED", endedAt: new Date(), errorCode: "cancelled", errorMessage: "Cancelled before start" },
    });
  }

  /** Marks runs left RUNNING/PENDING by a previous process as failed (server restart). */
  async reconcileInterrupted(): Promise<number> {
    const { prisma } = this.deps;
    const stale = await prisma.agentRun.findMany({
      where: {
        status: { in: ["PENDING", "RUNNING"] },
        createdAt: { lt: this.createdAt },
        benchmark: { status: { in: ["PENDING", "RUNNING"] } },
      },
      select: { id: true, benchmarkId: true, status: true },
    });
    const orphaned = stale.filter((r) => !this.active.has(r.benchmarkId));
    for (const run of orphaned) {
      await prisma.agentRun.updateMany({
        where: { id: run.id, status: run.status },
        data: {
          status: run.status === "PENDING" ? "CANCELLED" : "FAILED",
          endedAt: new Date(),
          errorCode: "interrupted",
          errorMessage: "The server restarted while this run was in progress. Provider-side work may still have completed.",
        },
      });
    }
    for (const id of new Set(orphaned.map((r) => r.benchmarkId))) await this.finalizeBenchmark(id);
    return orphaned.length;
  }

  private async executeRun(
    bench: Prisma.BenchmarkGetPayload<{ include: { task: true; runs: { include: { agent: true } } } }>,
    run: Prisma.AgentRunGetPayload<{ include: { agent: true } }>,
    local: Semaphore,
  ): Promise<void> {
    const { prisma } = this.deps;
    const ctrl = new AbortController();
    this.controllers.set(run.id, ctrl);
    let releaseLocal: (() => void) | undefined;
    let releaseGlobal: (() => void) | undefined;
    let seq = await prisma.executionEvent.count({ where: { runId: run.id } });
    const record = async (kind: string, type: string, message: string, payload?: Prisma.InputJsonValue) => {
      await prisma.executionEvent.create({
        data: { runId: run.id, sequence: seq++, kind, type, message: truncate(redactString(message, this.deps.secrets), 2_000), payload },
      });
    };

    try {
      releaseLocal = await local.acquire(ctrl.signal);
      releaseGlobal = await this.global.acquire(ctrl.signal);
    } catch {
      releaseLocal?.();
      this.controllers.delete(run.id);
      await this.transition(run.id, "PENDING", "CANCELLED", { errorCode: "cancelled", errorMessage: "Cancelled before start" });
      return;
    }

    const startedAt = new Date();
    const moved = await this.transition(run.id, "PENDING", "RUNNING", { startedAt });
    if (!moved) {
      releaseLocal();
      releaseGlobal();
      this.controllers.delete(run.id);
      return;
    }
    await record("lifecycle", "run.started", `Run started (${run.agent.provider === "SIMULATED" ? "simulated agent" : "HarnessRouter"})`);

    const timer = setTimeout(() => ctrl.abort(new RunTimeoutError()), bench.timeoutSeconds * 1000);
    let deltaBuffer = "";
    let lastFlush = Date.now();
    const flushDelta = async (force = false) => {
      if (!deltaBuffer || (!force && Date.now() - lastFlush < DELTA_FLUSH_MS)) return;
      const text = deltaBuffer;
      deltaBuffer = "";
      lastFlush = Date.now();
      await record("output", "response.output_text.delta", text);
    };

    const onEvent = async (ev: AgentStreamEvent) => {
      switch (ev.kind) {
        case "created":
          await prisma.agentRun.update({ where: { id: run.id }, data: { externalResponseId: ev.responseId, externalSessionId: ev.sessionId ?? null } });
          await record("lifecycle", ev.raw, "Task accepted by provider", { responseId: ev.responseId, sessionId: ev.sessionId ?? null });
          break;
        case "progress":
          await record("progress", ev.raw, ev.message);
          break;
        case "tool":
          await record("tool", ev.raw, `Tool call: ${ev.name}`);
          break;
        case "text_delta":
          deltaBuffer += ev.delta;
          await flushDelta();
          break;
        case "terminal":
          await flushDelta(true);
          await record("status", ev.raw, `Provider reported ${ev.status}${ev.reason ? ` (${ev.reason})` : ""}`);
          break;
      }
    };

    const maxRetries = this.deps.maxRetries ?? 1;
    let result: AgentRunResult | undefined;
    let failure: { status: RunStatus; code: string; message: string } | undefined;
    const adapter = this.deps.adapterFor(run.agent.provider);
    const fixtureKey = this.deps.fixtureKeyFor?.(bench.task.contentHash);
    const starterFiles = z.array(z.object({ path: z.string(), content: z.string() })).parse(bench.task.starterFiles) as StarterFile[];

    for (let attempt = 1; attempt <= maxRetries + 1 && !result && !failure; attempt++) {
      try {
        result = await adapter.run({
          idempotencyKey: run.idempotencyKey,
          agent: {
            id: run.agent.id,
            name: run.agent.name,
            provider: run.agent.provider,
            harnessId: run.agent.harnessId,
            model: run.agent.model,
            simKey: simKeyOf(run.agent.runtimeNotes),
          },
          task: { language: bench.task.language, entryFile: bench.task.entryFile, entryFunction: bench.task.entryFunction, fixtureKey },
          prompt: bench.promptSnapshot,
          starterFiles,
          timeoutSeconds: bench.timeoutSeconds,
          maxCostUsd: bench.maxCostUsd ?? undefined,
          signal: ctrl.signal,
          onEvent,
        });
      } catch (err) {
        const reason: unknown = ctrl.signal.aborted ? ctrl.signal.reason : err;
        if (reason instanceof RunTimeoutError) failure = { status: "TIMED_OUT", code: "timeout", message: reason.message };
        else if (reason instanceof RunCancelledError) failure = { status: "CANCELLED", code: "cancelled", message: reason.message };
        else if (reason instanceof HarnessRouterError) {
          const startedUpstream = (await prisma.agentRun.findUnique({ where: { id: run.id }, select: { externalResponseId: true } }))?.externalResponseId;
          // Same Idempotency-Key ⇒ a retry can never double-execute; still, only retry before the task was accepted.
          if (reason.retryable && !startedUpstream && attempt <= maxRetries) {
            await record("system", "retry", `Retrying after ${reason.code} (attempt ${attempt + 1}, same idempotency key)`);
            await prisma.agentRun.update({ where: { id: run.id }, data: { attempt: attempt + 1 } });
            await new Promise((r) => setTimeout(r, 1_000 * attempt));
            continue;
          }
          failure = { status: "FAILED", code: reason.code, message: describeError(reason) };
        } else {
          this.deps.log?.(`Run ${run.id} failed unexpectedly`, err);
          failure = { status: "FAILED", code: "internal_error", message: redactString(err instanceof Error ? err.message : String(err), this.deps.secrets).slice(0, 300) };
        }
      }
    }
    clearTimeout(timer);
    await flushDelta(true).catch(() => undefined);
    releaseLocal();
    releaseGlobal();
    this.controllers.delete(run.id);

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    if (failure || !result) {
      const f = failure ?? { status: "FAILED" as RunStatus, code: "no_result", message: "Adapter returned no result" };
      await record(f.status === "CANCELLED" ? "lifecycle" : "error", `run.${f.status.toLowerCase()}`, f.message);
      await this.transition(run.id, "RUNNING", f.status, { endedAt, durationMs, errorCode: f.code, errorMessage: f.message });
      return;
    }

    const status = mapOutcome(result);
    await this.persistArtifacts(run.id, result);
    await this.transition(run.id, "RUNNING", status, {
      endedAt,
      durationMs,
      finalOutput: result.finalText ? truncate(redactString(result.finalText, this.deps.secrets), 50_000) : null,
      usage: result.usage ? (redactDeep(result.usage) as Prisma.InputJsonValue) : undefined,
      costUsd: result.costUsd ?? null,
      costSource: result.costUsd !== undefined ? result.costSource : "UNAVAILABLE",
      errorCode: status === "COMPLETED" ? null : (result.errorCode ?? (result.outcome === "incomplete" ? `incomplete_${result.reason ?? "unknown"}` : result.outcome)),
      errorMessage: status === "COMPLETED" ? null : (result.errorMessage ?? `Provider reported ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`),
      externalResponseId: result.responseId ?? undefined,
      externalSessionId: result.sessionId ?? undefined,
    });
    await record(status === "COMPLETED" ? "lifecycle" : "error", `run.${status.toLowerCase()}`, `Run finished: ${status}`);
  }

  private async persistArtifacts(runId: string, result: AgentRunResult) {
    for (const a of result.artifacts) {
      const path = safeRelativePath.safeParse(a.path);
      if (!path.success) continue;
      const bytes = Buffer.byteLength(a.content);
      if (bytes > MAX_ARTIFACT_BYTES) continue;
      await this.deps.prisma.artifact.upsert({
        where: { runId_path: { runId, path: path.data } },
        create: { runId, path: path.data, content: a.content, bytes, sha256: sha256(a.content), mediaType: a.mediaType.slice(0, 100), source: a.source },
        update: { content: a.content, bytes, sha256: sha256(a.content), source: a.source },
      });
    }
  }

  /** Conditional state transition; returns false when another actor moved the run first. */
  private async transition(runId: string, from: RunStatus, to: RunStatus, data: Prisma.AgentRunUpdateManyMutationInput = {}): Promise<boolean> {
    assertTransition(from, to);
    const res = await this.deps.prisma.agentRun.updateMany({ where: { id: runId, status: from }, data: { ...data, status: to } });
    return res.count === 1;
  }

  async evaluate(benchmarkId: string): Promise<void> {
    const { prisma } = this.deps;
    const bench = await prisma.benchmark.findUniqueOrThrow({
      where: { id: benchmarkId },
      include: { task: true, runs: { include: { artifacts: true } } },
    });
    const testSpec = z.array(testCaseSchema).catch([]).parse(bench.task.testSpec ?? []);
    const constraints = (bench.task.constraints ?? {}) as { maxSolutionBytes?: number };
    const outcomes = await evaluateBenchmark(
      {
        profile: bench.profile as Profile,
        weights: bench.weights as Weights,
        task: {
          language: bench.task.language,
          entryFile: bench.task.entryFile,
          entryFunction: bench.task.entryFunction,
          testSpec,
          maxSolutionBytes: constraints.maxSolutionBytes,
        },
        runs: bench.runs.map((r) => ({
          runId: r.id,
          status: r.status,
          durationMs: r.durationMs,
          costUsd: r.costUsd,
          costSource: r.costSource,
          artifacts: r.artifacts.map((a) => ({ path: a.path, content: a.content })),
        })),
      },
      this.deps.sandbox,
    );
    for (const o of outcomes) {
      const data = {
        status: o.status,
        evaluatorVersion: o.evidence.evaluatorVersion,
        correctness: o.components.correctness,
        reliability: o.components.reliability,
        quality: o.components.quality,
        efficiency: o.components.efficiency,
        security: o.components.security,
        totalScore: o.totalScore,
        coverage: o.coverage,
        testsPassed: o.testsPassed,
        testsFailed: o.testsFailed,
        testsSkipped: o.testsSkipped,
        runtimeAvailable: o.runtimeAvailable,
        weights: bench.weights as Prisma.InputJsonValue,
        evidence: redactDeep(o.evidence) as unknown as Prisma.InputJsonValue,
      };
      await prisma.evaluationResult.upsert({ where: { runId: o.runId }, create: { runId: o.runId, ...data }, update: data });
    }
    const ranked = rankOutcomes(
      outcomes.map((o) => ({ ...o, gated: o.evidence.gates.length > 0, durationMs: bench.runs.find((r) => r.id === o.runId)?.durationMs })),
    );
    const winner = ranked[0]?.totalScore !== null && ranked[0]?.totalScore !== undefined ? ranked[0].runId : null;
    await prisma.benchmark.update({ where: { id: benchmarkId }, data: { winnerRunId: winner } });
  }

  private async finalizeBenchmark(benchmarkId: string, cancelled = false) {
    const runs = await this.deps.prisma.agentRun.findMany({ where: { benchmarkId }, select: { status: true } });
    const status = deriveBenchmarkStatus(runs.map((r) => r.status), cancelled || this.cancelledBenchmarks.has(benchmarkId));
    if (status === "PENDING" || status === "RUNNING") return;
    await this.deps.prisma.benchmark.update({ where: { id: benchmarkId }, data: { status, completedAt: new Date() } });
  }
}

function mapOutcome(result: AgentRunResult): RunStatus {
  switch (result.outcome) {
    case "completed":
      return "COMPLETED";
    case "cancelled":
      return "CANCELLED";
    case "incomplete":
      return result.reason === "timeout" ? "TIMED_OUT" : "FAILED";
    default:
      return "FAILED";
  }
}

function simKeyOf(notes: Prisma.JsonValue | null): string | undefined {
  if (notes && typeof notes === "object" && !Array.isArray(notes) && typeof notes.simKey === "string") return notes.simKey;
  return undefined;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

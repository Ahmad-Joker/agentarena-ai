/**
 * Orchestrator integration tests against a real Postgres database (a separate
 * `agentarena_test` database, reset before the suite). Agents are the deterministic
 * demo adapter or purpose-built doubles; the sandbox is a deterministic fake so these
 * tests focus on orchestration, persistence and state handling.
 */
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { BenchmarkOrchestrator } from "@/lib/orchestrator/orchestrator";
import { DemoAgentAdapter } from "@/lib/agents/demo-adapter";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "@/lib/agents/types";
import { BenchmarkRequestError, createBenchmark } from "@/lib/services/benchmarks";
import { ensureSimulatedAgents, ensureWorkspace } from "@/lib/services/workspace";
import { fixtureKeyForHash } from "@/lib/services/fixtures";
import { DEMO_TASKS } from "@/lib/fixtures/demo-tasks";
import { taskInputSchema } from "@/lib/domain/schemas";
import { HarnessRouterError } from "@/lib/harnessrouter/errors";
import { FakeSandbox } from "../support/fakes";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://agentarena:agentarena_local_only@127.0.0.1:5433/agentarena_test?schema=public";
let prisma: PrismaClient;
let workspaceId: string;
let agentIds: string[];

const sandbox = new FakeSandbox((input) => ({ results: input.argsList.map(() => ({ ok: true as const, value: null })) }));
const authTask = taskInputSchema.parse(DEMO_TASKS.find((t) => t.key === "auth-token-expiry")!.task);

function orchestrator(adapter: AgentAdapter, extra: Partial<ConstructorParameters<typeof BenchmarkOrchestrator>[0]> = {}) {
  return new BenchmarkOrchestrator({ prisma, sandbox, globalLimit: 4, fixtureKeyFor: fixtureKeyForHash, adapterFor: () => adapter, ...extra });
}

async function newBenchmark(overrides: Partial<Parameters<typeof createBenchmark>[1]> = {}) {
  return createBenchmark(
    { prisma, workspaceId, mode: "DEMO", liveAllowed: false },
    { task: authTask, agentIds, profile: "BALANCED", timeoutSeconds: 30, maxConcurrency: 3, confirmLiveSpend: false, ...overrides },
  );
}

beforeAll(async () => {
  if (!/\/agentarena_test(\?|$)/.test(TEST_DB)) throw new Error("Integration tests only run against a database named agentarena_test");
  // Non-destructive: creates the test database if needed and applies migrations.
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "pipe" });
  prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  // Clean slate inside the dedicated test database only.
  await prisma.routingRecommendation.deleteMany();
  await prisma.benchmark.deleteMany();
  await prisma.codingTask.deleteMany();
  await prisma.agentConfiguration.deleteMany();
  await prisma.workspace.deleteMany();
  workspaceId = (await ensureWorkspace(prisma)).id;
  await ensureSimulatedAgents(prisma, workspaceId);
  agentIds = (await prisma.agentConfiguration.findMany({ where: { workspaceId }, orderBy: { name: "asc" } })).map((a) => a.id);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("benchmark orchestration (Postgres)", () => {
  it("runs every agent, persists events, artifacts and evaluations, and picks a winner", async () => {
    const bench = await newBenchmark();
    await orchestrator(new DemoAgentAdapter(0)).start(bench.id);

    const saved = await prisma.benchmark.findUniqueOrThrow({
      where: { id: bench.id },
      include: { runs: { include: { events: true, artifacts: true, evaluation: true, agent: true } } },
    });
    expect(saved.status).toBe("COMPLETED");
    expect(saved.runs).toHaveLength(3);
    expect(new Set(saved.runs.map((r) => r.idempotencyKey)).size).toBe(3);
    for (const run of saved.runs) {
      expect(run.status).toBe("COMPLETED");
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
      expect(run.costSource).toBe("SIMULATED");
      expect(run.artifacts[0]?.path).toBe("auth.ts");
      expect(run.evaluation).not.toBeNull();
      const seqs = run.events.map((e) => e.sequence).sort((a, b) => a - b);
      expect(seqs).toEqual([...seqs.keys()]);
    }
    expect(saved.winnerRunId).not.toBeNull();
    // Every agent got the identical, frozen prompt.
    expect(saved.promptSnapshot).toContain("auth.ts");
  });

  it("refuses to start the same benchmark twice", async () => {
    const bench = await newBenchmark();
    const o = orchestrator(new DemoAgentAdapter(0));
    await o.start(bench.id);
    await expect(o.start(bench.id)).rejects.toThrow(/not pending/);
  });

  it("records simulated provider failures and timeouts with the right states", async () => {
    const slug = taskInputSchema.parse(DEMO_TASKS.find((t) => t.key === "slugify")!.task);
    const merge = taskInputSchema.parse(DEMO_TASKS.find((t) => t.key === "merge-intervals")!.task);
    const o = orchestrator(new DemoAgentAdapter(0));
    const b1 = await newBenchmark({ task: slug });
    const b2 = await newBenchmark({ task: merge });
    await o.start(b1.id);
    await o.start(b2.id);
    const r1 = await prisma.agentRun.findFirstOrThrow({ where: { benchmarkId: b1.id, agent: { name: { contains: "Erratic" } } } });
    const r2 = await prisma.agentRun.findFirstOrThrow({ where: { benchmarkId: b2.id, agent: { name: { contains: "Erratic" } } } });
    expect(r1).toMatchObject({ status: "FAILED", errorCode: "upstream_error" });
    expect(r2).toMatchObject({ status: "TIMED_OUT", errorCode: "incomplete_timeout" });
  });

  it("enforces the orchestrator timeout", async () => {
    const hang: AgentAdapter = {
      kind: "SIMULATED",
      run: (req) =>
        new Promise((_, reject) => {
          req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true });
        }),
    };
    const bench = await newBenchmark({ timeoutSeconds: 10 });
    await prisma.benchmark.update({ where: { id: bench.id }, data: { timeoutSeconds: 1 } });
    await orchestrator(hang).start(bench.id);
    const runs = await prisma.agentRun.findMany({ where: { benchmarkId: bench.id } });
    expect(runs.every((r) => r.status === "TIMED_OUT" && r.errorCode === "timeout")).toBe(true);
    expect((await prisma.benchmark.findUniqueOrThrow({ where: { id: bench.id } })).status).toBe("FAILED");
  }, 20_000);

  it("cancels in-flight and queued runs", async () => {
    const o = orchestrator(new DemoAgentAdapter(1), { globalLimit: 1 });
    const bench = await newBenchmark({ maxConcurrency: 1 });
    const done = o.start(bench.id);
    await new Promise((r) => setTimeout(r, 400));
    await o.cancelBenchmark(bench.id);
    await done;
    const saved = await prisma.benchmark.findUniqueOrThrow({ where: { id: bench.id }, include: { runs: true } });
    expect(saved.status).toBe("CANCELLED");
    expect(saved.runs.every((r) => r.status === "CANCELLED")).toBe(true);
    expect(saved.winnerRunId).toBeNull();
  }, 20_000);

  it("never exceeds the global concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const counting: AgentAdapter = {
      kind: "SIMULATED",
      async run(req: AgentRunRequest): Promise<AgentRunResult> {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 80));
        active--;
        return new DemoAgentAdapter(0).run(req);
      },
    };
    const o = orchestrator(counting, { globalLimit: 2 });
    const benches = await Promise.all([newBenchmark(), newBenchmark()]);
    await Promise.all(benches.map((b) => o.start(b.id)));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("retries retryable errors before the task is accepted, reusing the idempotency key", async () => {
    const keys: string[] = [];
    let calls = 0;
    const flaky: AgentAdapter = {
      kind: "SIMULATED",
      async run(req) {
        keys.push(req.idempotencyKey);
        calls++;
        if (calls === 1) throw new HarnessRouterError(503, "server_error", "unavailable", "busy");
        return new DemoAgentAdapter(0).run(req);
      },
    };
    const bench = await newBenchmark({ agentIds: agentIds.slice(0, 2) });
    await orchestrator(flaky, { globalLimit: 1 }).start(bench.id);
    const runs = await prisma.agentRun.findMany({ where: { benchmarkId: bench.id } });
    expect(runs.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(keys[0]).toBe(keys[1]);
    expect(runs.some((r) => r.attempt === 2)).toBe(true);
  }, 20_000);

  it("marks runs orphaned by a previous process as interrupted", async () => {
    const bench = await newBenchmark();
    await prisma.benchmark.update({ where: { id: bench.id }, data: { status: "RUNNING" } });
    await prisma.agentRun.updateMany({ where: { benchmarkId: bench.id }, data: { status: "RUNNING" } });
    await new Promise((r) => setTimeout(r, 20));
    const fixed = await orchestrator(new DemoAgentAdapter(0)).reconcileInterrupted();
    expect(fixed).toBeGreaterThanOrEqual(3);
    const runs = await prisma.agentRun.findMany({ where: { benchmarkId: bench.id } });
    expect(runs.every((r) => r.status === "FAILED" && r.errorCode === "interrupted")).toBe(true);
  });

  it("does not reconcile benchmarks created after the orchestrator started", async () => {
    const o = orchestrator(new DemoAgentAdapter(0));
    await new Promise((r) => setTimeout(r, 20));
    const bench = await newBenchmark();
    await o.reconcileInterrupted();
    const runs = await prisma.agentRun.findMany({ where: { benchmarkId: bench.id } });
    expect(runs.every((r) => r.status === "PENDING")).toBe(true);
  });

  it("rejects invalid configurations safely", async () => {
    await expect(newBenchmark({ agentIds: [agentIds[0]!, "ckzzzzzzzzzzzzzzzzzzzzzzz"] })).rejects.toBeInstanceOf(BenchmarkRequestError);
    await expect(
      createBenchmark({ prisma, workspaceId, mode: "LIVE", liveAllowed: false }, { task: authTask, agentIds, profile: "BALANCED", timeoutSeconds: 30, maxConcurrency: 2, confirmLiveSpend: true }),
    ).rejects.toMatchObject({ code: "live_disabled" });
    await expect(
      createBenchmark({ prisma, workspaceId, mode: "LIVE", liveAllowed: true }, { task: authTask, agentIds, profile: "BALANCED", timeoutSeconds: 30, maxConcurrency: 2, confirmLiveSpend: false }),
    ).rejects.toMatchObject({ code: "spend_not_confirmed" });
    // Simulated agents can never be run as a LIVE benchmark.
    await expect(
      createBenchmark({ prisma, workspaceId, mode: "LIVE", liveAllowed: true }, { task: authTask, agentIds, profile: "BALANCED", timeoutSeconds: 30, maxConcurrency: 2, confirmLiveSpend: true }),
    ).rejects.toMatchObject({ code: "mode_mismatch" });
  });

  it("deduplicates identical tasks by content hash", async () => {
    const a = await newBenchmark();
    const b = await newBenchmark();
    expect(a.taskId).toBe(b.taskId);
  });
});

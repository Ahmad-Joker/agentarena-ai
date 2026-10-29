import type { getBenchmarkDetail } from "./queries";
import type { EvaluationEvidence } from "@/lib/evaluation/engine";

type Detail = NonNullable<Awaited<ReturnType<typeof getBenchmarkDetail>>>;

/** Browser-safe benchmark view. Excludes harness ids, provider response/session ids and idempotency keys. */
export function toBenchmarkDto(b: Detail) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    profile: b.profile,
    weights: b.weights as Record<string, number>,
    timeoutSeconds: b.timeoutSeconds,
    maxConcurrency: b.maxConcurrency,
    maxCostUsd: b.maxCostUsd,
    promptSnapshot: b.promptSnapshot,
    winnerRunId: b.winnerRunId,
    createdAt: b.createdAt.toISOString(),
    startedAt: b.startedAt?.toISOString() ?? null,
    completedAt: b.completedAt?.toISOString() ?? null,
    task: {
      id: b.task.id,
      title: b.task.title,
      description: b.task.description,
      language: b.task.language,
      category: b.task.category,
      entryFile: b.task.entryFile,
      entryFunction: b.task.entryFunction,
      expectedBehavior: b.task.expectedBehavior,
      testCount: Array.isArray(b.task.testSpec) ? b.task.testSpec.length : 0,
      isFixture: b.task.isFixture,
    },
    runs: b.runs.map((r) => ({
      id: r.id,
      status: r.status,
      attempt: r.attempt,
      agent: { id: r.agent.id, name: r.agent.name, color: r.agent.color, provider: r.agent.provider, model: r.agent.model, base: r.agent.base },
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      durationMs: r.durationMs,
      costUsd: r.costUsd,
      costSource: r.costSource,
      usage: r.usage as { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      finalOutput: r.finalOutput,
      events: r.events.map((e) => ({ seq: e.sequence, kind: e.kind, type: e.type, message: e.message, at: e.createdAt.toISOString() })),
      artifacts: r.artifacts.map((a) => ({ id: a.id, path: a.path, bytes: a.bytes, sha256: a.sha256, source: a.source, content: a.content })),
      evaluation: r.evaluation
        ? {
            status: r.evaluation.status,
            totalScore: r.evaluation.totalScore,
            coverage: r.evaluation.coverage,
            components: {
              correctness: r.evaluation.correctness,
              reliability: r.evaluation.reliability,
              quality: r.evaluation.quality,
              efficiency: r.evaluation.efficiency,
              security: r.evaluation.security,
            },
            testsPassed: r.evaluation.testsPassed,
            testsFailed: r.evaluation.testsFailed,
            testsSkipped: r.evaluation.testsSkipped,
            runtimeAvailable: r.evaluation.runtimeAvailable,
            evidence: r.evaluation.evidence as unknown as EvaluationEvidence,
          }
        : null,
    })),
  };
}

export type BenchmarkDto = ReturnType<typeof toBenchmarkDto>;
export type RunDto = BenchmarkDto["runs"][number];

import { mean, median, wilsonInterval } from "./stats";

/** One evaluated run, flattened for analytics. */
export interface RunRecord {
  runId: string;
  benchmarkId: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  model: string | null;
  language: string;
  category: string;
  profile: string;
  status: string;
  errorCode: string | null;
  durationMs: number | null;
  costUsd: number | null;
  costSource: string;
  totalScore: number | null;
  correctness: number | null;
  /** The run tripped a high-severity security finding (ranking gate). */
  gated: boolean;
  createdAt: Date;
}

export interface AgentAggregate {
  agentId: string;
  agentName: string;
  agentColor: string;
  runs: number;
  completed: number;
  successRate: number | null;
  successInterval: { low: number; high: number } | null;
  meanCorrectness: number | null;
  meanScore: number | null;
  medianDurationMs: number | null;
  meanCostUsd: number | null;
  costSources: string[];
  failures: Record<string, number>;
  /** Runs that tripped the high-severity security gate. */
  gatedRuns: number;
  /** Fewer than MIN_SAMPLES scored runs — rankings shown with a warning. */
  lowSample: boolean;
}

export const MIN_SAMPLES = 3;

export function aggregateByAgent(records: RunRecord[]): AgentAggregate[] {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    if (r.status === "CANCELLED" || r.status === "PENDING" || r.status === "RUNNING") continue;
    const list = groups.get(r.agentId) ?? [];
    list.push(r);
    groups.set(r.agentId, list);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0]!;
    const completed = rows.filter((r) => r.status === "COMPLETED");
    const failures: Record<string, number> = {};
    for (const r of rows) if (r.status !== "COMPLETED") failures[r.errorCode ?? r.status] = (failures[r.errorCode ?? r.status] ?? 0) + 1;
    const scored = rows.filter((r) => r.totalScore !== null);
    return {
      agentId: first.agentId,
      agentName: first.agentName,
      agentColor: first.agentColor,
      runs: rows.length,
      completed: completed.length,
      successRate: rows.length ? completed.length / rows.length : null,
      successInterval: wilsonInterval(completed.length, rows.length),
      meanCorrectness: mean(rows.filter((r) => r.correctness !== null).map((r) => r.correctness!)),
      meanScore: mean(scored.map((r) => r.totalScore!)),
      medianDurationMs: median(completed.filter((r) => r.durationMs !== null).map((r) => r.durationMs!)),
      meanCostUsd: mean(rows.filter((r) => r.costUsd !== null).map((r) => r.costUsd!)),
      costSources: [...new Set(rows.map((r) => r.costSource))],
      failures,
      gatedRuns: rows.filter((r) => r.gated).length,
      lowSample: scored.length < MIN_SAMPLES,
    };
  });
}

/** Repeated failure patterns worth surfacing (same agent + same error ≥ 2 times). */
export function repeatedFailures(aggs: AgentAggregate[]) {
  return aggs.flatMap((a) =>
    Object.entries(a.failures)
      .filter(([, n]) => n >= 2)
      .map(([code, count]) => ({ agentName: a.agentName, code, count })),
  );
}

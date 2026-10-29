import type { ExecutionMode, Prisma, PrismaClient } from "@prisma/client";
import type { RunRecord } from "@/lib/analytics/aggregate";

export interface RecordFilters {
  language?: string;
  category?: string;
  model?: string;
  profile?: string;
  since?: Date;
}

/** Flattened run records for analytics/routing. DEMO and LIVE data are never mixed. */
export async function loadRunRecords(prisma: PrismaClient, mode: ExecutionMode, filters: RecordFilters = {}): Promise<RunRecord[]> {
  const where: Prisma.AgentRunWhereInput = {
    benchmark: {
      mode,
      ...(filters.profile ? { profile: filters.profile as Prisma.EnumBenchmarkProfileFilter["equals"] } : {}),
      ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
      task: {
        ...(filters.language ? { language: filters.language as Prisma.EnumTaskLanguageFilter["equals"] } : {}),
        ...(filters.category ? { category: filters.category as Prisma.EnumTaskCategoryFilter["equals"] } : {}),
      },
    },
    ...(filters.model ? { agent: { model: filters.model } } : {}),
    status: { in: ["COMPLETED", "FAILED", "TIMED_OUT"] },
  };
  const rows = await prisma.agentRun.findMany({
    where,
    include: { agent: true, evaluation: true, benchmark: { include: { task: true } } },
    orderBy: { createdAt: "asc" },
    take: 5_000,
  });
  return rows.map((r) => ({
    runId: r.id,
    benchmarkId: r.benchmarkId,
    agentId: r.agentId,
    agentName: r.agent.name,
    agentColor: r.agent.color,
    model: r.agent.model,
    language: r.benchmark.task.language,
    category: r.benchmark.task.category,
    profile: r.benchmark.profile,
    status: r.status,
    errorCode: r.errorCode,
    durationMs: r.durationMs,
    costUsd: r.costUsd,
    costSource: r.costSource,
    totalScore: r.evaluation?.totalScore ?? null,
    correctness: r.evaluation?.correctness ?? null,
    gated: hasGates(r.evaluation?.evidence),
    createdAt: r.createdAt,
  }));
}

function hasGates(evidence: Prisma.JsonValue | undefined): boolean {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const gates = (evidence as { gates?: unknown }).gates;
  return Array.isArray(gates) && gates.length > 0;
}

export async function getDashboardData(prisma: PrismaClient, mode: ExecutionMode) {
  const [benchmarks, runs, recent] = await Promise.all([
    prisma.benchmark.groupBy({ by: ["status"], where: { mode }, _count: true }),
    prisma.agentRun.findMany({
      where: { benchmark: { mode } },
      select: { status: true, durationMs: true, costUsd: true, costSource: true, usage: true },
    }),
    prisma.benchmark.findMany({
      where: { mode },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { task: { select: { title: true, language: true, category: true } }, runs: { select: { status: true, agent: { select: { name: true, color: true } } } } },
    }),
  ]);
  const finished = runs.filter((r) => ["COMPLETED", "FAILED", "TIMED_OUT"].includes(r.status));
  const completed = runs.filter((r) => r.status === "COMPLETED");
  const durations = completed.map((r) => r.durationMs).filter((d): d is number => d !== null);
  const costed = runs.filter((r) => r.costUsd !== null);
  const tokens = runs.reduce((s, r) => {
    const u = r.usage as { total_tokens?: number } | null;
    return s + (typeof u?.total_tokens === "number" ? u.total_tokens : 0);
  }, 0);
  return {
    totalBenchmarks: benchmarks.reduce((s, b) => s + b._count, 0),
    runningBenchmarks: benchmarks.find((b) => b.status === "RUNNING")?._count ?? 0,
    completedRuns: completed.length,
    finishedRuns: finished.length,
    successRate: finished.length ? completed.length / finished.length : null,
    avgDurationMs: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
    totalCostUsd: costed.length ? costed.reduce((s, r) => s + (r.costUsd ?? 0), 0) : null,
    costSources: [...new Set(costed.map((r) => r.costSource))],
    totalTokens: tokens || null,
    recent,
  };
}

export async function getBenchmarkDetail(prisma: PrismaClient, id: string) {
  return prisma.benchmark.findUnique({
    where: { id },
    include: {
      task: true,
      runs: {
        orderBy: { createdAt: "asc" },
        include: {
          agent: { select: { id: true, name: true, color: true, provider: true, model: true, harnessId: true, base: true } },
          events: { orderBy: { sequence: "asc" }, take: 400 },
          artifacts: { select: { id: true, path: true, bytes: true, sha256: true, source: true, content: true } },
          evaluation: true,
        },
      },
    },
  });
}

export async function listBenchmarks(
  prisma: PrismaClient,
  mode: ExecutionMode,
  filters: { status?: string; language?: string; category?: string; q?: string },
) {
  return prisma.benchmark.findMany({
    where: {
      mode,
      ...(filters.status ? { status: filters.status as Prisma.EnumBenchmarkStatusFilter["equals"] } : {}),
      task: {
        ...(filters.language ? { language: filters.language as Prisma.EnumTaskLanguageFilter["equals"] } : {}),
        ...(filters.category ? { category: filters.category as Prisma.EnumTaskCategoryFilter["equals"] } : {}),
        ...(filters.q ? { title: { contains: filters.q, mode: "insensitive" } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      task: { select: { title: true, language: true, category: true } },
      runs: { select: { id: true, status: true, durationMs: true, agent: { select: { name: true, color: true } }, evaluation: { select: { totalScore: true } } } },
    },
  });
}

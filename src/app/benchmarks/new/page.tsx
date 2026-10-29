import type { Metadata } from "next";
import { getRequestContext } from "@/lib/api";
import { DEMO_TASKS } from "@/lib/fixtures/demo-tasks";
import { PageHeader } from "@/components/page-header";
import { NewBenchmarkForm } from "@/components/benchmark/new-benchmark-form";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "New benchmark" };

export default async function NewBenchmarkPage() {
  const ctx = await getRequestContext();
  const env = getEnv();
  const agents = await ctx.prisma.agentConfiguration.findMany({
    where: { workspaceId: ctx.workspaceId, mode: ctx.mode, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, description: true, provider: true, model: true, base: true, languages: true, color: true },
  });
  return (
    <>
      <PageHeader
        eyebrow="Benchmark"
        title="New benchmark"
        description="Every selected agent receives the same prompt, the same starting files and the same limits. Solutions are graded by executing declarative tests in an isolated sandbox."
      />
      <NewBenchmarkForm
        mode={ctx.mode}
        liveAllowed={ctx.liveAllowed}
        agents={agents}
        templates={DEMO_TASKS.map((t) => ({ key: t.key, task: t.task }))}
        defaults={{ timeoutSeconds: Math.min(env.DEFAULT_RUN_TIMEOUT_SECONDS, ctx.mode === "DEMO" ? 120 : env.DEFAULT_RUN_TIMEOUT_SECONDS), maxConcurrency: env.MAX_CONCURRENT_RUNS }}
      />
    </>
  );
}

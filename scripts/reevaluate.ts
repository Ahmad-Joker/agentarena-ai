/**
 * Re-runs evaluation for every finished benchmark from its stored artifacts and run records,
 * then reports how many totals changed. Useful after upgrading the evaluator, and as a
 * reproducibility check: with an unchanged evaluator every total should be identical.
 *
 * Usage: npm run eval:rerun
 */
import { PrismaClient } from "@prisma/client";
import { BenchmarkOrchestrator } from "../src/lib/orchestrator/orchestrator";
import { DisabledSandbox, DockerSandbox } from "../src/lib/evaluation/sandbox";
import { DemoAgentAdapter } from "../src/lib/agents/demo-adapter";

const prisma = new PrismaClient();

async function main() {
  const docker = new DockerSandbox({ nodeImage: process.env.SANDBOX_NODE_IMAGE ?? "node:22-alpine", pythonImage: process.env.SANDBOX_PYTHON_IMAGE ?? "python:3.12-alpine", timeoutMs: 20_000 });
  const ready = process.env.SANDBOX_MODE !== "disabled" && (await docker.isAvailable("TYPESCRIPT")).available;
  const orchestrator = new BenchmarkOrchestrator({
    prisma,
    sandbox: ready ? docker : new DisabledSandbox("Docker sandbox unavailable during re-evaluation"),
    globalLimit: 1,
    adapterFor: () => new DemoAgentAdapter(0),
  });
  const benches = await prisma.benchmark.findMany({ where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } }, select: { id: true } });
  let changed = 0;
  for (const { id } of benches) {
    const before = await prisma.evaluationResult.findMany({ where: { run: { benchmarkId: id } }, select: { runId: true, totalScore: true } });
    await orchestrator.evaluate(id);
    const after = await prisma.evaluationResult.findMany({ where: { run: { benchmarkId: id } }, select: { runId: true, totalScore: true } });
    for (const a of after) if (before.find((b) => b.runId === a.runId)?.totalScore !== a.totalScore) changed++;
  }
  console.log(`Re-evaluated ${benches.length} benchmarks; ${changed} run total(s) changed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

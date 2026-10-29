/**
 * Seeds the local workspace with SIMULATED demo data by running the real pipeline:
 * simulated agents (deterministic fixtures) → orchestrator → real sandboxed evaluation.
 * Every row is marked mode=DEMO and every cost is costSource=SIMULATED.
 *
 * Usage: npm run db:seed            (3 rounds over every demo task)
 *        SEED_ROUNDS=1 npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { DemoAgentAdapter } from "../src/lib/agents/demo-adapter";
import { DisabledSandbox, DockerSandbox } from "../src/lib/evaluation/sandbox";
import { BenchmarkOrchestrator } from "../src/lib/orchestrator/orchestrator";
import { createBenchmark, upsertTask } from "../src/lib/services/benchmarks";
import { ensureSimulatedAgents, ensureWorkspace } from "../src/lib/services/workspace";
import { fixtureKeyForHash } from "../src/lib/services/fixtures";
import { DEMO_TASKS } from "../src/lib/fixtures/demo-tasks";
import { taskInputSchema } from "../src/lib/domain/schemas";

const prisma = new PrismaClient();

async function main() {
  const workspace = await ensureWorkspace(prisma);
  await ensureSimulatedAgents(prisma, workspace.id);
  const agents = await prisma.agentConfiguration.findMany({ where: { workspaceId: workspace.id, mode: "DEMO" } });

  for (const fixture of DEMO_TASKS) await upsertTask(prisma, workspace.id, taskInputSchema.parse(fixture.task), true);

  const existing = await prisma.benchmark.count({ where: { workspaceId: workspace.id, mode: "DEMO" } });
  if (existing > 0 && process.env.SEED_FORCE !== "true") {
    console.log(`Demo history already present (${existing} benchmarks). Set SEED_FORCE=true to add more.`);
    return;
  }

  const docker = new DockerSandbox({ nodeImage: process.env.SANDBOX_NODE_IMAGE ?? "node:22-alpine", pythonImage: process.env.SANDBOX_PYTHON_IMAGE ?? "python:3.12-alpine", timeoutMs: 20_000 });
  const dockerReady = process.env.SANDBOX_MODE !== "disabled" && (await docker.isAvailable("TYPESCRIPT")).available && (await docker.isAvailable("PYTHON")).available;
  if (!dockerReady) console.warn("Docker sandbox unavailable: runtime tests will be recorded as unavailable (static analysis only).");

  const orchestrator = new BenchmarkOrchestrator({
    prisma,
    sandbox: dockerReady ? docker : new DisabledSandbox("Docker sandbox unavailable during seeding"),
    globalLimit: 3,
    fixtureKeyFor: fixtureKeyForHash,
    // Fast pacing so seeding takes seconds, while still preserving relative agent speed.
    adapterFor: () => new DemoAgentAdapter(0.05),
    log: (m, e) => console.error(m, e),
  });

  const rounds = Number(process.env.SEED_ROUNDS ?? 3);
  const profiles = ["BALANCED", "CORRECTNESS", "SPEED"] as const;
  for (let round = 0; round < rounds; round++) {
    for (const fixture of DEMO_TASKS) {
      const bench = await createBenchmark(
        { prisma, workspaceId: workspace.id, mode: "DEMO", liveAllowed: false },
        {
          task: taskInputSchema.parse(fixture.task),
          agentIds: agents.map((a) => a.id),
          profile: profiles[round % profiles.length]!,
          timeoutSeconds: 120,
          maxConcurrency: 3,
          confirmLiveSpend: false,
        },
      );
      await orchestrator.start(bench.id);
      const done = await prisma.benchmark.findUniqueOrThrow({ where: { id: bench.id }, select: { status: true } });
      console.log(`round ${round + 1} · ${fixture.key.padEnd(20)} → ${done.status}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

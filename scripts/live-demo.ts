/**
 * Ready-made LIVE showcase: runs one built-in task through real HarnessRouter agents, then
 * grades the code they wrote in the local Docker sandbox. Results land in the normal
 * benchmark pages (start the server with AGENTARENA_MODE=LIVE to see them).
 *
 * Without --confirm-spend it is a free dry run: it checks the protocol version (GET /v1/uhp),
 * lists your configured agents (GET /v1/harnesses) and prints the plan. No task is started.
 *
 * Usage:
 *   npm run demo:live                          dry run, free
 *   npm run demo:live -- --confirm-spend       billable: one task per agent
 * Options:
 *   --task <key>        built-in task (default: slugify)
 *   --agents <id,id>    harness ids to compare (default: the first two listed)
 *   --max-cost <usd>    per-run budget hint sent as max_cost_usd (default: 0.5)
 *   --timeout <sec>     per-run timeout (default: 300)
 */
import { PrismaClient } from "@prisma/client";
import { HarnessRouterAgentAdapter } from "../src/lib/agents/live-adapter";
import { createBenchmarkSchema, LANGUAGES, taskInputSchema } from "../src/lib/domain/schemas";
import { DisabledSandbox, DockerSandbox } from "../src/lib/evaluation/sandbox";
import { DEMO_TASKS } from "../src/lib/fixtures/demo-tasks";
import { HarnessRouterError, describeError } from "../src/lib/harnessrouter/errors";
import { HarnessRouterClient } from "../src/lib/harnessrouter/client";
import { BenchmarkOrchestrator } from "../src/lib/orchestrator/orchestrator";
import { createBenchmark } from "../src/lib/services/benchmarks";
import { ensureWorkspace } from "../src/lib/services/workspace";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the process environment.
}

const PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399"];

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Thrown instead of process.exit(), which can abort Node on Windows while fetch handles are closing.
function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  const confirmSpend = process.argv.includes("--confirm-spend");
  const taskKey = flag("task") ?? "slugify";
  const maxCostUsd = Number(flag("max-cost") ?? 0.5);
  const timeoutSeconds = Number(flag("timeout") ?? 300);
  const fixture = DEMO_TASKS.find((t) => t.key === taskKey) ?? fail(`Unknown task "${taskKey}". Choose one of: ${DEMO_TASKS.map((t) => t.key).join(", ")}`);
  if (!(maxCostUsd > 0 && maxCostUsd <= 5)) fail("--max-cost must be between 0 and 5 USD.");

  const apiKey = process.env.HR_API_KEY?.trim() || undefined;
  const baseUrl = process.env.HR_BASE_URL ?? "https://api.harnessrouter.ai";
  const client = new HarnessRouterClient({ baseUrl, apiKey });

  console.log(`HarnessRouter: ${baseUrl}`);
  const version = await client.discoverProtocolVersion();
  console.log(`✓ GET /v1/uhp → UHP-Version ${version ?? "(none advertised)"}`);

  if (!apiKey) fail("HR_API_KEY is empty. Create a Workspace API key at harnessrouter.ai and put it in .env (never in code or chat).");

  const harnesses = await client.listHarnesses();
  console.log(`✓ GET /v1/harnesses → ${harnesses.length} configured agent(s)`);
  for (const h of harnesses) console.log(`    ${h.id}  ${h.name ?? ""}  [${h.base ?? "?"}${h.defaultModel ? ` · ${h.defaultModel}` : ""}]`);

  const wanted = flag("agents")?.split(",").map((s) => s.trim()).filter(Boolean);
  const chosen = wanted ? wanted.map((id) => harnesses.find((h) => h.id === id) ?? fail(`Harness "${id}" is not in your account.`)) : harnesses.slice(0, 2);
  if (chosen.length < 2) fail("Need at least two configured agents. Create them in the HarnessRouter console, or pass --agents.");

  console.log(`\nPlan: "${fixture.task.title}" (${fixture.task.language})`);
  for (const h of chosen) console.log(`    · ${h.name ?? h.id} (${h.id})`);
  console.log(`    ${chosen.length} billable task(s), max_cost_usd ${maxCostUsd} each (a provider budget hint, not a guaranteed cap), timeout ${timeoutSeconds}s`);

  if (!confirmSpend) {
    console.log("\nDry run only: nothing was started and nothing was billed. Add --confirm-spend to run it.");
    return;
  }
  if (process.env.AGENTARENA_MODE !== "LIVE" || process.env.ALLOW_LIVE_EXECUTION !== "true") {
    fail("Live execution is switched off. Set AGENTARENA_MODE=LIVE and ALLOW_LIVE_EXECUTION=true in .env first.");
  }

  const prisma = new PrismaClient();
  try {
    const workspace = await ensureWorkspace(prisma);
    const agentIds: string[] = [];
    for (const [i, h] of chosen.entries()) {
      // Console-generated names can be vague ("Completed code files"), so name agents by base and model.
      const name = `HR · ${h.base ?? h.name ?? "agent"} · ${h.defaultModel ?? "default"} · ${h.id.slice(-6)}`.slice(0, 60);
      const agent = await prisma.agentConfiguration.upsert({
        where: { workspaceId_name: { workspaceId: workspace.id, name } },
        create: {
          workspaceId: workspace.id,
          name,
          description: `HarnessRouter configured agent (${h.base ?? "unknown base"})`,
          provider: "HARNESSROUTER",
          mode: "LIVE",
          harnessId: h.id,
          base: h.base ?? "unknown",
          languages: [...LANGUAGES],
          color: PALETTE[i % PALETTE.length]!,
          runtimeNotes: { source: "live-demo script", defaultModel: h.defaultModel ?? null },
        },
        update: { harnessId: h.id, isActive: true },
      });
      agentIds.push(agent.id);
    }

    const docker = new DockerSandbox({
      nodeImage: process.env.SANDBOX_NODE_IMAGE ?? "node:22-alpine",
      pythonImage: process.env.SANDBOX_PYTHON_IMAGE ?? "python:3.12-alpine",
      timeoutMs: Number(process.env.SANDBOX_TIMEOUT_MS ?? 15_000),
    });
    const dockerReady = (await docker.isAvailable(fixture.task.language)).available;
    if (!dockerReady) console.warn("! Docker sandbox unavailable: tests will be recorded as not run.");

    const bench = await createBenchmark(
      { prisma, workspaceId: workspace.id, mode: "LIVE", liveAllowed: true },
      createBenchmarkSchema.parse({
        task: taskInputSchema.parse(fixture.task),
        agentIds,
        profile: "BALANCED",
        timeoutSeconds,
        maxConcurrency: Number(process.env.MAX_CONCURRENT_RUNS ?? 2),
        maxCostUsd,
        confirmLiveSpend: true,
      }),
    );
    console.log(`\nStarted benchmark ${bench.id}. Agents are working on HarnessRouter…`);

    const orchestrator = new BenchmarkOrchestrator({
      prisma,
      sandbox: dockerReady ? docker : new DisabledSandbox("Docker sandbox unavailable"),
      globalLimit: Number(process.env.MAX_CONCURRENT_RUNS ?? 2),
      secrets: [apiKey],
      adapterFor: (provider) => {
        if (provider !== "HARNESSROUTER") throw new Error("Only HarnessRouter agents run in the live demo");
        return new HarnessRouterAgentAdapter(client);
      },
      log: (m, e) => console.error(`[orchestrator] ${m}`, e instanceof Error ? e.message : ""),
    });
    await orchestrator.start(bench.id);

    const result = await prisma.benchmark.findUniqueOrThrow({
      where: { id: bench.id },
      include: { runs: { include: { agent: { select: { name: true } }, evaluation: true }, orderBy: { createdAt: "asc" } } },
    });
    console.log(`\nBenchmark ${result.status}`);
    for (const run of result.runs) {
      const ev = run.evaluation;
      const tests = ev ? `${ev.testsPassed}/${ev.testsPassed + ev.testsFailed} tests` : "not evaluated";
      const score = ev?.totalScore != null ? ev.totalScore.toFixed(1) : "—";
      const cost = run.costUsd != null ? `$${run.costUsd.toFixed(4)} (${run.costSource})` : `cost ${run.costSource}`;
      const time = run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—";
      console.log(`    ${run.agent.name.padEnd(32)} ${run.status.padEnd(10)} ${tests.padEnd(12)} score ${score.padEnd(6)} ${time.padEnd(8)} ${cost}`);
      if (run.errorCode) console.log(`        error: ${run.errorCode}: ${run.errorMessage ?? ""}`);
    }
    console.log(`\nOpen http://127.0.0.1:3100/benchmarks/${bench.id} (server must run with AGENTARENA_MODE=LIVE).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof HarnessRouterError ? describeError(err) : err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

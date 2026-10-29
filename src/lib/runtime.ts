import "server-only";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DemoAgentAdapter } from "@/lib/agents/demo-adapter";
import { HarnessRouterAgentAdapter } from "@/lib/agents/live-adapter";
import { HarnessRouterClient } from "@/lib/harnessrouter/client";
import { DisabledSandbox, DockerSandbox, type Sandbox } from "@/lib/evaluation/sandbox";
import { BenchmarkOrchestrator } from "@/lib/orchestrator/orchestrator";
import { fixtureKeyForHash } from "@/lib/services/fixtures";

const g = globalThis as unknown as { __agentArena?: { orchestrator: BenchmarkOrchestrator; reconciled: Promise<number> } };

export function getHarnessRouterClient(): HarnessRouterClient {
  const env = getEnv();
  return new HarnessRouterClient({ baseUrl: env.HR_BASE_URL, apiKey: env.HR_API_KEY });
}

export function getSandbox(): Sandbox {
  const env = getEnv();
  return env.SANDBOX_MODE === "docker"
    ? new DockerSandbox({ nodeImage: env.SANDBOX_NODE_IMAGE, pythonImage: env.SANDBOX_PYTHON_IMAGE, timeoutMs: env.SANDBOX_TIMEOUT_MS })
    : new DisabledSandbox();
}

/** Process-wide orchestrator. Reconciles runs orphaned by a previous process on first use. */
export async function getOrchestrator(): Promise<BenchmarkOrchestrator> {
  if (!g.__agentArena) {
    const env = getEnv();
    const demo = new DemoAgentAdapter(1);
    const orchestrator = new BenchmarkOrchestrator({
      prisma,
      sandbox: getSandbox(),
      globalLimit: env.MAX_CONCURRENT_RUNS,
      fixtureKeyFor: fixtureKeyForHash,
      secrets: env.HR_API_KEY ? [env.HR_API_KEY] : [],
      adapterFor: (provider) => {
        if (provider === "SIMULATED") return demo;
        const liveAllowed = env.AGENTARENA_MODE === "LIVE" && env.ALLOW_LIVE_EXECUTION && env.HR_API_KEY;
        if (!liveAllowed) throw new Error("Live execution is disabled on this server");
        return new HarnessRouterAgentAdapter(getHarnessRouterClient());
      },
      log: (msg, err) => console.error(`[orchestrator] ${msg}`, err instanceof Error ? err.message : ""),
    });
    g.__agentArena = { orchestrator, reconciled: orchestrator.reconcileInterrupted() };
  }
  await g.__agentArena.reconciled.catch(() => 0);
  return g.__agentArena.orchestrator;
}

import type { Metadata } from "next";
import { getRequestContext } from "@/lib/api";
import { getPublicEnvStatus } from "@/lib/env";
import { getSandbox } from "@/lib/runtime";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ScoringWeights } from "@/components/benchmark/scoring-weights";
import { AgentManager } from "@/components/settings/agent-manager";
import { LANGUAGE_LABEL } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-ink-400">{label}</span>
      <span className="flex items-center gap-2 text-right text-ink-200">
        {ok !== undefined && <span className={ok ? "size-2 rounded-full bg-success" : "size-2 rounded-full bg-danger"} aria-label={ok ? "ok" : "problem"} />}
        {value}
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const ctx = await getRequestContext();
  const env = getPublicEnvStatus();
  const sandbox = getSandbox();
  const [nodeSb, pySb] = await Promise.all([sandbox.isAvailable("TYPESCRIPT"), sandbox.isAvailable("PYTHON")]);
  const agents = await ctx.prisma.agentConfiguration.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, provider: true, mode: true, base: true, model: true, languages: true, color: true, isActive: true },
  });

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Settings" description="Connection, agents, limits and environment health. Secrets are configured in the server's .env file and are never sent to the browser." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>HarnessRouter connection</CardTitle>
              <CardDescription>Server-side only. The API key value is never displayed.</CardDescription>
            </div>
            <Badge tone={env.mode === "LIVE" ? "success" : "warning"}>{env.mode}</Badge>
          </CardHeader>
          <CardContent className="divide-y divide-ink-800">
            <Row label="Base URL" value={<span className="font-mono text-xs">{env.harnessRouterBaseUrl}</span>} />
            <Row label="Workspace API key (HR_API_KEY)" value={env.harnessRouterKeyConfigured ? "configured" : "not configured"} ok={env.harnessRouterKeyConfigured} />
            <Row label="Live execution allowed" value={env.liveExecutionAllowed ? "yes" : "no"} ok={env.liveExecutionAllowed || env.mode === "DEMO"} />
            <p className="pt-3 text-xs leading-relaxed text-ink-500">
              To enable live benchmarks set <code className="text-ink-300">AGENTARENA_MODE=LIVE</code>, <code className="text-ink-300">ALLOW_LIVE_EXECUTION=true</code> and{" "}
              <code className="text-ink-300">HR_API_KEY</code> in <code className="text-ink-300">.env</code>, then restart. Every live benchmark additionally requires an explicit spend confirmation.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Local environment</CardTitle>
              <CardDescription>What the evaluation engine can rely on right now.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-ink-800">
            <Row label="Database" value="connected" ok />
            <Row label="Sandbox mode" value={env.sandboxMode} ok={env.sandboxMode === "docker"} />
            <Row label="Node sandbox" value={nodeSb.available ? "ready" : (nodeSb.reason ?? "unavailable")} ok={nodeSb.available} />
            <Row label="Python sandbox" value={pySb.available ? "ready" : (pySb.reason ?? "unavailable")} ok={pySb.available} />
            <Row label="Max concurrent runs (server)" value={env.maxConcurrentRuns} />
            <Row label="Default run timeout" value={`${env.defaultRunTimeoutSeconds}s`} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Agent configurations</CardTitle>
              <CardDescription>
                {ctx.mode === "LIVE"
                  ? "Discover configured agents from your HarnessRouter workspace (read-only, no cost) and register them for benchmarking."
                  : "Demo mode uses three simulated agents. Switch to LIVE mode to register HarnessRouter agents."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="mb-4 divide-y divide-ink-800 rounded-lg border border-ink-800">
              {agents.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: a.color }} aria-hidden />
                    {a.name}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={a.provider === "SIMULATED" ? "warning" : "violet"}>{a.provider === "SIMULATED" ? "simulated" : "HarnessRouter"}</Badge>
                    <Badge>{a.mode}</Badge>
                    {a.model && <Badge tone="blue">{a.model}</Badge>}
                    {a.languages.map((l) => (
                      <Badge key={l}>{LANGUAGE_LABEL[l]}</Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {ctx.mode === "LIVE" && <AgentManager keyConfigured={env.harnessRouterKeyConfigured} />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Benchmark defaults · scoring</CardTitle>
              <CardDescription>Default “Balanced” weights. Profiles shift weight toward correctness, speed or cost.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="max-w-xl">
            <ScoringWeights profile="BALANCED" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

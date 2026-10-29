import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, Coins, FlaskConical, Gauge, Layers, Timer } from "lucide-react";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getDashboardData, loadRunRecords } from "@/lib/services/queries";
import { aggregateByAgent, repeatedFailures } from "@/lib/analytics/aggregate";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { CostSourceTag, SimulatedTag, StatusBadge } from "@/components/status";
import { AgentBars } from "@/components/charts/agent-bars";
import { CATEGORY_LABEL, LANGUAGE_LABEL, formatDuration, formatPercent, formatRelative, formatUsd } from "@/lib/utils";

export default async function DashboardPage() {
  const mode = getEnv().AGENTARENA_MODE;
  const [data, records] = await Promise.all([getDashboardData(prisma, mode), loadRunRecords(prisma, mode)]);
  const aggs = aggregateByAgent(records).sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0));
  const failures = repeatedFailures(aggs);
  const simulated = mode === "DEMO";

  const stats = [
    { label: "Benchmarks", value: String(data.totalBenchmarks), sub: data.runningBenchmarks ? `${data.runningBenchmarks} running` : "all settled", icon: Layers },
    { label: "Completed runs", value: String(data.completedRuns), sub: `of ${data.finishedRuns} finished`, icon: CheckCircle2 },
    { label: "Run success rate", value: formatPercent(data.successRate), sub: "completed ÷ finished", icon: Gauge },
    { label: "Avg. run duration", value: formatDuration(data.avgDurationMs), sub: "completed runs, app-measured", icon: Timer },
    {
      label: "Observed cost",
      value: formatUsd(data.totalCostUsd),
      sub: data.totalTokens ? `${data.totalTokens.toLocaleString()} tokens` : "no usage reported",
      icon: Coins,
      tag: data.costSources[0],
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Agent benchmarking dashboard"
        description="Measure what coding agents actually accomplish — tests passed, time taken, cost incurred — and route future tasks on that evidence."
        actions={
          <Button asChild variant="primary">
            <Link href="/benchmarks/new">
              <FlaskConical aria-hidden /> New benchmark
            </Link>
          </Button>
        }
      />

      <section aria-label="Key metrics" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between text-ink-400">
              <span className="text-xs">{s.label}</span>
              <s.icon className="size-4 text-ink-500" aria-hidden />
            </div>
            <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{s.value}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
              {s.sub}
              {s.tag && <CostSourceTag source={s.tag} />}
            </div>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Agent performance</CardTitle>
              <CardDescription>Mean weighted score per agent configuration across all scored runs.</CardDescription>
            </div>
            {simulated && <SimulatedTag />}
          </CardHeader>
          <CardContent>
            {aggs.length === 0 ? (
              <EmptyState icon={<Activity className="size-5" />} title="No scored runs yet" description="Run a benchmark to populate performance data." />
            ) : (
              <>
                <AgentBars data={aggs.map((a) => ({ name: a.agentName, value: a.meanScore, color: a.agentColor }))} height={Math.max(140, aggs.length * 52)} />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-ink-500">
                      <tr>
                        <th className="py-2 font-medium">Agent</th>
                        <th className="py-2 font-medium">Runs</th>
                        <th className="py-2 font-medium">Pass rate</th>
                        <th className="py-2 font-medium">Success</th>
                        <th className="py-2 font-medium">Median time</th>
                      </tr>
                    </thead>
                    <tbody className="tabular divide-y divide-ink-800 text-ink-200">
                      {aggs.map((a) => (
                        <tr key={a.agentId}>
                          <td className="py-2">
                            <span className="mr-2 inline-block size-2 rounded-full" style={{ background: a.agentColor }} aria-hidden />
                            {a.agentName}
                          </td>
                          <td className="py-2">
                            {a.runs}
                            {a.lowSample && <span className="ml-1 text-warning" title="Fewer than 3 scored runs">*</span>}
                          </td>
                          <td className="py-2">{formatPercent(a.meanCorrectness)}</td>
                          <td className="py-2">{formatPercent(a.successRate)}</td>
                          <td className="py-2">{formatDuration(a.medianDurationMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Latest benchmarks in {mode.toLowerCase()} mode.</CardDescription>
            </div>
            <Link href="/benchmarks" className="text-xs text-electric hover:underline">
              View all
            </Link>
          </CardHeader>
          <ul className="divide-y divide-ink-800">
            {data.recent.length === 0 && (
              <li>
                <EmptyState title="Nothing here yet" description="Launch your first benchmark." />
              </li>
            )}
            {data.recent.map((b) => (
              <li key={b.id}>
                <Link href={`/benchmarks/${b.id}`} className="group flex items-start justify-between gap-3 px-5 py-3 hover:bg-ink-850">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-200 group-hover:text-ink-100">{b.task.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                      {LANGUAGE_LABEL[b.task.language]} · {CATEGORY_LABEL[b.task.category]} · {formatRelative(b.createdAt)}
                    </p>
                    <div className="mt-1.5 flex gap-1">
                      {b.runs.map((r, i) => (
                        <span key={i} className="size-1.5 rounded-full" style={{ background: r.agent.color }} title={`${r.agent.name}: ${r.status}`} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    <ArrowRight className="size-3.5 text-ink-600 group-hover:text-ink-300" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {failures.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle>Repeated failure patterns</CardTitle>
              <CardDescription>Same agent, same error code, two or more times.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {failures.map((f) => (
              <Badge key={`${f.agentName}-${f.code}`} tone="danger">
                {f.agentName} · {f.code} × {f.count}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-[11px] text-ink-500">
        Scores use product-default weights, not scientifically validated weights. * marks agents with fewer than 3 scored runs.
      </p>
    </>
  );
}

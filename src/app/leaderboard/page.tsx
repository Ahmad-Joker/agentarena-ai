import type { Metadata } from "next";
import { AlertTriangle, Medal } from "lucide-react";
import { getRequestContext } from "@/lib/api";
import { loadRunRecords } from "@/lib/services/queries";
import { aggregateByAgent, MIN_SAMPLES } from "@/lib/analytics/aggregate";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { SimulatedTag } from "@/components/status";
import { AgentBars } from "@/components/charts/agent-bars";
import { CATEGORIES, LANGUAGES, PROFILES } from "@/lib/domain/schemas";
import { PROFILE_LABEL } from "@/lib/evaluation/scoring";
import { CATEGORY_LABEL, LANGUAGE_LABEL, cn, formatDuration, formatPercent, formatScore, formatUsd } from "@/lib/utils";

export const metadata: Metadata = { title: "Leaderboard" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function LeaderboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const language = one(sp.language);
  const category = one(sp.category);
  const profile = one(sp.profile);
  const model = one(sp.model)?.slice(0, 128);
  const sinceRaw = one(sp.since);
  const since = sinceRaw && /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? new Date(`${sinceRaw}T00:00:00Z`) : undefined;

  const records = await loadRunRecords(ctx.prisma, ctx.mode, {
    language: language && (LANGUAGES as readonly string[]).includes(language) ? language : undefined,
    category: category && (CATEGORIES as readonly string[]).includes(category) ? category : undefined,
    profile: profile && (PROFILES as readonly string[]).includes(profile) ? profile : undefined,
    model,
    since,
  });
  const models = [...new Set(records.map((r) => r.model).filter((m): m is string => Boolean(m)))];
  const aggs = aggregateByAgent(records).sort((a, b) => {
    if (a.lowSample !== b.lowSample) return a.lowSample ? 1 : -1;
    return (b.meanScore ?? -1) - (a.meanScore ?? -1);
  });
  const anyLow = aggs.some((a) => a.lowSample);

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Leaderboard"
        description="Historical performance per agent configuration. Rankings are only as good as their sample sizes — small samples are flagged and listed last."
        actions={ctx.mode === "DEMO" ? <SimulatedTag /> : undefined}
      />
      <FilterBar
        action="/leaderboard"
        fields={[
          { name: "language", label: "Language", value: language, options: LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l]! })) },
          { name: "category", label: "Category", value: category, options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c]! })) },
          { name: "profile", label: "Profile", value: profile, options: PROFILES.map((p) => ({ value: p, label: PROFILE_LABEL[p] })) },
          { name: "model", label: "Model", value: model, options: models.map((m) => ({ value: m, label: m })) },
          { name: "since", label: "Since", value: sinceRaw, type: "date" },
        ]}
      />

      {aggs.length === 0 ? (
        <Card>
          <EmptyState icon={<Medal className="size-5" />} title="No scored runs for these filters" description="Broaden the filters or run more benchmarks." />
        </Card>
      ) : (
        <div className="space-y-6">
          {anyLow && (
            <Callout tone="warning" icon={<AlertTriangle />}>
              Agents with fewer than {MIN_SAMPLES} scored runs in this slice are ranked last and marked “low sample”. Do not draw conclusions from them.
            </Callout>
          )}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ranking</CardTitle>
                <CardDescription>Ordered by mean weighted score. The pass-rate interval is a 95% Wilson interval on run success.</CardDescription>
              </div>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-ink-800 text-xs text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Rank</th>
                    <th className="py-3 font-medium">Agent</th>
                    <th className="py-3 font-medium">Runs</th>
                    <th className="py-3 font-medium">Mean score</th>
                    <th className="py-3 font-medium">Pass rate</th>
                    <th className="py-3 font-medium">Success (95% CI)</th>
                    <th className="py-3 font-medium">Median time</th>
                    <th className="py-3 pr-5 font-medium">Mean cost</th>
                  </tr>
                </thead>
                <tbody className="tabular divide-y divide-ink-800">
                  {aggs.map((a, i) => (
                    <tr key={a.agentId} className={cn(a.lowSample && "opacity-60")}>
                      <td className="px-5 py-3 font-mono text-ink-400">{a.lowSample ? "—" : i + 1}</td>
                      <td className="py-3">
                        <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: a.agentColor }} aria-hidden />
                        {a.agentName}
                        {a.lowSample && <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">low sample</span>}
                      </td>
                      <td className="py-3">{a.runs}</td>
                      <td className="py-3 font-mono text-ink-100">{formatScore(a.meanScore)}</td>
                      <td className="py-3">{formatPercent(a.meanCorrectness)}</td>
                      <td className="py-3 text-xs">
                        {formatPercent(a.successRate)}{" "}
                        {a.successInterval && (
                          <span className="text-ink-500">
                            [{formatPercent(a.successInterval.low)}–{formatPercent(a.successInterval.high)}]
                          </span>
                        )}
                      </td>
                      <td className="py-3">{formatDuration(a.medianDurationMs)}</td>
                      <td className="py-3 pr-5 text-xs">
                        {formatUsd(a.meanCostUsd)}
                        {a.costSources.includes("SIMULATED") && <span className="ml-1 text-warning">sim</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Mean test pass rate</CardTitle>
              </CardHeader>
              <CardContent>
                <AgentBars data={aggs.map((a) => ({ name: a.agentName, value: a.meanCorrectness, color: a.agentColor }))} format="percent" height={Math.max(140, aggs.length * 50)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Median duration of completed runs</CardTitle>
              </CardHeader>
              <CardContent>
                <AgentBars
                  data={aggs.map((a) => ({ name: a.agentName, value: a.medianDurationMs !== null ? a.medianDurationMs / 1000 : null, color: a.agentColor }))}
                  format="seconds"
                  height={Math.max(140, aggs.length * 50)}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

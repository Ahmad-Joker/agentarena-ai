"use client";

import { useState } from "react";
import { AlertTriangle, Download, FileCode2, Info, Loader2, ShieldAlert, Trophy } from "lucide-react";
import type { BenchmarkDto, RunDto } from "@/lib/services/dto";
import { Badge, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { CostSourceTag, StatusBadge } from "@/components/status";
import { ScoreBreakdownChart } from "@/components/charts/score-breakdown";
import { ScoringWeights } from "./scoring-weights";
import { cn, formatDuration, formatPercent, formatScore, formatUsd } from "@/lib/utils";

export function ResultsPanel({ data, evaluating }: { data: BenchmarkDto; evaluating: boolean }) {
  const ranked = [...data.runs].sort((a, b) => {
    if (a.id === data.winnerRunId) return -1;
    if (b.id === data.winnerRunId) return 1;
    const ga = a.evaluation?.evidence?.gates?.length ? 1 : 0;
    const gb = b.evaluation?.evidence?.gates?.length ? 1 : 0;
    if (ga !== gb) return ga - gb;
    return (b.evaluation?.totalScore ?? -1) - (a.evaluation?.totalScore ?? -1);
  });
  const winner = data.runs.find((r) => r.id === data.winnerRunId);
  const runnerUp = ranked.find((r) => r.id !== data.winnerRunId && r.evaluation?.totalScore !== null && r.evaluation?.totalScore !== undefined);
  const [selected, setSelected] = useState(ranked[0]?.id);
  const current = data.runs.find((r) => r.id === selected) ?? ranked[0];

  if (evaluating && !winner) {
    return (
      <Callout tone="info" icon={<Loader2 className="animate-spin" />}>
        Evaluating solutions in the sandbox…
      </Callout>
    );
  }

  return (
    <section aria-label="Results" className="space-y-6">
      {winner?.evaluation ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 bg-gradient-to-r from-success/10 via-transparent to-transparent p-5 sm:flex-row sm:items-center">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/30">
              <Trophy className="size-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-success">Recommended for this task</p>
              <p className="text-lg font-semibold">{winner.agent.name}</p>
              <p className="mt-1 text-sm text-ink-300">{explainWin(winner, runnerUp)}</p>
            </div>
            <div className="text-right">
              <p className="tabular font-mono text-3xl font-semibold text-ink-100">{formatScore(winner.evaluation.totalScore)}</p>
              <p className="text-[11px] text-ink-500">evidence coverage {formatPercent(winner.evaluation.coverage)}</p>
            </div>
          </div>
        </Card>
      ) : (
        <Callout tone="warning" icon={<AlertTriangle />}>
          No run produced a scorable result, so no recommendation is made for this benchmark.
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Agent comparison</CardTitle>
              <CardDescription>Measured outcomes. “—” means not measured, which is never counted as zero.</CardDescription>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-ink-800 text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Agent</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Score</th>
                  <th className="px-3 py-2.5 font-medium">Tests</th>
                  <th className="px-3 py-2.5 font-medium">Duration</th>
                  <th className="px-3 py-2.5 font-medium">Cost</th>
                  <th className="px-3 py-2.5 pr-5 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-ink-800">
                {ranked.map((r, i) => (
                  <tr key={r.id} className={cn("cursor-pointer hover:bg-ink-850", selected === r.id && "bg-ink-850")} onClick={() => setSelected(r.id)}>
                    <td className="px-5 py-3 text-ink-500">{i + 1}</td>
                    <td className="px-3 py-3">
                      <button type="button" className="flex items-center gap-2 text-left text-ink-100" onClick={() => setSelected(r.id)} aria-pressed={selected === r.id}>
                        <span className="size-2 rounded-full" style={{ background: r.agent.color }} aria-hidden />
                        {r.agent.name}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-3 font-mono text-sm text-ink-100">{formatScore(r.evaluation?.totalScore)}</td>
                    <td className="px-3 py-3">{r.evaluation ? `${r.evaluation.testsPassed}/${r.evaluation.testsPassed + r.evaluation.testsFailed + r.evaluation.testsSkipped}` : "—"}</td>
                    <td className="px-3 py-3">{formatDuration(r.durationMs)}</td>
                    <td className="px-3 py-3">
                      <span className="mr-1.5">{formatUsd(r.costUsd)}</span>
                      <CostSourceTag source={r.costSource} />
                    </td>
                    <td className="px-3 py-3 pr-5">
                      <div className="flex flex-wrap gap-1">
                        {(r.evaluation?.evidence?.gates?.length ?? 0) > 0 && (
                          <Badge tone="danger">
                            <ShieldAlert className="size-3" /> security gate
                          </Badge>
                        )}
                        {r.evaluation && r.evaluation.coverage < 1 && <Badge tone="warning">coverage {formatPercent(r.evaluation.coverage)}</Badge>}
                        {r.evaluation && !r.evaluation.runtimeAvailable && <Badge tone="warning">no runtime tests</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardContent className="border-t border-ink-800">
            <ScoreBreakdownChart runs={ranked} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Scoring formula</CardTitle>
              <CardDescription>Weights frozen when this benchmark was created.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ScoringWeights weights={data.weights} />
          </CardContent>
        </Card>
      </div>

      {current && <RunEvidence run={current} />}
    </section>
  );
}

function explainWin(winner: RunDto, runnerUp: RunDto | undefined): string {
  const e = winner.evaluation!;
  const parts = [`Passed ${e.testsPassed} of ${e.testsPassed + e.testsFailed + e.testsSkipped} tests`];
  if (winner.durationMs !== null) parts.push(`in ${formatDuration(winner.durationMs)}`);
  let text = parts.join(" ");
  if (runnerUp?.evaluation?.totalScore !== null && runnerUp?.evaluation?.totalScore !== undefined) {
    const diff = (e.totalScore ?? 0) - runnerUp.evaluation.totalScore;
    text += `. Ahead of ${runnerUp.agent.name} by ${diff.toFixed(2)}`;
    if ((runnerUp.evaluation.evidence?.gates?.length ?? 0) > 0) text += ", which was ranked down by a high-severity security finding";
    else if (diff < 0.03) text += " — effectively a tie; consider repeating the benchmark";
  }
  return `${text}.`;
}

function RunEvidence({ run }: { run: RunDto }) {
  const ev = run.evaluation?.evidence;
  const artifact = run.artifacts[0];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: run.agent.color }} aria-hidden />
            Evidence · {run.agent.name}
          </CardTitle>
          <CardDescription>Everything the score was computed from. Re-scoring this evidence reproduces the total exactly.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-ink-300">Component scores</h3>
            <dl className="grid grid-cols-5 gap-2 text-center">
              {(["correctness", "reliability", "quality", "efficiency", "security"] as const).map((k) => (
                <div key={k} className="rounded-md bg-ink-850 px-1 py-2">
                  <dt className="truncate text-[10px] capitalize text-ink-500">{k}</dt>
                  <dd className="tabular font-mono text-sm">{formatScore(run.evaluation?.components[k])}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-ink-300">Test results {ev?.runtime.image && <span className="font-normal text-ink-500">· sandbox {ev.runtime.image}</span>}</h3>
            {!ev || ev.tests.length === 0 ? (
              <p className="text-xs text-ink-500">No test results.</p>
            ) : (
              <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800 text-xs">
                {ev.tests.map((t) => (
                  <li key={t.name} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-ink-200">{t.name}</p>
                      {t.status === "failed" && (
                        <p className="mt-0.5 break-all font-mono text-[10px] text-ink-500">
                          expected {JSON.stringify(t.expected)} · got {JSON.stringify(t.actual)}
                        </p>
                      )}
                      {t.error && <p className="mt-0.5 break-all font-mono text-[10px] text-danger/80">{t.error}</p>}
                    </div>
                    <Badge tone={t.status === "passed" ? "success" : t.status === "skipped" ? "neutral" : "danger"}>{t.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {ev?.runtime.limits && Object.keys(ev.runtime.limits).length > 0 && (
              <p className="mt-2 text-[10px] text-ink-500">
                Isolation: network {String(ev.runtime.limits.network)}, memory {String(ev.runtime.limits.memory)}, cpus {String(ev.runtime.limits.cpus)}, pids {String(ev.runtime.limits.pidsLimit)}, user {String(ev.runtime.limits.user)}, read-only FS.
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-ink-300">Static findings</h3>
            {!ev || ev.findings.length === 0 ? (
              <p className="text-xs text-ink-500">{ev?.artifactPresent ? "No findings. (Static checks are not proof of security.)" : "No code to analyse."}</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {ev.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge tone={f.severity === "high" ? "danger" : f.severity === "medium" ? "warning" : "neutral"}>{f.severity}</Badge>
                    <span className="text-ink-300">
                      <span className="font-mono text-ink-400">{f.ruleId}</span> {f.message}
                      {f.line ? <span className="text-ink-500"> (line {f.line})</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {ev && ev.notes.length > 0 && (
            <Callout icon={<Info />}>
              <ul className="list-disc space-y-0.5 pl-4">
                {ev.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Callout>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-300">
              <FileCode2 className="size-3.5" aria-hidden /> Artifact {artifact && <span className="font-mono font-normal text-ink-500">{artifact.path}</span>}
            </h3>
            {artifact && (
              <a href={`/api/artifacts/${artifact.id}`} className="inline-flex items-center gap-1 text-[11px] text-electric hover:underline">
                <Download className="size-3" aria-hidden /> Download
              </a>
            )}
          </div>
          {artifact?.content ? (
            <>
              <pre className="scrollbar-thin max-h-[440px] overflow-auto rounded-lg bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-ink-200 ring-1 ring-ink-800">{artifact.content}</pre>
              <p className="mt-1.5 break-all font-mono text-[10px] text-ink-500">
                source {artifact.source.toLowerCase().replace(/_/g, " ")} · {artifact.bytes} bytes · sha256 {artifact.sha256.slice(0, 16)}…
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-ink-950 p-4 text-xs text-ink-500">{run.status === "COMPLETED" ? "The agent did not return the required file." : "No artifact — the run did not complete."}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

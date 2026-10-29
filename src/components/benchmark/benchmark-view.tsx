"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Loader2, ScrollText } from "lucide-react";
import type { BenchmarkDto } from "@/lib/services/dto";
import { Badge, Button, Callout, Card, CardContent } from "@/components/ui/primitives";
import { SimulatedTag, StatusBadge } from "@/components/status";
import { ArenaColumn } from "./arena-column";
import { ResultsPanel } from "./results-panel";
import { CATEGORY_LABEL, LANGUAGE_LABEL, formatDuration } from "@/lib/utils";
import { PROFILE_LABEL } from "@/lib/evaluation/scoring";
import { cn } from "@/lib/utils";

const POLL_MS = 1000;

export function BenchmarkView({ initial }: { initial: BenchmarkDto }) {
  const [data, setData] = useState(initial);
  const [pollError, setPollError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const live = data.status === "PENDING" || data.status === "RUNNING";
  // Evaluation completes slightly after the last run finishes; keep polling until scores land.
  const awaitingEval = !live && data.runs.some((r) => !r.evaluation) && Date.now() - new Date(data.completedAt ?? data.createdAt).getTime() < 60_000;
  const failures = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/benchmarks/${data.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BenchmarkDto);
      failures.current = 0;
      setPollError(null);
    } catch {
      failures.current++;
      if (failures.current >= 3) setPollError("Lost connection to the server — retrying…");
    }
  }, [data.id]);

  useEffect(() => {
    if (!live && !awaitingEval) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [live, awaitingEval, refresh]);

  async function cancel() {
    setCancelling(true);
    await fetch(`/api/benchmarks/${data.id}/cancel`, { method: "POST" }).catch(() => undefined);
    await refresh();
    setCancelling(false);
  }

  async function cancelRun(runId: string) {
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => undefined);
    await refresh();
  }

  const totalElapsed = data.startedAt ? (data.completedAt ? new Date(data.completedAt).getTime() : Date.now()) - new Date(data.startedAt).getTime() : null;

  return (
    <div>
      <Link href="/benchmarks" className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200">
        <ArrowLeft className="size-3.5" aria-hidden /> All benchmarks
      </Link>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            {data.mode === "DEMO" ? <SimulatedTag /> : <Badge tone="success">LIVE · HarnessRouter</Badge>}
            <Badge>{LANGUAGE_LABEL[data.task.language]}</Badge>
            <Badge>{CATEGORY_LABEL[data.task.category]}</Badge>
            <Badge tone="violet">{PROFILE_LABEL[data.profile as keyof typeof PROFILE_LABEL]}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.task.title}</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-ink-400">{data.task.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right text-xs text-ink-400">
            <p>Wall clock</p>
            <p className="tabular font-mono text-base text-ink-100">{formatDuration(totalElapsed)}</p>
          </div>
          {live && (
            <Button variant="danger" onClick={cancel} disabled={cancelling} aria-label="Cancel all runs">
              {cancelling ? <Loader2 className="animate-spin" aria-hidden /> : <Ban aria-hidden />} Cancel
            </Button>
          )}
        </div>
      </header>

      {pollError && (
        <Callout tone="warning" className="mb-4">
          {pollError}
        </Callout>
      )}

      <section aria-label="Live arena" className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-200">
          {live && <span className="size-2 animate-pulse rounded-full bg-electric" aria-hidden />}
          {live ? "Live arena" : "Arena replay"}
          <span className="font-normal text-ink-500">· events as reported by each {data.mode === "DEMO" ? "simulated agent" : "HarnessRouter stream"}</span>
        </h2>
        <div className={cn("grid gap-4", data.runs.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
          {data.runs.map((run) => (
            <ArenaColumn key={run.id} run={run} isWinner={data.winnerRunId === run.id} onCancel={() => cancelRun(run.id)} />
          ))}
        </div>
      </section>

      {!live && <ResultsPanel data={data} evaluating={awaitingEval} />}

      <Card className="mt-6">
        <details>
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm text-ink-300 hover:text-ink-100">
            <ScrollText className="size-4" aria-hidden /> Fairness audit — the exact prompt every agent received
          </summary>
          <CardContent className="border-t border-ink-700/60">
            <pre className="scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950 p-4 font-mono text-xs text-ink-300">{data.promptSnapshot}</pre>
            <p className="mt-2 text-[11px] text-ink-500">
              Limits: {data.timeoutSeconds}s per run · max {data.maxConcurrency} concurrent{data.maxCostUsd ? ` · max_cost_usd ${data.maxCostUsd}` : ""} · {data.task.testCount} hidden test cases.
            </p>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertOctagon, Ban, Bot, CheckCircle2, Cog, MessageSquareText, Radio, Trophy, Wrench } from "lucide-react";
import type { RunDto } from "@/lib/services/dto";
import { Badge, Button } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status";
import { cn, formatDuration, formatScore } from "@/lib/utils";

const KIND_ICON: Record<string, React.ReactNode> = {
  lifecycle: <Radio className="size-3" />,
  progress: <Cog className="size-3" />,
  tool: <Wrench className="size-3" />,
  output: <MessageSquareText className="size-3" />,
  status: <CheckCircle2 className="size-3" />,
  error: <AlertOctagon className="size-3" />,
  system: <Bot className="size-3" />,
};

function useElapsed(startedAt: string | null, endedAt: string | null, durationMs: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [startedAt, endedAt]);
  if (durationMs !== null) return durationMs;
  return startedAt ? now - new Date(startedAt).getTime() : null;
}

export function ArenaColumn({ run, isWinner, onCancel }: { run: RunDto; isWinner: boolean; onCancel: () => void }) {
  const elapsed = useElapsed(run.startedAt, run.endedAt, run.durationMs);
  const logRef = useRef<HTMLOListElement>(null);
  const active = run.status === "RUNNING" || run.status === "PENDING";

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.events.length]);

  // Collapse streamed text deltas into one growing "output" entry for readability.
  const entries: Array<{ key: string; kind: string; message: string }> = [];
  for (const e of run.events) {
    const last = entries[entries.length - 1];
    if (e.kind === "output" && last?.kind === "output") last.message += e.message;
    else entries.push({ key: String(e.seq), kind: e.kind, message: e.message });
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-label={`${run.agent.name} run`}
      className={cn(
        "flex min-h-[420px] flex-col overflow-hidden rounded-xl border bg-ink-900/80",
        isWinner ? "border-success/50 shadow-[0_0_40px_-12px_rgb(52_211_153/0.5)]" : "border-ink-700/80",
      )}
    >
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${run.agent.color}, transparent)` }} aria-hidden />
      <header className="flex items-start justify-between gap-3 border-b border-ink-700/60 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold leading-snug">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: run.agent.color }} aria-hidden />
            {run.agent.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-ink-500">
            {run.agent.provider === "SIMULATED" ? "simulated agent" : `${run.agent.base ?? "harness"} · ${run.agent.model ?? "default model"}`}
            {run.attempt > 1 && ` · attempt ${run.attempt}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={run.status} />
          {isWinner && (
            <Badge tone="success">
              <Trophy className="size-3" /> Winner
            </Badge>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 divide-x divide-ink-800 border-b border-ink-800 text-center">
        <Metric label="Elapsed" value={formatDuration(elapsed)} live={active && run.status === "RUNNING"} />
        <Metric label="Tests" value={run.evaluation ? `${run.evaluation.testsPassed}/${run.evaluation.testsPassed + run.evaluation.testsFailed + run.evaluation.testsSkipped}` : "—"} />
        <Metric label="Score" value={formatScore(run.evaluation?.totalScore)} />
      </div>

      <ol ref={logRef} className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px]" aria-live="polite" aria-label="Event log" style={{ maxHeight: 260 }}>
        {entries.length === 0 && <li className="text-ink-500">{run.status === "PENDING" ? "Waiting for a free execution slot…" : "No events yet."}</li>}
        {entries.map((e) => (
          <li key={e.key} className={cn("flex gap-2", e.kind === "error" ? "text-danger" : e.kind === "output" ? "text-ink-200" : "text-ink-400")}>
            <span className="mt-0.5 shrink-0 opacity-70">{KIND_ICON[e.kind] ?? <Cog className="size-3" />}</span>
            <span className={cn("min-w-0", e.kind === "output" ? "line-clamp-3 whitespace-pre-wrap break-words" : "break-words")}>{e.message}</span>
          </li>
        ))}
      </ol>

      {(run.status === "FAILED" || run.status === "TIMED_OUT" || run.status === "CANCELLED") && (
        <div role="alert" className={cn("mx-4 mb-3 rounded-md px-3 py-2 text-xs", run.status === "FAILED" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
          <span className="font-mono">{run.errorCode ?? run.status.toLowerCase()}</span>
          {run.errorMessage ? ` — ${run.errorMessage}` : ""}
        </div>
      )}

      {active && (
        <div className="border-t border-ink-800 px-4 py-2.5">
          <Button size="sm" variant="ghost" onClick={onCancel} className="w-full">
            <Ban aria-hidden /> Cancel this run
          </Button>
        </div>
      )}
    </motion.article>
  );
}

function Metric({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="px-2 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className={cn("tabular font-mono text-sm", live ? "text-electric" : "text-ink-100")}>{value}</p>
    </div>
  );
}

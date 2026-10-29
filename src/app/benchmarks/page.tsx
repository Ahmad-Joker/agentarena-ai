import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, History } from "lucide-react";
import { getRequestContext } from "@/lib/api";
import { listBenchmarks } from "@/lib/services/queries";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { Button, Card, EmptyState } from "@/components/ui/primitives";
import { SimulatedTag, StatusBadge } from "@/components/status";
import { CATEGORIES, LANGUAGES } from "@/lib/domain/schemas";
import { CATEGORY_LABEL, LANGUAGE_LABEL, formatDuration, formatRelative, formatScore } from "@/lib/utils";

export const metadata: Metadata = { title: "Benchmark history" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function HistoryPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await getRequestContext();
  const filters = {
    status: one(sp.status),
    language: one(sp.language),
    category: one(sp.category),
    q: one(sp.q)?.slice(0, 100),
  };
  const rows = await listBenchmarks(ctx.prisma, ctx.mode, {
    status: filters.status && ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].includes(filters.status) ? filters.status : undefined,
    language: filters.language && (LANGUAGES as readonly string[]).includes(filters.language) ? filters.language : undefined,
    category: filters.category && (CATEGORIES as readonly string[]).includes(filters.category) ? filters.category : undefined,
    q: filters.q,
  });

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Benchmark history"
        description="Every benchmark is persisted with its prompt, runs, events, artifacts and evaluation evidence."
        actions={
          <Button asChild variant="primary">
            <Link href="/benchmarks/new">
              <FlaskConical aria-hidden /> New benchmark
            </Link>
          </Button>
        }
      />
      <FilterBar
        action="/benchmarks"
        fields={[
          { name: "q", label: "Search title", value: filters.q, placeholder: "e.g. auth" },
          { name: "status", label: "Status", value: filters.status, options: ["COMPLETED", "FAILED", "CANCELLED", "RUNNING", "PENDING"].map((s) => ({ value: s, label: s.toLowerCase() })) },
          { name: "language", label: "Language", value: filters.language, options: LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l]! })) },
          { name: "category", label: "Category", value: filters.category, options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c]! })) },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<History className="size-5" />} title="No benchmarks match" description="Adjust the filters or launch a new benchmark." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-ink-800 text-xs text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Task</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 font-medium">Agents</th>
                  <th className="py-3 font-medium">Best score</th>
                  <th className="py-3 font-medium">Fastest</th>
                  <th className="py-3 pr-5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-ink-800">
                {rows.map((b) => {
                  const scores = b.runs.map((r) => r.evaluation?.totalScore).filter((s): s is number => typeof s === "number");
                  const durations = b.runs.filter((r) => r.status === "COMPLETED" && r.durationMs !== null).map((r) => r.durationMs!);
                  return (
                    <tr key={b.id} className="group hover:bg-ink-850">
                      <td className="px-5 py-3">
                        <Link href={`/benchmarks/${b.id}`} className="font-medium text-ink-100 group-hover:text-electric">
                          {b.task.title}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {LANGUAGE_LABEL[b.task.language]} · {CATEGORY_LABEL[b.task.category]} · {b.profile.toLowerCase()}
                        </p>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={b.status} />
                          {b.mode === "DEMO" && <SimulatedTag />}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex -space-x-1">
                          {b.runs.map((r) => (
                            <span key={r.id} className="size-3 rounded-full ring-2 ring-ink-900" style={{ background: r.agent.color }} title={`${r.agent.name}: ${r.status}`} />
                          ))}
                        </div>
                      </td>
                      <td className="py-3 font-mono">{formatScore(scores.length ? Math.max(...scores) : null)}</td>
                      <td className="py-3 font-mono text-xs">{formatDuration(durations.length ? Math.min(...durations) : null)}</td>
                      <td className="py-3 pr-5 text-xs text-ink-400">{formatRelative(b.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

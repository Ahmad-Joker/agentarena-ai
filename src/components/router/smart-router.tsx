"use client";

import { useState } from "react";
import { AlertTriangle, Compass, Loader2, Sparkles, Tags } from "lucide-react";
import { motion } from "framer-motion";
import { CATEGORIES, LANGUAGES, PROFILES, type Profile } from "@/lib/domain/schemas";
import { PROFILE_LABEL } from "@/lib/evaluation/scoring";
import type { RoutingDecision } from "@/lib/routing/engine";
import type { Classification } from "@/lib/routing/classifier";
import { Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Select, Textarea } from "@/components/ui/primitives";
import { SimulatedTag } from "@/components/status";
import { CATEGORY_LABEL, LANGUAGE_LABEL, cn, formatDuration, formatPercent } from "@/lib/utils";

interface RouteResponse {
  mode: "DEMO" | "LIVE";
  classification: Classification;
  resolved: { language?: string; category?: string };
  decision: RoutingDecision;
}

const EXAMPLES = [
  "Fix the session expiry bug in our TypeScript auth middleware without breaking tests",
  "Write a Python function that merges overlapping time intervals",
  "Parse ISO-like duration strings in TypeScript",
];

const CONF_TONE = { HIGH: "success", MEDIUM: "blue", LOW: "warning", INSUFFICIENT: "danger" } as const;

export function SmartRouter({ mode }: { mode: "DEMO" | "LIVE" }) {
  const [description, setDescription] = useState(EXAMPLES[0]!);
  const [objective, setObjective] = useState<Profile>("BALANCED");
  const [language, setLanguage] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResponse | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/router", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, objective, language: language || undefined, category: category || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Routing failed");
      setResult(body as RouteResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Routing failed");
    } finally {
      setLoading(false);
    }
  }

  const d = result?.decision;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Describe the task</CardTitle>
            <CardDescription>No model is called; classification is deterministic.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="desc">Task description</Label>
              <Textarea id="desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setDescription(ex)} className="rounded-md bg-ink-850 px-2 py-1 text-left text-[10px] text-ink-400 hover:text-ink-200">
                    {ex.slice(0, 48)}…
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Optimise for</Label>
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Objective">
                {PROFILES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={objective === p}
                    onClick={() => setObjective(p)}
                    className={cn("rounded-md px-2 py-1.5 text-xs", objective === p ? "bg-violet/20 text-violet-soft ring-1 ring-violet/50" : "bg-ink-850 text-ink-400 hover:text-ink-200")}
                  >
                    {PROFILE_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="lang">Language override</Label>
                <Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="text-xs">
                  <option value="">Auto-detect</option>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="cat">Category override</Label>
                <Select id="cat" value={category} onChange={(e) => setCategory(e.target.value)} className="text-xs">
                  <option value="">Auto-detect</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button type="submit" variant="primary" className="w-full" disabled={loading || description.trim().length < 5}>
              {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Compass aria-hidden />} Recommend an agent
            </Button>
            {error && <Callout tone="danger">{error}</Callout>}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4 lg:col-span-3" aria-live="polite">
        {!result && (
          <Card className="grid h-full min-h-72 place-items-center p-8 text-center">
            <div>
              <Sparkles className="mx-auto mb-3 size-6 text-violet-soft" aria-hidden />
              <p className="text-sm text-ink-300">Recommendations are computed from {mode === "DEMO" ? "simulated demo" : "live"} benchmark history only.</p>
              <p className="mt-1 text-xs text-ink-500">Without enough evidence the router says so instead of guessing.</p>
            </div>
          </Card>
        )}

        {result && d && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <Card className="p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-300">
                <Tags className="size-3.5" aria-hidden /> Task classification
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="blue">{result.resolved.language ? LANGUAGE_LABEL[result.resolved.language] : "language unknown"}</Badge>
                <Badge tone="violet">{result.resolved.category ? CATEGORY_LABEL[result.resolved.category] : "category unknown"}</Badge>
                {mode === "DEMO" && <SimulatedTag />}
              </div>
              {result.classification.signals.length > 0 && (
                <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-ink-500">
                  {result.classification.signals.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </Card>

            {d.sufficient && d.recommended ? (
              <Card className="overflow-hidden">
                <div className="bg-gradient-to-r from-violet/15 via-electric/5 to-transparent p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-violet-soft">Recommended agent</p>
                      <p className="mt-1 text-xl font-semibold">{d.recommended.agentName}</p>
                    </div>
                    <div className="text-right">
                      <Badge tone={CONF_TONE[d.confidence]}>{d.confidence.toLowerCase()} confidence</Badge>
                      <p className="tabular mt-2 font-mono text-2xl">{d.recommended.suitability.toFixed(2)}</p>
                      <p className="text-[10px] text-ink-500">estimated suitability</p>
                    </div>
                  </div>
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-ink-300">
                    {d.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {d.alternative && (
                    <p className="mt-3 text-xs text-ink-400">
                      Alternative: <span className="text-ink-200">{d.alternative.agentName}</span> ({d.alternative.suitability.toFixed(2)})
                    </p>
                  )}
                </div>
                <CardContent className="border-t border-ink-800">
                  <p className="mb-2 font-mono text-[11px] text-ink-400">{d.formula}</p>
                  <p className="mb-3 text-[11px] text-ink-500">Evidence scope: {d.scope}</p>
                  <table className="w-full text-left text-xs">
                    <thead className="text-ink-500">
                      <tr>
                        <th className="py-1.5 font-medium">Agent</th>
                        <th className="py-1.5 font-medium">Runs</th>
                        <th className="py-1.5 font-medium">Pass rate</th>
                        <th className="py-1.5 font-medium">Median time</th>
                        <th className="py-1.5 text-right font-medium">Suitability</th>
                      </tr>
                    </thead>
                    <tbody className="tabular divide-y divide-ink-800">
                      {d.ranking.map((c) => (
                        <tr key={c.agentId}>
                          <td className="py-1.5">{c.agentName}</td>
                          <td className="py-1.5">{c.metrics.runs}</td>
                          <td className="py-1.5">{formatPercent(c.metrics.meanCorrectness)}</td>
                          <td className="py-1.5">{formatDuration(c.metrics.medianDurationMs)}</td>
                          <td className="py-1.5 text-right font-mono">{c.suitability.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : (
              <Callout tone="warning" icon={<AlertTriangle />}>
                <p className="font-medium">{d.message}</p>
                {d.reasons.map((r) => (
                  <p key={r} className="mt-1">
                    {r}
                  </p>
                ))}
              </Callout>
            )}

            {d.caveats.length > 0 && (
              <Callout icon={<AlertTriangle />}>
                <ul className="list-disc space-y-0.5 pl-4">
                  {d.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </Callout>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

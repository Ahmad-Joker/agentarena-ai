"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileCode2, Loader2, Rocket, ShieldAlert } from "lucide-react";
import { CATEGORIES, LANGUAGES, PROFILES, taskInputSchema, testCaseSchema, type Profile, type TaskInput } from "@/lib/domain/schemas";
import { PROFILE_LABEL } from "@/lib/evaluation/scoring";
import { Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { ScoringWeights } from "./scoring-weights";
import { CATEGORY_LABEL, LANGUAGE_LABEL, cn } from "@/lib/utils";
import { z } from "zod";

interface AgentOption {
  id: string;
  name: string;
  description: string | null;
  provider: "SIMULATED" | "HARNESSROUTER";
  model: string | null;
  base: string | null;
  languages: string[];
  color: string;
}

interface Props {
  mode: "DEMO" | "LIVE";
  liveAllowed: boolean;
  agents: AgentOption[];
  templates: Array<{ key: string; task: TaskInput }>;
  defaults: { timeoutSeconds: number; maxConcurrency: number };
}

const EMPTY_TASK: TaskInput = {
  title: "",
  description: "",
  language: "TYPESCRIPT",
  category: "OTHER",
  starterFiles: [],
  entryFile: "solution.ts",
  entryFunction: "solve",
  expectedBehavior: "",
  testSpec: [],
};

export function NewBenchmarkForm({ mode, liveAllowed, agents, templates, defaults }: Props) {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState<string>(templates[0]?.key ?? "custom");
  const [task, setTask] = useState<TaskInput>(templates[0]?.task ?? EMPTY_TASK);
  const [testsJson, setTestsJson] = useState(JSON.stringify(templates[0]?.task.testSpec ?? [], null, 2));
  const [starterPath, setStarterPath] = useState(templates[0]?.task.starterFiles[0]?.path ?? "");
  const [starterContent, setStarterContent] = useState(templates[0]?.task.starterFiles[0]?.content ?? "");
  const [selected, setSelected] = useState<string[]>(agents.slice(0, 3).map((a) => a.id));
  const [profile, setProfile] = useState<Profile>("BALANCED");
  const [timeoutSeconds, setTimeoutSeconds] = useState(defaults.timeoutSeconds);
  const [maxConcurrency, setMaxConcurrency] = useState(Math.max(1, Math.min(defaults.maxConcurrency, 3)));
  const [maxCostUsd, setMaxCostUsd] = useState<string>("1");
  const [confirmSpend, setConfirmSpend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = templates.find((x) => x.key === key)?.task ?? EMPTY_TASK;
    setTask(t);
    setTestsJson(JSON.stringify(t.testSpec, null, 2));
    setStarterPath(t.starterFiles[0]?.path ?? "");
    setStarterContent(t.starterFiles[0]?.content ?? "");
  };

  const testsParse = useMemo(() => {
    try {
      return z.array(testCaseSchema).max(50).safeParse(JSON.parse(testsJson || "[]"));
    } catch {
      return { success: false as const, error: new z.ZodError([{ code: "custom", path: [], message: "Invalid JSON" }]) };
    }
  }, [testsJson]);

  const compatible = (a: AgentOption) => a.languages.includes(task.language);
  const chosen = selected.filter((id) => agents.some((a) => a.id === id && compatible(a)));
  const isCustom = templateKey === "custom";

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const update = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => setTask((t) => ({ ...t, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!testsParse.success) return setError("Fix the test specification JSON first.");
    const candidate = {
      ...task,
      starterFiles: starterPath.trim() ? [{ path: starterPath.trim(), content: starterContent }] : [],
      testSpec: testsParse.data,
    };
    const parsed = taskInputSchema.safeParse(candidate);
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "));
    if (chosen.length < 2) return setError("Select at least two compatible agents.");
    if (mode === "LIVE" && !confirmSpend) return setError("Confirm that this live benchmark may incur cost.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: parsed.data,
          agentIds: chosen,
          profile,
          timeoutSeconds,
          maxConcurrency,
          maxCostUsd: mode === "LIVE" && maxCostUsd ? Number(maxCostUsd) : undefined,
          confirmLiveSpend: mode === "LIVE" ? confirmSpend : false,
        }),
      });
      const body = (await res.json()) as { id?: string; error?: { message: string; issues?: Array<{ path: string; message: string }> } };
      if (!res.ok || !body.id) {
        setError(body.error?.issues?.map((i) => `${i.path}: ${i.message}`).join(" · ") || body.error?.message || "Could not start the benchmark.");
        setSubmitting(false);
        return;
      }
      router.push(`/benchmarks/${body.id}`);
    } catch {
      setError("Network error — is the server running?");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3" noValidate>
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>1 · Task</CardTitle>
              <CardDescription>Start from a built-in, objectively testable task or define your own.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Task template">
              {templates.map((t) => (
                <button
                  type="button"
                  key={t.key}
                  role="radio"
                  aria-checked={templateKey === t.key}
                  onClick={() => applyTemplate(t.key)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    templateKey === t.key ? "border-violet/60 bg-violet/10" : "border-ink-700 bg-ink-850 hover:border-ink-500",
                  )}
                >
                  <p className="line-clamp-2 text-xs font-medium text-ink-100">{t.task.title}</p>
                  <p className="mt-1 text-[10px] text-ink-400">
                    {LANGUAGE_LABEL[t.task.language]} · {CATEGORY_LABEL[t.task.category]} · {t.task.testSpec.length} tests
                  </p>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={isCustom}
                onClick={() => applyTemplate("custom")}
                className={cn("rounded-lg border border-dashed p-3 text-left", isCustom ? "border-violet/60 bg-violet/10" : "border-ink-600 hover:border-ink-500")}
              >
                <p className="text-xs font-medium text-ink-100">Custom task</p>
                <p className="mt-1 text-[10px] text-ink-400">Write your own spec and tests</p>
              </button>
            </div>

            {isCustom && mode === "DEMO" && (
              <Callout tone="warning" icon={<AlertTriangle />}>
                Simulated agents only carry solutions for the built-in tasks. On a custom task they return a stub, so every test fails — useful to see the failure path, not to compare agents.
              </Callout>
            )}

            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={task.title} onChange={(e) => update("title", e.target.value)} maxLength={140} required />
            </div>
            <div>
              <Label htmlFor="description">Task description (sent to every agent)</Label>
              <Textarea id="description" rows={4} value={task.description} onChange={(e) => update("description", e.target.value)} maxLength={8000} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="language">Language</Label>
                <Select
                  id="language"
                  value={task.language}
                  onChange={(e) => {
                    const language = e.target.value as TaskInput["language"];
                    const ext = { TYPESCRIPT: "ts", JAVASCRIPT: "js", PYTHON: "py" }[language];
                    setTask((t) => ({ ...t, language, entryFile: t.entryFile.replace(/\.[a-z]+$/, `.${ext}`) }));
                  }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select id="category" value={task.category} onChange={(e) => update("category", e.target.value as TaskInput["category"])}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="entryFile">Solution file</Label>
                <Input id="entryFile" value={task.entryFile} onChange={(e) => update("entryFile", e.target.value)} className="font-mono" />
              </div>
              <div>
                <Label htmlFor="entryFunction">Function under test</Label>
                <Input id="entryFunction" value={task.entryFunction} onChange={(e) => update("entryFunction", e.target.value)} className="font-mono" />
              </div>
            </div>
            <div>
              <Label htmlFor="expected">Expected behaviour</Label>
              <Input id="expected" value={task.expectedBehavior} onChange={(e) => update("expectedBehavior", e.target.value)} />
            </div>
            <details className="group rounded-lg border border-ink-700 bg-ink-850/60 p-3" open={Boolean(starterPath)}>
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-300">
                <FileCode2 className="size-3.5" aria-hidden /> Starting file (optional, identical for every agent)
              </summary>
              <div className="mt-3 space-y-2">
                <Input aria-label="Starting file path" placeholder="e.g. auth.ts" value={starterPath} onChange={(e) => setStarterPath(e.target.value)} className="font-mono" />
                <Textarea aria-label="Starting file content" rows={7} value={starterContent} onChange={(e) => setStarterContent(e.target.value)} className="font-mono text-xs" spellCheck={false} />
              </div>
            </details>
            <div>
              <Label htmlFor="tests">Test specification (declarative JSON — data, never code)</Label>
              <Textarea
                id="tests"
                rows={8}
                value={testsJson}
                onChange={(e) => setTestsJson(e.target.value)}
                className={cn("font-mono text-xs", !testsParse.success && "border-danger/60")}
                spellCheck={false}
                aria-invalid={!testsParse.success}
                aria-describedby="tests-help"
              />
              <p id="tests-help" className={cn("mt-1 text-[11px]", testsParse.success ? "text-ink-500" : "text-danger")}>
                {testsParse.success
                  ? `${testsParse.data.length} test case(s). Format: [{ "name": "...", "args": [...], "expected": ... }]. Expected values never enter the sandbox.`
                  : testsParse.error.issues[0]?.message}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>2 · Agents</CardTitle>
              <CardDescription>Select at least two. Each runs independently in its own workspace.</CardDescription>
            </div>
            <Badge tone={chosen.length >= 2 ? "success" : "warning"}>{chosen.length} selected</Badge>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <Callout tone="warning" icon={<AlertTriangle />}>
                No {mode === "LIVE" ? "HarnessRouter" : "simulated"} agents are configured. {mode === "LIVE" ? "Add configured agents in Settings." : "Restart the server to recreate demo agents."}
              </Callout>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {agents.map((a) => {
                  const ok = compatible(a);
                  const on = selected.includes(a.id) && ok;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      role="checkbox"
                      aria-checked={on}
                      disabled={!ok}
                      onClick={() => toggle(a.id)}
                      className={cn(
                        "relative rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        on ? "border-electric/50 bg-electric/[0.07]" : "border-ink-700 bg-ink-850 hover:border-ink-500",
                      )}
                    >
                      <span className={cn("absolute right-3 top-3 grid size-4 place-items-center rounded border", on ? "border-electric bg-electric text-ink-950" : "border-ink-500")}>
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <span className="flex items-center gap-2 pr-6 text-sm font-medium text-ink-100">
                        <span className="size-2.5 rounded-full" style={{ background: a.color }} aria-hidden />
                        {a.name}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-ink-400">{a.description ?? `${a.base ?? "harness"} · ${a.model ?? "default model"}`}</span>
                      <span className="mt-2 flex flex-wrap gap-1">
                        <Badge tone={a.provider === "SIMULATED" ? "warning" : "violet"}>{a.provider === "SIMULATED" ? "simulated" : "HarnessRouter"}</Badge>
                        {!ok && <Badge tone="danger">no {LANGUAGE_LABEL[task.language]}</Badge>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>3 · Evaluation profile</CardTitle>
              <CardDescription>Weights are product defaults — the formula is shown, not hidden.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Benchmark profile">
              {PROFILES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={profile === p}
                  onClick={() => setProfile(p)}
                  className={cn("rounded-md px-2 py-1.5 text-xs", profile === p ? "bg-violet/20 text-violet-soft ring-1 ring-violet/50" : "bg-ink-850 text-ink-400 hover:text-ink-200")}
                >
                  {PROFILE_LABEL[p]}
                </button>
              ))}
            </div>
            <ScoringWeights profile={profile} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>4 · Execution limits</CardTitle>
              <CardDescription>Applied identically to every agent.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="timeout">Per-run timeout (seconds)</Label>
              <Input id="timeout" type="number" min={10} max={7200} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="concurrency">Max concurrent runs</Label>
              <Input id="concurrency" type="number" min={1} max={6} value={maxConcurrency} onChange={(e) => setMaxConcurrency(Number(e.target.value))} />
              <p className="mt-1 text-[10px] text-ink-500">Also capped server-wide by MAX_CONCURRENT_RUNS.</p>
            </div>
            {mode === "LIVE" && (
              <>
                <div>
                  <Label htmlFor="maxcost">Per-run budget, USD (sent as max_cost_usd)</Label>
                  <Input id="maxcost" type="number" step="0.1" min={0.1} max={50} value={maxCostUsd} onChange={(e) => setMaxCostUsd(e.target.value)} />
                  <p className="mt-1 text-[10px] text-ink-500">A budget hint forwarded to HarnessRouter — not a guaranteed spending cap.</p>
                </div>
                <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                  <input type="checkbox" checked={confirmSpend} onChange={(e) => setConfirmSpend(e.target.checked)} className="mt-0.5 accent-amber-400" />
                  I understand this launches {chosen.length} billable HarnessRouter task(s).
                </label>
                {!liveAllowed && (
                  <Callout tone="danger" icon={<ShieldAlert />}>
                    Live execution is disabled on this server (needs AGENTARENA_MODE=LIVE, ALLOW_LIVE_EXECUTION=true and HR_API_KEY).
                  </Callout>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {error && (
          <Callout tone="danger" icon={<AlertTriangle />}>
            {error}
          </Callout>
        )}

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting || chosen.length < 2 || (mode === "LIVE" && !liveAllowed)}>
          {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
          {submitting ? "Launching…" : `Launch benchmark (${chosen.length} agents)`}
        </Button>
        {mode === "DEMO" && <p className="text-center text-[11px] text-ink-500">Demo mode: no API calls, no cost. Agent behaviour is simulated.</p>}
      </div>
    </form>
  );
}

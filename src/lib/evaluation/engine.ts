import type { Profile, TestCase, Weights } from "@/lib/domain/schemas";
import { jsonEqual } from "./compare";
import type { Sandbox, SandboxRunOutput } from "./sandbox";
import { analyzeSource, categoryScore, transpileForSandbox, type Finding, type StaticReport } from "./static-analysis";
import { combineEfficiency, relativeEfficiency, round, weightedTotal, type ComponentScores } from "./scoring";

export const EVALUATOR_VERSION = "1.0.0";

export interface EvalRunInput {
  runId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT" | "PENDING" | "RUNNING";
  durationMs: number | null;
  costUsd: number | null;
  costSource: "PROVIDER_REPORTED" | "SIMULATED" | "UNAVAILABLE";
  artifacts: Array<{ path: string; content: string | null }>;
}

export interface EvalBenchmarkInput {
  profile: Profile;
  weights: Weights;
  task: {
    language: "TYPESCRIPT" | "JAVASCRIPT" | "PYTHON";
    entryFile: string;
    entryFunction: string;
    testSpec: TestCase[];
    maxSolutionBytes?: number;
  };
  runs: EvalRunInput[];
}

export interface TestOutcome {
  name: string;
  status: "passed" | "failed" | "error" | "skipped";
  expected: unknown;
  actual?: unknown;
  error?: string;
}

export interface EvaluationEvidence {
  evaluatorVersion: string;
  notes: string[];
  artifactPresent: boolean;
  runtime: {
    available: boolean;
    reason?: string;
    sandboxStatus?: SandboxRunOutput["status"];
    sandboxDurationMs?: number;
    limits?: SandboxRunOutput["limits"];
    image?: string;
    loadError?: string;
  };
  tests: TestOutcome[];
  static: Pick<StaticReport, "analyzer" | "metrics" | "exportsEntryFunction"> | null;
  findings: Finding[];
  /** Ranking gates: high-severity security findings. A gated run can never be ranked above an ungated one. */
  gates: string[];
  efficiencyInputs: {
    durationMs: number | null;
    peerDurationsMs: Array<number | null>;
    costUsd: number | null;
    costSource: string;
    peerCostsUsd: Array<number | null>;
    durationScore: number | null;
    costScore: number | null;
  };
  components: ComponentScores;
  weights: Weights;
}

export interface EvaluationOutcome {
  runId: string;
  status: "COMPLETED" | "PARTIAL" | "ERROR";
  components: ComponentScores;
  totalScore: number | null;
  coverage: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  runtimeAvailable: boolean;
  evidence: EvaluationEvidence;
}

/**
 * Evaluates every run of a benchmark. Efficiency is relative between runs, so the
 * whole benchmark is evaluated together. Generated code only ever executes in `sandbox`.
 */
export async function evaluateBenchmark(input: EvalBenchmarkInput, sandbox: Sandbox): Promise<EvaluationOutcome[]> {
  const sandboxState = await sandbox.isAvailable(input.task.language);
  const completed = input.runs.filter((r) => r.status === "COMPLETED");
  const peerDurations = completed.map((r) => r.durationMs);
  // Costs are only comparable when they come from the same kind of source.
  const costSources = new Set(completed.map((r) => r.costSource));
  const comparableCosts = costSources.size === 1 && !costSources.has("UNAVAILABLE");
  const peerCosts = comparableCosts ? completed.map((r) => r.costUsd) : [];

  const outcomes: EvaluationOutcome[] = [];
  for (const run of input.runs) {
    outcomes.push(await evaluateRun(run, input, sandbox, sandboxState, peerDurations, peerCosts));
  }
  return outcomes;
}

async function evaluateRun(
  run: EvalRunInput,
  input: EvalBenchmarkInput,
  sandbox: Sandbox,
  sandboxState: { available: boolean; reason?: string },
  peerDurations: Array<number | null>,
  peerCosts: Array<number | null>,
): Promise<EvaluationOutcome> {
  const { task, weights, profile } = input;
  const notes: string[] = [];
  const artifact = run.artifacts.find((a) => a.path === task.entryFile && typeof a.content === "string");
  const code = artifact?.content ?? null;
  const base: Omit<EvaluationEvidence, "components"> = {
    evaluatorVersion: EVALUATOR_VERSION,
    notes,
    artifactPresent: Boolean(code),
    runtime: { available: sandboxState.available, reason: sandboxState.reason },
    tests: [],
    static: null,
    findings: [],
    gates: [],
    efficiencyInputs: {
      durationMs: run.durationMs,
      peerDurationsMs: peerDurations,
      costUsd: run.costUsd,
      costSource: run.costSource,
      peerCostsUsd: peerCosts,
      durationScore: null,
      costScore: null,
    },
    weights,
  };

  if (run.status === "CANCELLED" || run.status === "PENDING" || run.status === "RUNNING") {
    notes.push(run.status === "CANCELLED" ? "Run was cancelled by the user; it is not scored." : "Run did not finish; it is not scored.");
    const components: ComponentScores = { correctness: null, reliability: null, quality: null, efficiency: null, security: null };
    return finalize(run.runId, "ERROR", components, weights, { ...base, components }, false);
  }

  if (run.status !== "COMPLETED") {
    notes.push(`Run ended as ${run.status}: the agent did not deliver a solution, so correctness and reliability are measured as 0.`);
    const components: ComponentScores = { correctness: 0, reliability: 0, quality: null, efficiency: null, security: null };
    const tests = task.testSpec.map<TestOutcome>((t) => ({ name: t.name, status: "skipped", expected: t.expected }));
    return finalize(run.runId, "COMPLETED", components, weights, { ...base, tests, components }, sandboxState.available);
  }

  if (!code) {
    notes.push(`Required artifact ${task.entryFile} is missing: correctness measured as 0, reliability reduced.`);
    const components: ComponentScores = { correctness: 0, reliability: 0.5, quality: null, efficiency: null, security: null };
    const tests = task.testSpec.map<TestOutcome>((t) => ({ name: t.name, status: "skipped", expected: t.expected }));
    return finalize(run.runId, "COMPLETED", components, weights, { ...base, tests, components }, sandboxState.available);
  }

  // ── Static analysis (no execution) ──────────────────────────────────────────
  const report = analyzeSource(code, task.language, task.entryFunction);
  const findings = [...report.findings];
  if (task.maxSolutionBytes && Buffer.byteLength(code) > task.maxSolutionBytes) {
    findings.push({ ruleId: "size-limit", category: "quality", severity: "medium", message: `Solution exceeds ${task.maxSolutionBytes} bytes` });
  }
  const quality = categoryScore(findings, "quality");
  const security = categoryScore(findings, "security");

  // ── Runtime tests in the sandbox ────────────────────────────────────────────
  let tests: TestOutcome[] = [];
  let correctness: number | null = null;
  const runtime: EvaluationEvidence["runtime"] = { available: sandboxState.available, reason: sandboxState.reason };
  if (task.testSpec.length === 0) {
    notes.push("Task has no test specification; correctness is not measured.");
  } else if (!sandboxState.available) {
    notes.push(`Runtime tests unavailable: ${sandboxState.reason ?? "sandbox unavailable"}. Correctness is not measured.`);
    tests = task.testSpec.map((t) => ({ name: t.name, status: "skipped", expected: t.expected }));
  } else if (report.syntaxErrors.length > 0) {
    notes.push("Solution has syntax errors; every test fails without execution.");
    tests = task.testSpec.map((t) => ({ name: t.name, status: "error", expected: t.expected, error: "Syntax error" }));
    correctness = 0;
  } else {
    const out = await sandbox.run({
      language: task.language,
      source: transpileForSandbox(code, task.language),
      entryFunction: task.entryFunction,
      argsList: task.testSpec.map((t) => t.args),
    });
    Object.assign(runtime, { sandboxStatus: out.status, sandboxDurationMs: out.durationMs, limits: out.limits, image: out.image, loadError: out.loadError });
    if (out.status === "ok") {
      tests = task.testSpec.map((t, i) => {
        const r = out.results[i];
        if (!r) return { name: t.name, status: "error", expected: t.expected, error: "No result reported" };
        if (!r.ok) return { name: t.name, status: "error", expected: t.expected, error: r.error };
        return { name: t.name, status: jsonEqual(r.value, t.expected) ? "passed" : "failed", expected: t.expected, actual: r.value };
      });
      correctness = round(tests.filter((t) => t.status === "passed").length / tests.length, 4);
    } else {
      const why = out.status === "timeout" ? "Sandbox time limit exceeded" : out.status === "load_error" ? "Module failed to load" : "Sandbox process crashed";
      notes.push(`${why}; all tests counted as errors.`);
      tests = task.testSpec.map((t) => ({ name: t.name, status: "error", expected: t.expected, error: why }));
      correctness = 0;
    }
  }

  // ── Efficiency relative to peers ────────────────────────────────────────────
  const durationScore = relativeEfficiency(run.durationMs, base.efficiencyInputs.peerDurationsMs);
  const costScore = peerCosts.length ? relativeEfficiency(run.costUsd, peerCosts) : null;
  const efficiency = combineEfficiency(durationScore, costScore, profile);
  if (efficiency === null) notes.push("Efficiency needs at least two completed runs with measurements; not scored.");
  if (run.costSource === "SIMULATED") notes.push("Cost figures are SIMULATED (demo mode).");

  const components: ComponentScores = { correctness, reliability: 1, quality, efficiency, security };
  const evidence: EvaluationEvidence = {
    ...base,
    runtime,
    tests,
    findings,
    gates: findings.filter((f) => f.category === "security" && f.severity === "high").map((f) => `${f.ruleId}: ${f.message}`),
    static: { analyzer: report.analyzer, metrics: report.metrics, exportsEntryFunction: report.exportsEntryFunction },
    efficiencyInputs: { ...base.efficiencyInputs, durationScore, costScore },
    components,
  };
  const partial = correctness === null;
  return finalize(run.runId, partial ? "PARTIAL" : "COMPLETED", components, weights, evidence, sandboxState.available);
}

function finalize(
  runId: string,
  status: EvaluationOutcome["status"],
  components: ComponentScores,
  weights: Weights,
  evidence: EvaluationEvidence,
  runtimeAvailable: boolean,
): EvaluationOutcome {
  const { total, coverage } = weightedTotal(components, weights);
  return {
    runId,
    status,
    components,
    totalScore: total,
    coverage,
    testsPassed: evidence.tests.filter((t) => t.status === "passed").length,
    testsFailed: evidence.tests.filter((t) => t.status === "failed" || t.status === "error").length,
    testsSkipped: evidence.tests.filter((t) => t.status === "skipped").length,
    runtimeAvailable,
    evidence,
  };
}

/** Recomputes the total from stored evidence alone — used to prove scores are reproducible. */
export function rescoreFromEvidence(evidence: EvaluationEvidence): { total: number | null; coverage: number } {
  return weightedTotal(evidence.components, evidence.weights);
}

/**
 * Orders runs best-first: ungated before security-gated, then total score, correctness, duration.
 * Unscored runs last.
 */
export function rankOutcomes<
  T extends { totalScore: number | null; components: ComponentScores; durationMs?: number | null; gated?: boolean },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.totalScore === null && b.totalScore === null) return 0;
    if (a.totalScore !== null && b.totalScore !== null && Boolean(a.gated) !== Boolean(b.gated)) return a.gated ? 1 : -1;
    if (a.totalScore === null) return 1;
    if (b.totalScore === null) return -1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    const ca = a.components.correctness ?? -1;
    const cb = b.components.correctness ?? -1;
    if (cb !== ca) return cb - ca;
    return (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity);
  });
}

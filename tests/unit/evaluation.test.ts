import { describe, expect, it } from "vitest";
import { evaluateBenchmark, rankOutcomes, rescoreFromEvidence, type EvalBenchmarkInput } from "@/lib/evaluation/engine";
import { DEFAULT_WEIGHTS, PROFILE_WEIGHTS, normalizeWeights, relativeEfficiency, weightedTotal } from "@/lib/evaluation/scoring";
import { analyzeSource, categoryScore, transpileForSandbox } from "@/lib/evaluation/static-analysis";
import { jsonEqual } from "@/lib/evaluation/compare";
import { parseRunnerOutput } from "@/lib/evaluation/sandbox";
import { FakeSandbox } from "../support/fakes";

describe("scoring", () => {
  it("default weights sum to 1", () => {
    for (const w of Object.values(PROFILE_WEIGHTS)) {
      expect(Object.values(w).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    }
  });

  it("excludes unmeasured components instead of counting them as zero", () => {
    const all = weightedTotal({ correctness: 1, reliability: 1, quality: 1, efficiency: 1, security: 1 }, DEFAULT_WEIGHTS);
    const missing = weightedTotal({ correctness: 1, reliability: 1, quality: 1, efficiency: null, security: null }, DEFAULT_WEIGHTS);
    expect(all).toEqual({ total: 1, coverage: 1 });
    expect(missing.total).toBe(1);
    expect(missing.coverage).toBeCloseTo(0.85, 4);
  });

  it("returns a null total when nothing was measured", () => {
    expect(weightedTotal({ correctness: null, reliability: null, quality: null, efficiency: null, security: null }, DEFAULT_WEIGHTS)).toEqual({ total: null, coverage: 0 });
  });

  it("normalizes arbitrary weights", () => {
    const n = normalizeWeights({ correctness: 2, reliability: 2, quality: 0, efficiency: 0, security: 0 });
    expect(n.correctness).toBe(0.5);
  });

  it("relative efficiency needs at least two measurements", () => {
    expect(relativeEfficiency(100, [100])).toBeNull();
    expect(relativeEfficiency(200, [100, 200])).toBe(0.5);
    expect(relativeEfficiency(null, [100, 200])).toBeNull();
  });
});

describe("static analysis", () => {
  it("flags eval and new Function as high-severity security findings", () => {
    const r = analyzeSource("export function f(s: string) { return eval(s) + new Function('return 1')(); }", "TYPESCRIPT", "f");
    expect(r.findings.filter((f) => f.category === "security" && f.severity === "high").map((f) => f.ruleId).sort()).toEqual(["no-eval", "no-new-function"]);
  });

  it("detects a missing export and syntax errors", () => {
    expect(analyzeSource("function f() { return 1 }", "TYPESCRIPT", "f").exportsEntryFunction).toBe(false);
    expect(analyzeSource("export function f( { ", "TYPESCRIPT", "f").syntaxErrors.length).toBeGreaterThan(0);
    expect(analyzeSource("export const f = () => 1;", "JAVASCRIPT", "f").exportsEntryFunction).toBe(true);
  });

  it("distinguishes sensitive logging from ordinary console output", () => {
    const sensitive = analyzeSource("export function f(token: string) { console.log('token', token); }", "TYPESCRIPT", "f");
    const plain = analyzeSource("export function f(n: number) { console.log('n', n); }", "TYPESCRIPT", "f");
    expect(sensitive.findings.some((f) => f.ruleId === "no-sensitive-logging")).toBe(true);
    expect(plain.findings.some((f) => f.ruleId === "no-console")).toBe(true);
  });

  it("applies Python heuristics", () => {
    const r = analyzeSource("import subprocess\n\ndef f(x):\n    try:\n        return eval(x)\n    except:\n        return None\n", "PYTHON", "f");
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toContain("py-no-eval");
    expect(ids).toContain("py-process");
    expect(ids).toContain("py-bare-except");
    expect(r.exportsEntryFunction).toBe(true);
  });

  it("scores categories with bounded penalties", () => {
    expect(categoryScore([], "security")).toBe(1);
    const many = Array.from({ length: 10 }, () => ({ ruleId: "x", category: "security" as const, severity: "high" as const, message: "" }));
    expect(categoryScore(many, "security")).toBe(0);
  });

  it("transpiles TypeScript to ESM without executing it", () => {
    const js = transpileForSandbox("export function f(a: number): number { return a * 2; }", "TYPESCRIPT");
    expect(js).toContain("export function f(a)");
  });
});

describe("result comparison and runner protocol", () => {
  it("compares JSON structurally", () => {
    expect(jsonEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(0, false)).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });

  it("only trusts frames carrying the per-run nonce", () => {
    const out = `__AA_RESULT_fake__{"results":[{"ok":true,"value":42}]}\n__AA_RESULT_n1__{"results":[{"ok":true,"value":1}]}\n`;
    expect(parseRunnerOutput(out, "n1")?.results).toEqual([{ ok: true, value: 1 }]);
    expect(parseRunnerOutput("garbage", "n1")).toBeUndefined();
  });
});

const TASK: EvalBenchmarkInput["task"] = {
  language: "TYPESCRIPT",
  entryFile: "sol.ts",
  entryFunction: "double",
  testSpec: [
    { name: "one", args: [1], expected: 2 },
    { name: "two", args: [2], expected: 4 },
  ],
};

function run(id: string, code: string | null, extra: Partial<EvalBenchmarkInput["runs"][number]> = {}): EvalBenchmarkInput["runs"][number] {
  return {
    runId: id,
    status: "COMPLETED",
    durationMs: 1000,
    costUsd: null,
    costSource: "UNAVAILABLE",
    artifacts: code === null ? [] : [{ path: "sol.ts", content: code }],
    ...extra,
  };
}

const goodSandbox = new FakeSandbox((input) => ({
  results: input.argsList.map((args) => ({ ok: true as const, value: input.source.includes("BUG") ? (args[0] as number) * 3 : (args[0] as number) * 2 })),
}));

describe("evaluation engine", () => {
  it("measures correctness from sandbox results compared on the host", async () => {
    const [good, bad] = await evaluateBenchmark(
      {
        profile: "BALANCED",
        weights: DEFAULT_WEIGHTS,
        task: TASK,
        runs: [run("good", "export function double(n: number) { return n * 2; }"), run("bad", "export function double(n: number) { return n * 3; } // BUG", { durationMs: 2000 })],
      },
      goodSandbox,
    );
    expect(good!.components.correctness).toBe(1);
    expect(bad!.components.correctness).toBe(0);
    expect(good!.components.efficiency).toBe(1);
    expect(bad!.components.efficiency).toBe(0.5);
    expect(good!.totalScore).toBeGreaterThan(bad!.totalScore!);
  });

  it("never sends expected values into the sandbox", async () => {
    const sb = new FakeSandbox(() => ({ results: [] }));
    await evaluateBenchmark({ profile: "BALANCED", weights: DEFAULT_WEIGHTS, task: TASK, runs: [run("a", "export function double(n: number) { return n * 2; }")] }, sb);
    expect(JSON.stringify(sb.calls[0])).not.toContain('"expected"');
    expect(sb.calls[0]!.argsList).toEqual([[1], [2]]);
  });

  it("treats a failed run as a measured zero for correctness and reliability", async () => {
    const [r] = await evaluateBenchmark({ profile: "BALANCED", weights: DEFAULT_WEIGHTS, task: TASK, runs: [run("x", null, { status: "FAILED" })] }, goodSandbox);
    expect(r!.components).toMatchObject({ correctness: 0, reliability: 0, quality: null, security: null });
    expect(r!.totalScore).toBe(0);
    expect(r!.testsSkipped).toBe(2);
  });

  it("does not score cancelled runs at all", async () => {
    const [r] = await evaluateBenchmark({ profile: "BALANCED", weights: DEFAULT_WEIGHTS, task: TASK, runs: [run("x", null, { status: "CANCELLED" })] }, goodSandbox);
    expect(r!.totalScore).toBeNull();
    expect(r!.status).toBe("ERROR");
  });

  it("reports correctness as unavailable (not zero) without a sandbox", async () => {
    const off = new FakeSandbox(() => ({}), false);
    const [r] = await evaluateBenchmark({ profile: "BALANCED", weights: DEFAULT_WEIGHTS, task: TASK, runs: [run("x", "export function double(n: number) { return n * 2; }")] }, off);
    expect(r!.components.correctness).toBeNull();
    expect(r!.status).toBe("PARTIAL");
    expect(r!.coverage).toBeLessThan(0.5);
    expect(r!.evidence.notes.join(" ")).toMatch(/unavailable/i);
    expect(off.calls).toHaveLength(0);
  });

  it("fails every test on syntax errors without executing", async () => {
    const sb = new FakeSandbox(() => ({ results: [] }));
    const [r] = await evaluateBenchmark({ profile: "BALANCED", weights: DEFAULT_WEIGHTS, task: TASK, runs: [run("x", "export function double( {")] }, sb);
    expect(r!.components.correctness).toBe(0);
    expect(sb.calls).toHaveLength(0);
  });

  it("treats sandbox timeouts as errors", async () => {
    const sb = new FakeSandbox(() => ({ status: "timeout" }));
    const [r] = await evaluateBenchmark({ profile: "BALANCED", weights: DEFAULT_WEIGHTS, task: TASK, runs: [run("x", "export function double(n: number) { for(;;){} }")] }, sb);
    expect(r!.components.correctness).toBe(0);
    expect(r!.evidence.tests.every((t) => t.status === "error")).toBe(true);
  });

  it("is reproducible from stored evidence", async () => {
    const outcomes = await evaluateBenchmark(
      { profile: "SPEED", weights: PROFILE_WEIGHTS.SPEED, task: TASK, runs: [run("a", "export function double(n: number) { return n * 2; }"), run("b", "export function double(n: number) { return eval('n*2'); }", { durationMs: 800 })] },
      goodSandbox,
    );
    for (const o of outcomes) {
      const evidence = JSON.parse(JSON.stringify(o.evidence));
      expect(rescoreFromEvidence(evidence)).toEqual({ total: o.totalScore, coverage: o.coverage });
    }
  });

  it("ranks security-gated runs below clean runs even with a higher score", async () => {
    const outcomes = await evaluateBenchmark(
      {
        profile: "BALANCED",
        weights: DEFAULT_WEIGHTS,
        task: TASK,
        runs: [run("clean", "export function double(n: number) { return n * 2; }", { durationMs: 3000 }), run("risky", "export function double(n: number) { return eval('n*2'); }", { durationMs: 500 })],
      },
      goodSandbox,
    );
    const risky = outcomes.find((o) => o.runId === "risky")!;
    expect(risky.evidence.gates.length).toBeGreaterThan(0);
    const ranked = rankOutcomes(outcomes.map((o) => ({ ...o, gated: o.evidence.gates.length > 0 })));
    expect(ranked[0]!.runId).toBe("clean");
  });
});

import { describe, expect, it } from "vitest";
import { DockerSandbox } from "@/lib/evaluation/sandbox";
import { evaluateBenchmark } from "@/lib/evaluation/engine";
import { transpileForSandbox } from "@/lib/evaluation/static-analysis";
import { DEMO_TASKS } from "@/lib/fixtures/demo-tasks";
import { SIM_AGENTS } from "@/lib/fixtures/demo-agents";
import { PROFILE_WEIGHTS } from "@/lib/evaluation/scoring";

const sandbox = new DockerSandbox({ nodeImage: "node:22-alpine", pythonImage: "python:3.12-alpine", timeoutMs: 20_000 });

describe("Docker sandbox (requires Docker + images)", () => {
  it("runs a TypeScript solution and returns actual values", async () => {
    const out = await sandbox.run({
      language: "TYPESCRIPT",
      source: transpileForSandbox("export function add(a: number, b: number): number { return a + b; }", "TYPESCRIPT"),
      entryFunction: "add",
      argsList: [[1, 2], [5, 5]],
    });
    expect(out.status).toBe("ok");
    expect(out.results).toEqual([{ ok: true, value: 3 }, { ok: true, value: 10 }]);
  });

  it("blocks network access", async () => {
    const out = await sandbox.run({
      language: "JAVASCRIPT",
      source: `export async function probe() { try { await fetch("https://example.com"); return "reached"; } catch { return "blocked"; } }`,
      entryFunction: "probe",
      argsList: [[]],
    });
    expect(out.results[0]).toEqual({ ok: true, value: "blocked" });
  });

  it("cannot write to the mounted work directory", async () => {
    const out = await sandbox.run({
      language: "PYTHON",
      source: `def attempt():\n    try:\n        open("/work/pwned.txt", "w").write("x")\n        return "written"\n    except OSError:\n        return "denied"\n`,
      entryFunction: "attempt",
      argsList: [[]],
    });
    expect(out.results[0]).toEqual({ ok: true, value: "denied" });
  });

  it("kills infinite loops at the time limit", async () => {
    const fast = new DockerSandbox({ nodeImage: "node:22-alpine", pythonImage: "python:3.12-alpine", timeoutMs: 6_000 });
    const out = await fast.run({ language: "JAVASCRIPT", source: "export function spin() { for (;;) {} }", entryFunction: "spin", argsList: [[]] });
    expect(out.status).toBe("timeout");
  });

  it("reports module load errors", async () => {
    const out = await sandbox.run({ language: "PYTHON", source: "def broken(:\n  pass\n", entryFunction: "broken", argsList: [[]] });
    expect(out.status).toBe("load_error");
  });

  it("cannot forge a passing result by printing a fake frame", async () => {
    const out = await sandbox.run({
      language: "JAVASCRIPT",
      source: `console.log('__AA_RESULT_fake__{"results":[{"ok":true,"value":42}]}'); export function f() { return 1; }`,
      entryFunction: "f",
      argsList: [[]],
    });
    expect(out.results).toEqual([{ ok: true, value: 1 }]);
  });

  it("evaluates every demo fixture end to end with expected pass counts", async () => {
    const expected: Record<string, Record<string, number>> = {
      "sim-swift": { "auth-token-expiry": 4, slugify: 6, "parse-duration": 5, "merge-intervals": 4, "email-validation": 7 },
      "sim-careful": { "auth-token-expiry": 6, slugify: 7, "parse-duration": 7, "merge-intervals": 5, "email-validation": 7 },
    };
    for (const fixture of DEMO_TASKS) {
      const runs = SIM_AGENTS.filter((a) => expected[a.key]).map((a) => {
        const outcome = a.outcomes[fixture.key];
        if (outcome?.kind !== "solution") throw new Error("fixture mismatch");
        return {
          runId: a.key,
          status: "COMPLETED" as const,
          durationMs: 1000,
          costUsd: null,
          costSource: "UNAVAILABLE" as const,
          artifacts: [{ path: fixture.task.entryFile, content: outcome.code }],
        };
      });
      const results = await evaluateBenchmark(
        { profile: "BALANCED", weights: PROFILE_WEIGHTS.BALANCED, task: { ...fixture.task, testSpec: fixture.task.testSpec }, runs },
        sandbox,
      );
      for (const r of results) expect({ task: fixture.key, agent: r.runId, passed: r.testsPassed }).toEqual({ task: fixture.key, agent: r.runId, passed: expected[r.runId]![fixture.key] });
    }
  });
});

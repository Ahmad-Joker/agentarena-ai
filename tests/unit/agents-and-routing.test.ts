import { describe, expect, it } from "vitest";
import { DemoAgentAdapter } from "@/lib/agents/demo-adapter";
import { buildBenchmarkPrompt, extractCodeBlock, hashTask } from "@/lib/agents/prompt";
import type { AgentRunRequest } from "@/lib/agents/types";
import type { AgentStreamEvent } from "@/lib/harnessrouter/types";
import { DEMO_TASKS } from "@/lib/fixtures/demo-tasks";
import { classifyTask } from "@/lib/routing/classifier";
import { INSUFFICIENT_MESSAGE, recommend } from "@/lib/routing/engine";
import type { RunRecord } from "@/lib/analytics/aggregate";
import { wilsonInterval, median } from "@/lib/analytics/stats";
import { fixtureKeyForHash } from "@/lib/services/fixtures";
import { taskInputSchema } from "@/lib/domain/schemas";

function demoRequest(simKey: string, fixtureKey: string | undefined, signal = new AbortController().signal) {
  const events: AgentStreamEvent[] = [];
  const req: AgentRunRequest = {
    idempotencyKey: "k",
    agent: { id: "a", name: "A", provider: "SIMULATED", simKey },
    task: { language: "TYPESCRIPT", entryFile: "auth.ts", entryFunction: "isTokenExpired", fixtureKey },
    prompt: "p",
    starterFiles: [],
    timeoutSeconds: 60,
    signal,
    onEvent: (e) => {
      events.push(e);
    },
  };
  return { req, events };
}

describe("demo adapter", () => {
  it("is deterministic and goes through the shared normalizer", async () => {
    const a = demoRequest("sim-careful", "auth-token-expiry");
    const b = demoRequest("sim-careful", "auth-token-expiry");
    const adapter = new DemoAgentAdapter(0);
    const [ra, rb] = [await adapter.run(a.req), await adapter.run(b.req)];
    expect(ra).toEqual(rb);
    expect(ra.costSource).toBe("SIMULATED");
    expect(a.events.map((e) => e.kind)).toEqual(b.events.map((e) => e.kind));
    expect(a.events.at(-1)).toMatchObject({ kind: "terminal", status: "completed" });
  });

  it("demonstrates failure and provider-timeout paths", async () => {
    const adapter = new DemoAgentAdapter(0);
    expect(await adapter.run(demoRequest("sim-erratic", "slugify").req)).toMatchObject({ outcome: "failed", errorCode: "upstream_error" });
    expect(await adapter.run(demoRequest("sim-erratic", "merge-intervals").req)).toMatchObject({ outcome: "incomplete", reason: "timeout" });
  });

  it("returns a stub (not a fake pass) for custom tasks", async () => {
    const r = await new DemoAgentAdapter(0).run(demoRequest("sim-careful", undefined).req);
    expect(r.artifacts[0]!.content).toContain("no solution for custom tasks");
  });

  it("honours cancellation", async () => {
    const ctrl = new AbortController();
    const pending = new DemoAgentAdapter(1).run(demoRequest("sim-careful", "slugify", ctrl.signal).req);
    ctrl.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });
});

describe("prompt fairness", () => {
  it("builds one deterministic prompt that does not leak expected values", () => {
    const task = taskInputSchema.parse(DEMO_TASKS[1]!.task);
    const p = buildBenchmarkPrompt(task);
    expect(p).toBe(buildBenchmarkPrompt(task));
    expect(p).toContain("slugify.ts");
    expect(p).not.toContain("cafe-creme");
  });

  it("hashes tasks stably and maps fixtures back to their keys", () => {
    for (const f of DEMO_TASKS) expect(fixtureKeyForHash(hashTask(taskInputSchema.parse(f.task)))).toBe(f.key);
    expect(fixtureKeyForHash("nope")).toBeUndefined();
  });

  it("extracts the last code block in the task language", () => {
    const text = "first\n```py\nx=1\n```\nthen\n```ts\nexport const a = 1;\n```\n";
    expect(extractCodeBlock(text, "TYPESCRIPT")).toBe("export const a = 1;\n");
    expect(extractCodeBlock(text, "PYTHON")).toBe("x=1\n");
    expect(extractCodeBlock("no code", "PYTHON")).toBeUndefined();
  });
});

describe("classifier", () => {
  it("explains its decisions", () => {
    const c = classifyTask("Fix the regression bug in our Next.js TypeScript login flow");
    expect(c.language).toBe("TYPESCRIPT");
    expect(c.category).toBe("BUG_FIX");
    expect(c.signals.length).toBe(2);
    expect(classifyTask("Write a python function to merge intervals").language).toBe("PYTHON");
    expect(classifyTask("do something").category).toBeUndefined();
  });
});

let n = 0;
function rec(agent: string, overrides: Partial<RunRecord> = {}): RunRecord {
  n++;
  return {
    runId: `r${n}`,
    benchmarkId: `b${n}`,
    agentId: agent,
    agentName: agent.toUpperCase(),
    agentColor: "#fff",
    model: null,
    language: "TYPESCRIPT",
    category: "BUG_FIX",
    profile: "BALANCED",
    status: "COMPLETED",
    errorCode: null,
    durationMs: 1000,
    costUsd: null,
    costSource: "UNAVAILABLE",
    totalScore: 0.8,
    correctness: 0.8,
    gated: false,
    createdAt: new Date(0),
    ...overrides,
  };
}
const AGENTS = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), languages: ["TYPESCRIPT", "PYTHON"], isActive: true }));

describe("routing engine", () => {
  it("refuses to recommend without enough evidence", () => {
    const d = recommend({ language: "TYPESCRIPT", category: "BUG_FIX", objective: "BALANCED" }, [rec("a"), rec("b")], AGENTS);
    expect(d.sufficient).toBe(false);
    expect(d.message).toBe(INSUFFICIENT_MESSAGE);
    expect(d.confidence).toBe("INSUFFICIENT");
  });

  it("recommends the best agent in the narrowest sufficient scope", () => {
    const records = [...Array(3)].flatMap(() => [rec("a", { totalScore: 0.9 }), rec("b", { totalScore: 0.6 })]);
    const d = recommend({ language: "TYPESCRIPT", category: "BUG_FIX", objective: "BALANCED" }, records, AGENTS);
    expect(d.sufficient).toBe(true);
    expect(d.scope).toBe("language+category");
    expect(d.recommended?.agentId).toBe("a");
    expect(d.alternative?.agentId).toBe("b");
    expect(d.confidence).toBe("LOW");
  });

  it("falls back to a broader scope and says so", () => {
    const records = [...Array(3)].flatMap(() => [rec("a", { category: "PARSING", totalScore: 0.9 }), rec("b", { category: "PARSING", totalScore: 0.5 })]);
    const d = recommend({ language: "TYPESCRIPT", category: "BUG_FIX", objective: "BALANCED" }, records, AGENTS);
    expect(d.scope).toBe("language");
    expect(d.caveats.join(" ")).toMatch(/broader/);
  });

  it("raises confidence only with large samples and clear margins", () => {
    const records = [...Array(10)].flatMap(() => [rec("a", { totalScore: 0.95 }), rec("b", { totalScore: 0.6 })]);
    expect(recommend({ language: "TYPESCRIPT", category: "BUG_FIX", objective: "BALANCED" }, records, AGENTS).confidence).toBe("HIGH");
  });

  it("ranks security-gated agents last", () => {
    const records = [...Array(3)].flatMap(() => [rec("a", { totalScore: 0.99, gated: true }), rec("b", { totalScore: 0.7 })]);
    const d = recommend({ language: "TYPESCRIPT", category: "BUG_FIX", objective: "BALANCED" }, records, AGENTS);
    expect(d.recommended?.agentId).toBe("b");
    expect(d.caveats.join(" ")).toMatch(/security/);
  });

  it("cannot optimise for cost without reported cost data", () => {
    const records = [...Array(3)].flatMap(() => [rec("a"), rec("b")]);
    const d = recommend({ language: "TYPESCRIPT", objective: "COST" }, records, AGENTS);
    expect(d.sufficient).toBe(false);
    expect(d.caveats.join(" ")).toMatch(/Cost was not reported/);
  });

  it("speed objective prefers faster agents at equal correctness", () => {
    const records = [...Array(3)].flatMap(() => [rec("a", { durationMs: 4000 }), rec("b", { durationMs: 1000 })]);
    expect(recommend({ language: "TYPESCRIPT", objective: "SPEED" }, records, AGENTS).recommended?.agentId).toBe("b");
  });

  it("excludes agents that do not support the language", () => {
    const records = [...Array(3)].flatMap(() => [rec("a", { totalScore: 0.99 }), rec("b"), rec("c", { totalScore: 0.5 })]);
    const agents = AGENTS.map((a) => (a.id === "a" ? { ...a, languages: ["PYTHON"] } : a));
    expect(recommend({ language: "TYPESCRIPT", objective: "BALANCED" }, records, agents).recommended?.agentId).toBe("b");
  });

  it("ignores cancelled runs", () => {
    const records = [...Array(3)].flatMap(() => [rec("a", { status: "CANCELLED", totalScore: null }), rec("b")]);
    expect(recommend({ language: "TYPESCRIPT", objective: "BALANCED" }, records, AGENTS).sufficient).toBe(false);
  });
});

describe("stats", () => {
  it("computes Wilson intervals and medians", () => {
    const w = wilsonInterval(3, 3)!;
    expect(w.high).toBe(1);
    expect(w.low).toBeGreaterThan(0.4);
    expect(w.low).toBeLessThan(0.5);
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});

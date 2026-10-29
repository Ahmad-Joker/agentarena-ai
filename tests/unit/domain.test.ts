import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, deriveBenchmarkStatus, InvalidTransitionError, isTerminal } from "@/lib/domain/run-state";
import { createBenchmarkSchema, safeRelativePath, taskInputSchema } from "@/lib/domain/schemas";
import { DEMO_TASKS } from "@/lib/fixtures/demo-tasks";
import { Semaphore } from "@/lib/orchestrator/semaphore";

describe("run state machine", () => {
  it("allows the documented lifecycle", () => {
    expect(canTransition("PENDING", "RUNNING")).toBe(true);
    for (const t of ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const) expect(canTransition("RUNNING", t)).toBe(true);
    expect(canTransition("PENDING", "CANCELLED")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransition("CANCELLED", "COMPLETED")).toBe(false);
    expect(() => assertTransition("TIMED_OUT", "RUNNING")).toThrow(InvalidTransitionError);
  });

  it("terminal states never transition", () => {
    for (const s of ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].some((t) => canTransition(s, t as never))).toBe(false);
    }
  });

  it("derives benchmark status from runs", () => {
    expect(deriveBenchmarkStatus([], false)).toBe("PENDING");
    expect(deriveBenchmarkStatus(["RUNNING", "PENDING"], false)).toBe("RUNNING");
    expect(deriveBenchmarkStatus(["COMPLETED", "FAILED"], false)).toBe("COMPLETED");
    expect(deriveBenchmarkStatus(["FAILED", "TIMED_OUT"], false)).toBe("FAILED");
    expect(deriveBenchmarkStatus(["COMPLETED", "CANCELLED"], true)).toBe("CANCELLED");
    // Cancel requested after every run had already finished: results stand.
    expect(deriveBenchmarkStatus(["COMPLETED", "COMPLETED"], true)).toBe("COMPLETED");
  });
});

describe("input validation", () => {
  it("accepts every built-in fixture task", () => {
    for (const f of DEMO_TASKS) expect(taskInputSchema.safeParse(f.task).success).toBe(true);
  });

  it("rejects path traversal and absolute paths", () => {
    for (const bad of ["../etc/passwd", "/abs.ts", "a/../b.ts", "a//b.ts", "C:\\x.ts", "./x.ts", ""]) {
      expect(safeRelativePath.safeParse(bad).success, bad).toBe(false);
    }
    expect(safeRelativePath.safeParse("src/auth.ts").success).toBe(true);
  });

  it("requires the entry file extension to match the language", () => {
    const base = DEMO_TASKS[0]!.task;
    expect(taskInputSchema.safeParse({ ...base, entryFile: "auth.py" }).success).toBe(false);
  });

  it("rejects non-identifier function names (no code injection into runners)", () => {
    const base = DEMO_TASKS[0]!.task;
    expect(taskInputSchema.safeParse({ ...base, entryFunction: "x; process.exit()" }).success).toBe(false);
  });

  it("requires two distinct agents and exactly one task source", () => {
    const task = DEMO_TASKS[0]!.task;
    const a = "ckabcdefghijklmnopqrstuvw";
    const b = "ckbbcdefghijklmnopqrstuvw";
    expect(createBenchmarkSchema.safeParse({ task, agentIds: [a] }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ task, agentIds: [a, a] }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ agentIds: [a, b] }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ task, agentIds: [a, b] }).success).toBe(true);
  });

  it("bounds limits", () => {
    const task = DEMO_TASKS[0]!.task;
    const ids = ["ckabcdefghijklmnopqrstuvw", "ckbbcdefghijklmnopqrstuvw"];
    expect(createBenchmarkSchema.safeParse({ task, agentIds: ids, timeoutSeconds: 1 }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ task, agentIds: ids, maxConcurrency: 99 }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ task, agentIds: ids, maxCostUsd: -1 }).success).toBe(false);
  });
});

describe("semaphore", () => {
  it("never exceeds its limit and is FIFO", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const release = await sem.acquire();
        active++;
        peak = Math.max(peak, active);
        order.push(i);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("aborted waiters leave the queue", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const ctrl = new AbortController();
    const waiting = sem.acquire(ctrl.signal);
    ctrl.abort(new Error("stop"));
    await expect(waiting).rejects.toThrow("stop");
    release();
    expect(sem.inUse).toBe(0);
  });
});

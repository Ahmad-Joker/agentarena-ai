import type { RunStatusValue } from "./schemas";

/**
 * Explicit run state machine:
 *   PENDING → RUNNING → COMPLETED | FAILED | CANCELLED | TIMED_OUT
 * PENDING may also go straight to CANCELLED/FAILED (cancelled or rejected before start).
 * Terminal states never transition again.
 */
const TRANSITIONS: Record<RunStatusValue, readonly RunStatusValue[]> = {
  PENDING: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
};

export const TERMINAL_STATUSES: readonly RunStatusValue[] = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];

export function isTerminal(status: RunStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: RunStatusValue, to: RunStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunStatusValue,
    readonly to: RunStatusValue,
  ) {
    super(`Invalid run transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: RunStatusValue, to: RunStatusValue): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Benchmark status derived from its runs. */
export function deriveBenchmarkStatus(
  runStatuses: readonly RunStatusValue[],
  cancelRequested: boolean,
): "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" {
  if (runStatuses.length === 0) return "PENDING";
  if (!runStatuses.every(isTerminal)) {
    return runStatuses.every((s) => s === "PENDING") ? "PENDING" : "RUNNING";
  }
  // A late cancel (all runs already finished, evaluation in progress) must not relabel results.
  if (cancelRequested && runStatuses.includes("CANCELLED")) return "CANCELLED";
  // A benchmark "completes" when at least one run produced a result to compare.
  return runStatuses.some((s) => s === "COMPLETED") ? "COMPLETED" : "FAILED";
}

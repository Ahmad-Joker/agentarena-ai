import type { Profile, Weights } from "@/lib/domain/schemas";

/**
 * Weighted scoring. Weights are product defaults, not scientifically validated.
 *
 *   total = Σ wᵢ·sᵢ / Σ wᵢ    over components that were actually measured
 *   coverage = Σ wᵢ(measured) / Σ wᵢ(all)
 *
 * A component that could not be measured is `null` and is excluded — never counted as 0.
 */
export const DEFAULT_WEIGHTS: Weights = { correctness: 0.55, reliability: 0.15, quality: 0.15, efficiency: 0.1, security: 0.05 };

export const PROFILE_WEIGHTS: Record<Profile, Weights> = {
  BALANCED: DEFAULT_WEIGHTS,
  CORRECTNESS: { correctness: 0.75, reliability: 0.1, quality: 0.08, efficiency: 0.02, security: 0.05 },
  SPEED: { correctness: 0.45, reliability: 0.15, quality: 0.1, efficiency: 0.25, security: 0.05 },
  COST: { correctness: 0.45, reliability: 0.15, quality: 0.1, efficiency: 0.25, security: 0.05 },
};

/** How efficiency splits between wall-clock duration and cost, per profile. */
export const EFFICIENCY_SPLIT: Record<Profile, { duration: number; cost: number }> = {
  BALANCED: { duration: 0.6, cost: 0.4 },
  CORRECTNESS: { duration: 0.6, cost: 0.4 },
  SPEED: { duration: 1, cost: 0 },
  COST: { duration: 0.2, cost: 0.8 },
};

export const PROFILE_LABEL: Record<Profile, string> = {
  BALANCED: "Balanced",
  CORRECTNESS: "Correctness first",
  SPEED: "Speed first",
  COST: "Cost first",
};

export type ComponentKey = keyof Weights;
export const COMPONENT_KEYS: ComponentKey[] = ["correctness", "reliability", "quality", "efficiency", "security"];
export type ComponentScores = Record<ComponentKey, number | null>;

export function normalizeWeights(w: Weights): Weights {
  const sum = COMPONENT_KEYS.reduce((s, k) => s + w[k], 0);
  if (sum <= 0) return DEFAULT_WEIGHTS;
  return Object.fromEntries(COMPONENT_KEYS.map((k) => [k, round(w[k] / sum, 4)])) as Weights;
}

export function weightedTotal(scores: ComponentScores, weights: Weights): { total: number | null; coverage: number } {
  let num = 0;
  let den = 0;
  let all = 0;
  for (const k of COMPONENT_KEYS) {
    all += weights[k];
    const s = scores[k];
    if (s === null || weights[k] === 0) continue;
    num += weights[k] * s;
    den += weights[k];
  }
  return { total: den > 0 ? round(num / den, 4) : null, coverage: all > 0 ? round(den / all, 4) : 0 };
}

/**
 * Relative efficiency among comparable runs: best value / own value, in (0, 1].
 * Requires ≥2 measured values; otherwise the comparison is meaningless → null.
 */
export function relativeEfficiency(own: number | null | undefined, peers: Array<number | null | undefined>): number | null {
  const values = peers.filter((v): v is number => typeof v === "number" && v > 0);
  if (values.length < 2 || typeof own !== "number" || own <= 0) return null;
  return round(Math.min(...values) / own, 4);
}

export function combineEfficiency(duration: number | null, cost: number | null, profile: Profile): number | null {
  const split = EFFICIENCY_SPLIT[profile];
  let num = 0;
  let den = 0;
  if (duration !== null && split.duration > 0) {
    num += duration * split.duration;
    den += split.duration;
  }
  if (cost !== null && split.cost > 0) {
    num += cost * split.cost;
    den += split.cost;
  }
  return den > 0 ? round(num / den, 4) : null;
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

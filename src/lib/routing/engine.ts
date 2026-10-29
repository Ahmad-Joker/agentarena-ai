import type { Category, Language, Profile } from "@/lib/domain/schemas";
import { aggregateByAgent, MIN_SAMPLES, type AgentAggregate, type RunRecord } from "@/lib/analytics/aggregate";

/**
 * Transparent, rules-based routing over accumulated benchmark evidence.
 *
 *  1. Narrowest evidence scope with enough data: language+category → language → all.
 *  2. Only agents compatible with the language and with ≥ MIN_SAMPLES scored runs are eligible.
 *  3. Rank by an objective-specific formula (shown verbatim in the explanation); agents whose
 *     runs tripped a high-severity security gate rank below agents that never did.
 *  4. Confidence from sample size, margin over the runner-up and scope breadth.
 * With fewer than two eligible agents it refuses to recommend.
 */
export const INSUFFICIENT_MESSAGE = "Insufficient benchmark evidence for a reliable recommendation.";

export interface RoutingAgent {
  id: string;
  name: string;
  languages: string[];
  isActive: boolean;
}

export interface RoutingInput {
  language?: Language;
  category?: Category;
  objective: Profile;
}

export interface RankedCandidate {
  agentId: string;
  agentName: string;
  suitability: number;
  metrics: AgentAggregate;
}

export interface RoutingDecision {
  sufficient: boolean;
  message: string;
  confidence: "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH";
  scope: "language+category" | "language" | "all" | null;
  formula: string;
  recommended?: RankedCandidate;
  alternative?: RankedCandidate;
  ranking: RankedCandidate[];
  reasons: string[];
  caveats: string[];
}

const FORMULAS: Record<Profile, string> = {
  BALANCED: "suitability = mean weighted benchmark score",
  CORRECTNESS: "suitability = mean test pass rate (failed runs count as 0)",
  SPEED: "suitability = 0.5 × mean pass rate + 0.5 × (fastest median duration ÷ own median duration)",
  COST: "suitability = 0.5 × mean pass rate + 0.5 × (cheapest mean cost ÷ own mean cost)",
};

export function recommend(input: RoutingInput, records: RunRecord[], agents: RoutingAgent[]): RoutingDecision {
  const compatible = new Set(
    agents.filter((a) => a.isActive && (!input.language || a.languages.includes(input.language))).map((a) => a.id),
  );
  const caveats: string[] = [];
  const scopes: Array<{ name: RoutingDecision["scope"]; filter: (r: RunRecord) => boolean; enabled: boolean }> = [
    { name: "language+category", filter: (r) => r.language === input.language && r.category === input.category, enabled: Boolean(input.language && input.category) },
    { name: "language", filter: (r) => r.language === input.language, enabled: Boolean(input.language) },
    { name: "all", filter: () => true, enabled: true },
  ];

  for (const scope of scopes) {
    if (!scope.enabled) continue;
    const aggs = aggregateByAgent(records.filter((r) => compatible.has(r.agentId) && scope.filter(r)));
    const eligible = aggs.filter((a) => !a.lowSample);
    if (eligible.length < 2) continue;

    const ranking = rank(eligible, input.objective, caveats);
    if (ranking.length < 2) continue;
    if (scope.name !== "language+category") {
      caveats.push(`Not enough evidence for the exact ${scope.name === "language" ? "category" : "language/category"}; using the broader "${scope.name}" scope.`);
    }
    const [top, second] = ranking as [RankedCandidate, RankedCandidate];
    const margin = top.suitability - second.suitability;
    const minN = Math.min(top.metrics.runs, second.metrics.runs);
    let confidence: RoutingDecision["confidence"] = minN >= 10 && margin >= 0.1 ? "HIGH" : minN >= 5 && margin >= 0.05 ? "MEDIUM" : "LOW";
    if (scope.name === "all" && confidence !== "LOW") confidence = confidence === "HIGH" ? "MEDIUM" : "LOW";
    if (margin < 0.03) caveats.push("The top two agents are within 0.03 of each other — treat them as roughly equivalent.");
    if (top.metrics.costSources.includes("SIMULATED")) caveats.push("Evidence comes from SIMULATED demo runs, not live executions.");

    const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
    const reasons = [
      `${top.agentName} ranks first under "${input.objective.toLowerCase()}" with suitability ${top.suitability.toFixed(2)} vs ${second.suitability.toFixed(2)} for ${second.agentName}.`,
      `Based on ${top.metrics.runs} scored runs (pass rate ${pct(top.metrics.meanCorrectness)}, success rate ${pct(top.metrics.successRate)}).`,
      top.metrics.medianDurationMs !== null ? `Median duration ${(top.metrics.medianDurationMs / 1000).toFixed(1)} s.` : "No duration measurements.",
    ];
    return {
      sufficient: true,
      message: `Recommended: ${top.agentName}`,
      confidence,
      scope: scope.name,
      formula: FORMULAS[input.objective],
      recommended: top,
      alternative: second,
      ranking,
      reasons,
      caveats,
    };
  }

  return {
    sufficient: false,
    message: INSUFFICIENT_MESSAGE,
    confidence: "INSUFFICIENT",
    scope: null,
    formula: FORMULAS[input.objective],
    ranking: [],
    reasons: [`At least two compatible agents need ${MIN_SAMPLES}+ scored runs in a matching scope.`],
    caveats,
  };
}

function rank(aggs: AgentAggregate[], objective: Profile, caveats: string[]): RankedCandidate[] {
  const pass = (a: AgentAggregate) => a.meanCorrectness ?? 0;
  let scored: Array<{ a: AgentAggregate; s: number | null }>;
  switch (objective) {
    case "BALANCED":
      scored = aggs.map((a) => ({ a, s: a.meanScore }));
      break;
    case "CORRECTNESS":
      scored = aggs.map((a) => ({ a, s: a.meanCorrectness }));
      break;
    case "SPEED": {
      const best = Math.min(...aggs.map((a) => a.medianDurationMs ?? Infinity));
      scored = aggs.map((a) => ({ a, s: a.medianDurationMs && Number.isFinite(best) ? 0.5 * pass(a) + 0.5 * (best / a.medianDurationMs) : null }));
      break;
    }
    case "COST": {
      const sources = new Set(aggs.flatMap((a) => a.costSources).filter((s) => s !== "UNAVAILABLE"));
      if (sources.size > 1) caveats.push("Cost data mixes sources; cost comparison may not be like-for-like.");
      const costs = aggs.map((a) => a.meanCostUsd).filter((c): c is number => c !== null && c > 0);
      if (costs.length < 2) {
        caveats.push("Cost was not reported for enough agents; cost objective cannot be evaluated.");
        return [];
      }
      const best = Math.min(...costs);
      scored = aggs.map((a) => ({ a, s: a.meanCostUsd ? 0.5 * pass(a) + 0.5 * (best / a.meanCostUsd) : null }));
      break;
    }
  }
  const gated = aggs.filter((a) => a.gatedRuns > 0);
  if (gated.length) {
    caveats.push(
      `Ranked below agents without security gates: ${gated.map((a) => `${a.agentName} (${a.gatedRuns} run(s) with high-severity security findings)`).join(", ")}.`,
    );
  }
  return scored
    .filter((x): x is { a: AgentAggregate; s: number } => x.s !== null)
    .sort((x, y) => (x.a.gatedRuns > 0 ? 1 : 0) - (y.a.gatedRuns > 0 ? 1 : 0) || y.s - x.s)
    .map(({ a, s }) => ({ agentId: a.agentId, agentName: a.agentName, suitability: Math.round(s * 1000) / 1000, metrics: a }));
}

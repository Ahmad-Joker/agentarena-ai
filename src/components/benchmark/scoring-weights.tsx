import { COMPONENT_KEYS, PROFILE_WEIGHTS } from "@/lib/evaluation/scoring";
import type { Profile } from "@/lib/domain/schemas";

const LABELS: Record<string, string> = {
  correctness: "Functional correctness",
  reliability: "Reliability",
  quality: "Code quality",
  efficiency: "Efficiency",
  security: "Security checks",
};

const EXPLAIN: Record<string, string> = {
  correctness: "Share of declarative tests passed in the sandbox",
  reliability: "1 = delivered the required file; 0 = failed / timed out",
  quality: "1 − penalties for static quality findings",
  efficiency: "Relative to the fastest / cheapest completed peer",
  security: "1 − penalties for static security findings",
};

export function ScoringWeights({ profile, weights }: { profile?: Profile; weights?: Record<string, number> }) {
  const w = weights ?? PROFILE_WEIGHTS[profile ?? "BALANCED"];
  return (
    <div>
      <ul className="space-y-2">
        {COMPONENT_KEYS.map((k) => (
          <li key={k} className="text-xs">
            <div className="flex items-center justify-between text-ink-300">
              <span>{LABELS[k]}</span>
              <span className="tabular font-mono text-ink-200">{Math.round((w[k] ?? 0) * 100)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full rounded-full bg-gradient-to-r from-violet to-electric" style={{ width: `${(w[k] ?? 0) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-[10px] text-ink-500">{EXPLAIN[k]}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-md bg-ink-850 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink-400">
        total = Σ wᵢ·sᵢ / Σ wᵢ over measured components only. Unmeasured ≠ 0. A high-severity security finding ranks a run below every run without one.
      </p>
    </div>
  );
}

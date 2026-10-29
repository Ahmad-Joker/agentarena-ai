"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RunDto } from "@/lib/services/dto";

const COMPONENTS = [
  ["correctness", "Correctness"],
  ["reliability", "Reliability"],
  ["quality", "Quality"],
  ["efficiency", "Efficiency"],
  ["security", "Security"],
] as const;

/** Grouped bars of component scores per agent. Unmeasured components are omitted, not drawn as 0. */
export function ScoreBreakdownChart({ runs }: { runs: RunDto[] }) {
  const scored = runs.filter((r) => r.evaluation);
  const data = COMPONENTS.map(([key, label]) => {
    const row: Record<string, string | number | null> = { component: label };
    for (const r of scored) row[r.agent.name] = r.evaluation!.components[key];
    return row;
  });
  if (!scored.length) return null;
  return (
    <div className="h-56" role="img" aria-label="Component score comparison chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#232734" />
          <XAxis dataKey="component" tick={{ fill: "#a2a8bd", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 1]} tick={{ fill: "#737a94", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgb(139 92 246 / 0.06)" }}
            contentStyle={{ background: "#13151d", border: "1px solid #2f3445", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => (typeof v === "number" ? v.toFixed(2) : "not measured")}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#a2a8bd" }} />
          {scored.map((r) => (
            <Bar key={r.id} dataKey={r.agent.name} fill={r.agent.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

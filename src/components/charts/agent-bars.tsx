"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface AgentBarDatum {
  name: string;
  value: number | null;
  color: string;
  note?: string;
}

const tooltipStyle = {
  background: "#13151d",
  border: "1px solid #2f3445",
  borderRadius: 8,
  fontSize: 12,
  color: "#eceef4",
};

/** Horizontal bars per agent. Values are in [0,1] unless `format` says otherwise. */
export function AgentBars({ data, format = "score", height = 200 }: { data: AgentBarDatum[]; format?: "score" | "percent" | "seconds"; height?: number }) {
  const fmt = (v: number) => (format === "percent" ? `${Math.round(v * 100)}%` : format === "seconds" ? `${v.toFixed(1)} s` : v.toFixed(2));
  const rows = data.filter((d) => d.value !== null) as Array<AgentBarDatum & { value: number }>;
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart: ${rows.map((r) => `${r.name} ${fmt(r.value)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#232734" />
          <XAxis type="number" domain={format === "seconds" ? [0, "auto"] : [0, 1]} tick={{ fill: "#737a94", fontSize: 11 }} tickFormatter={fmt} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fill: "#cdd1de", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgb(139 92 246 / 0.06)" }} contentStyle={tooltipStyle} formatter={(v) => [typeof v === "number" ? fmt(v) : String(v), format === "seconds" ? "Median duration" : "Value"]} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.color} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

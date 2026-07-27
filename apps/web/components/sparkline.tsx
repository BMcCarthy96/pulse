"use client";

import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

export function Sparkline({ data }: { data: { errorRate: number }[] }) {
  if (data.length === 0) {
    return <div className="text-muted-foreground flex h-8 w-24 items-center text-xs">no data</div>;
  }
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <YAxis domain={[0, 1]} hide />
          <Area type="monotone" dataKey="errorRate" stroke="#64748b" fill="#cbd5e1" strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

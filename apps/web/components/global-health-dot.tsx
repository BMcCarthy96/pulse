"use client";

import { usePolling } from "@/lib/hooks";
import type { OverviewResponse } from "@/lib/types";

const RANK: Record<string, number> = { DOWN: 3, DEGRADED: 2, PAUSED: 1, HEALTHY: 0 };
const DOT_COLOR: Record<string, string> = {
  DOWN: "bg-red-500",
  DEGRADED: "bg-amber-500",
  PAUSED: "bg-slate-400",
  HEALTHY: "bg-emerald-500",
};
const LABEL: Record<string, string> = {
  DOWN: "One or more connectors are down",
  DEGRADED: "One or more connectors are degraded",
  PAUSED: "One or more connectors are paused",
  HEALTHY: "All systems healthy",
};

export function GlobalHealthDot() {
  const { data } = usePolling<OverviewResponse>("/api/v1/overview");
  const worst = (data?.connectors ?? []).reduce(
    (acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc),
    "HEALTHY",
  );

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${DOT_COLOR[worst]}`} title={LABEL[worst]} />
      <span className="text-muted-foreground text-sm">{LABEL[worst]}</span>
    </div>
  );
}

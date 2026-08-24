"use client";

import { usePolling } from "@/lib/hooks";
import type { OverviewResponse } from "@/lib/types";

const RANK: Record<string, number> = { DOWN: 3, DEGRADED: 2, PAUSED: 1, HEALTHY: 0, UNKNOWN: -1 };
const DOT_COLOR: Record<string, string> = {
  DOWN: "bg-red-500",
  DEGRADED: "bg-amber-500",
  PAUSED: "bg-slate-400",
  HEALTHY: "bg-emerald-500",
  UNKNOWN: "bg-slate-300",
};
const LABEL: Record<string, string> = {
  DOWN: "One or more connectors are down",
  DEGRADED: "One or more connectors are degraded",
  PAUSED: "One or more connectors are paused",
  HEALTHY: "All systems healthy",
  UNKNOWN: "Status unavailable",
};

export function GlobalHealthDot() {
  const { data, error } = usePolling<OverviewResponse>("/api/v1/overview");
  if (error) {
    return (
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-400" title="Status unavailable" />
        <span className="text-muted-foreground text-sm">Status unavailable</span>
      </div>
    );
  }
  const worst = (data?.connectors ?? []).reduce(
    (acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc),
    data ? "HEALTHY" : "UNKNOWN",
  );

  const label = data ? LABEL[worst] : "Checking connector status";

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span
        className={`h-2.5 w-2.5 rounded-full ${DOT_COLOR[worst] ?? "bg-slate-300"}`}
        title={label}
      />
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}

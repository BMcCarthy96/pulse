import { cn } from "@/lib/utils";
import { bucketed, HEALTH_STRIP_MAX_SEGMENTS } from "@/lib/health-strip-buckets";

const STATUS_COLOR: Record<string, string> = {
  HEALTHY: "bg-emerald-500",
  DEGRADED: "bg-amber-500",
  DOWN: "bg-red-500",
  PAUSED: "bg-slate-400",
};

export function HealthStrip({ snapshots }: { snapshots: { status: string }[] }) {
  if (snapshots.length === 0) {
    return <div className="text-muted-foreground text-xs">No recent snapshots</div>;
  }

  const segments = bucketed(snapshots, HEALTH_STRIP_MAX_SEGMENTS);

  return (
    // `min-w-0` belts-and-braces the bucketing: even if a caller passes more than
    // HEALTH_STRIP_MAX_SEGMENTS, the strip shrinks rather than widening the page.
    <div className="flex h-4 w-full min-w-0 gap-px overflow-hidden rounded">
      {segments.map((status, i) => (
        <div key={i} className={cn("min-w-0 flex-1", STATUS_COLOR[status] ?? "bg-slate-200")} />
      ))}
    </div>
  );
}

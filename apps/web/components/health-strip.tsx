import { cn } from "@/lib/utils";

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
  return (
    <div className="flex h-4 w-full gap-px overflow-hidden rounded">
      {snapshots.map((s, i) => (
        <div key={i} className={cn("flex-1", STATUS_COLOR[s.status] ?? "bg-slate-200")} />
      ))}
    </div>
  );
}

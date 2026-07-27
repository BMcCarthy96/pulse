import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const INCIDENT_STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-red-100 text-red-800 border-red-200",
  ACKNOWLEDGED: "bg-amber-100 text-amber-800 border-amber-200",
  MONITORING: "bg-blue-100 text-blue-800 border-blue-200",
  RESOLVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export function IncidentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", INCIDENT_STATUS_STYLES[status] ?? "")}>
      {status}
    </Badge>
  );
}

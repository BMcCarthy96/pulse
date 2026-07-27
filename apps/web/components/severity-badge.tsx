import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  WARNING: "bg-amber-100 text-amber-800 border-amber-200",
};

const EVENT_STATUS_STYLES: Record<string, string> = {
  RECEIVED: "bg-slate-100 text-slate-700 border-slate-200",
  PROCESSING: "bg-blue-100 text-blue-800 border-blue-200",
  PROCESSED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  FAILED: "bg-red-100 text-red-800 border-red-200",
  DUPLICATE: "bg-slate-100 text-slate-700 border-slate-200",
  INVALID: "bg-red-100 text-red-800 border-red-200",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", SEVERITY_STYLES[severity] ?? "")}>
      {severity}
    </Badge>
  );
}

export function EventStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", EVENT_STATUS_STYLES[status] ?? "")}>
      {status}
    </Badge>
  );
}

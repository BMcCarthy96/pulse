import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE_STYLES = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  bad: "bg-red-100 text-red-800 border-red-200",
  active: "bg-blue-100 text-blue-800 border-blue-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
} as const;

type Tone = keyof typeof TONE_STYLES;

/**
 * Single source of truth for status colour across the app (see CLAUDE.md: status colours
 * only via StatusBadge). Covers ConnectorStatus, RunStatus, JobStatus and LogLevel — they
 * never collide, and sharing the map keeps "SUCCEEDED is green" true everywhere.
 */
const STATUS_TONES: Record<string, Tone> = {
  // ConnectorStatus
  HEALTHY: "ok",
  DEGRADED: "warn",
  DOWN: "bad",
  PAUSED: "neutral",
  // RunStatus
  RUNNING: "active",
  SUCCEEDED: "ok",
  PARTIAL: "warn",
  // JobStatus (FAILED shared with RunStatus)
  QUEUED: "neutral",
  ACTIVE: "active",
  FAILED: "bad",
  DEAD: "bad",
  // LogLevel
  DEBUG: "neutral",
  INFO: "active",
  WARN: "warn",
  ERROR: "bad",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TONE_STYLES[STATUS_TONES[status] ?? "neutral"])}>
      {label ?? status}
    </Badge>
  );
}

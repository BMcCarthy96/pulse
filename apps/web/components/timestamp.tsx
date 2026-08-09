"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function relativeTime(date: Date): string {
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function Timestamp({ date }: { date: string | Date | null | undefined }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Client-only mount flag so the first render matches SSR output (avoids hydration
    // mismatch between the server's absolute timestamp and the client's relative one).
    setMounted(true);
  }, []);

  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = typeof date === "string" ? new Date(date) : date;

  if (!mounted) {
    return <span>{d.toLocaleString()}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default" />}>
        {relativeTime(d)}
      </TooltipTrigger>
      <TooltipContent>{d.toLocaleString()}</TooltipContent>
    </Tooltip>
  );
}

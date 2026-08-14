"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { RoleGate } from "@/components/role-gate";
import { usePolling } from "@/lib/hooks";
import type { OverviewResponse } from "@/lib/types";
import {
  Activity,
  BookOpen,
  Boxes,
  Cable,
  CircleAlert,
  ClipboardList,
  FileText,
  Settings2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/connectors", label: "Connectors", icon: Cable },
  { href: "/jobs", label: "Jobs", icon: Boxes },
  { href: "/events", label: "Events", icon: FileText },
  { href: "/incidents", label: "Incidents", icon: CircleAlert },
  { href: "/logs", label: "Logs", icon: ClipboardList },
] as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const { data } = usePolling<OverviewResponse>("/api/v1/overview");
  const deadJobs = data?.totals.deadJobs ?? 0;
  const openIncidents = data?.totals.openIncidents ?? 0;

  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Primary navigation">
      <p className="text-muted-foreground px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
        Monitor
      </p>
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const bubble =
          item.href === "/jobs" ? deadJobs : item.href === "/incidents" ? openIncidents : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            <span className="flex items-center gap-2">
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </span>
            {bubble > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                {bubble}
              </span>
            )}
          </Link>
        );
      })}
      {/* Reference material rather than an operational view, so it sits below the divider and
          outside the badge logic. */}
      <div className="my-2 border-t" />
      <p className="text-muted-foreground px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
        Reference
      </p>
      <Link
        href="/docs/api"
        onClick={onNavigate}
        className={cn(
          "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
          pathname.startsWith("/docs")
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-secondary/60",
        )}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="size-4" aria-hidden="true" />
          API reference
        </span>
      </Link>
      <RoleGate minRole="ADMIN">
        <p className="text-muted-foreground mt-3 px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
          Admin
        </p>
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-secondary/60",
          )}
        >
          <span className="flex items-center gap-2">
            <Settings2 className="size-4" aria-hidden="true" />
            Settings
          </span>
        </Link>
      </RoleGate>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { RoleGate } from "@/components/role-gate";
import { usePolling } from "@/lib/hooks";
import type { OverviewResponse } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/connectors", label: "Connectors" },
  { href: "/jobs", label: "Jobs" },
  { href: "/events", label: "Events" },
  { href: "/incidents", label: "Incidents" },
  { href: "/logs", label: "Logs" },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { data } = usePolling<OverviewResponse>("/api/v1/overview");
  const deadJobs = data?.totals.deadJobs ?? 0;
  const openIncidents = data?.totals.openIncidents ?? 0;

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const bubble =
          item.href === "/jobs" ? deadJobs : item.href === "/incidents" ? openIncidents : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            <span>{item.label}</span>
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
      <div className="my-1 border-t" />
      <Link
        href="/docs/api"
        className={cn(
          "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
          pathname.startsWith("/docs")
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-secondary/60",
        )}
      >
        API reference
      </Link>
      <RoleGate minRole="ADMIN">
        <Link
          href="/settings"
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-secondary/60",
          )}
        >
          Settings
        </Link>
      </RoleGate>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { usePolling } from "@/lib/hooks";
import type { OverviewResponse, ConnectorRow } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { SeverityBadge } from "@/components/severity-badge";
import { Timestamp } from "@/components/timestamp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useGuidedWalkthrough } from "@/components/guided-walkthrough";

const CONNECTOR_COLORS: Record<string, string> = {
  "ehr-fhir": "#2563eb",
  "lab-results": "#16a34a",
  claims: "#d97706",
  eligibility: "#9333ea",
};

export default function OverviewPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isGuidedDemo = Boolean(session?.user?.demoSessionId);
  const { completeStep } = useGuidedWalkthrough();
  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    mutate: refreshOverview,
  } = usePolling<OverviewResponse>("/api/v1/overview");
  const { data: connectorsResp } = usePolling<{ data: ConnectorRow[] }>("/api/v1/connectors");

  const connectors = connectorsResp?.data ?? [];
  const chartData = buildChartData(connectors);

  const primaryIncident = overview?.recentIncidents.find(
    (incident) => incident.status !== "RESOLVED",
  );
  const needsAttention = Boolean(
    overview && (overview.totals.deadJobs > 0 || overview.totals.openIncidents > 0),
  );

  return (
    <div>
      <PageHeader title="Overview" description="Integration health across all connectors." />

      {overviewError && (
        <div
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
          aria-live="polite"
        >
          <span>Connector status is unavailable right now. The values below may be stale.</span>
          <Button size="sm" variant="outline" onClick={() => void refreshOverview()}>
            Try again
          </Button>
        </div>
      )}

      {isGuidedDemo && (
        <section
          id="demo-overview"
          tabIndex={-1}
          className="mb-6 overflow-hidden rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 via-white to-indigo-50 p-5 shadow-sm focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-teal-700 uppercase">
                Synthetic incident workspace
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">
                {needsAttention && primaryIncident
                  ? `${primaryIncident.connectorDisplayName} needs an operator`
                  : "Connectors are ready for review"}
              </h2>
              <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                See why the EHR sync failed, check the evidence, then approve a retry and confirm it
                in the audit.
              </p>
              <p className="mt-2 text-xs text-teal-900/70">
                Start with the highlighted button, or use Walkthrough in the header whenever you
                want to pick this back up.
              </p>
            </div>
            {primaryIncident ? (
              <Link
                href={`/incidents/${primaryIncident.id}#investigation-heading`}
                data-walkthrough="open-incident"
                onClick={() => completeStep("open-incident")}
                className="inline-flex shrink-0 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                Open incident →
              </Link>
            ) : (
              <Link
                href="/incidents"
                data-walkthrough="open-incident"
                onClick={() => completeStep("open-incident")}
                className="inline-flex shrink-0 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                Explore incidents →
              </Link>
            )}
          </div>
        </section>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Dead jobs"
          value={overview?.totals.deadJobs ?? "—"}
          tone={overview && overview.totals.deadJobs > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="Open incidents"
          value={overview?.totals.openIncidents ?? "—"}
          tone={overview && overview.totals.openIncidents > 0 ? "danger" : "default"}
        />
        <KpiCard label="Events (1h)" value={overview?.totals.eventsLastHour ?? "—"} />
        <KpiCard label="Jobs (1h)" value={overview?.totals.jobsLastHour ?? "—"} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overviewLoading && !overview
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
          : overview?.connectors.map((c) => (
              <Link key={c.key} href={`/connectors/${c.key}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">{c.displayName}</CardTitle>
                      <StatusBadge status={c.paused ? "PAUSED" : c.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-muted-foreground flex items-center justify-between text-xs">
                      <span>error rate (15m): {(c.errorRate * 100).toFixed(1)}%</span>
                      <span>
                        last activity: <Timestamp date={c.lastActivity} />
                      </span>
                    </div>
                    {c.openIncidentId && (
                      // Nested <a> is invalid, so stop the tile's navigation and route here.
                      <span
                        role="link"
                        tabIndex={0}
                        className="block cursor-pointer text-xs font-medium text-red-600 hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          router.push(`/incidents/${c.openIncidentId}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          e.stopPropagation();
                          router.push(`/incidents/${c.openIncidentId}`);
                        }}
                      >
                        Open incident →
                      </span>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Error rate per connector (24h)</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyState
              title="No snapshot data yet"
              hint="Health snapshots accumulate every 60 seconds."
            />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={40} />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  />
                  <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {connectors.map((c) => (
                    <Line
                      key={c.key}
                      type="monotone"
                      dataKey={c.key}
                      name={c.displayName}
                      stroke={CONNECTOR_COLORS[c.key] ?? "#64748b"}
                      dot={false}
                      strokeWidth={1.5}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent incidents</CardTitle>
        </CardHeader>
        <CardContent>
          {overview && overview.recentIncidents.length === 0 ? (
            <EmptyState
              title="No incidents"
              hint="Incidents auto-open when a connector degrades or goes down."
            />
          ) : (
            <div className="divide-y">
              {overview?.recentIncidents.map((i) => (
                <Link
                  key={i.id}
                  href={`/incidents/${i.id}`}
                  className="hover:bg-muted/40 flex items-center justify-between py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <SeverityBadge severity={i.severity} />
                    <span className="font-medium">{i.title}</span>
                    <span className="text-muted-foreground">{i.connectorDisplayName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={i.status} />
                    <Timestamp date={i.openedAt} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function buildChartData(connectors: ConnectorRow[]) {
  if (connectors.length === 0) return [];
  const maxLen = Math.max(...connectors.map((c) => c.sparkline.length));
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < maxLen; i++) {
    const row: Record<string, unknown> = {};
    let label = "";
    for (const c of connectors) {
      const point = c.sparkline[i];
      if (point) {
        row[c.key] = point.errorRate;
        label = new Date(point.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }
    row.label = label;
    rows.push(row);
  }
  return rows;
}

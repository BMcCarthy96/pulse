"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { SeverityBadge } from "@/components/severity-badge";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { Timestamp } from "@/components/timestamp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONNECTOR_DEFS } from "@pulse/shared";
import { usePaginatedList } from "@/lib/use-paginated";
import type { IncidentRow } from "@/lib/types";
import { formatDuration } from "@/lib/format";

const STATUS_OPTIONS = ["ACTIVE", "OPEN", "ACKNOWLEDGED", "MONITORING", "RESOLVED", "ALL"] as const;

export default function IncidentsPage() {
  const [status, setStatus] = useState<string>("ALL");
  const [connectorKey, setConnectorKey] = useState<string>("ALL");

  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (connectorKey !== "ALL") params.set("connectorKey", connectorKey);
  params.set("limit", "25");

  const { items, error, isLoading, mutate, nextCursor, loadMore, loadingMore } = usePaginatedList<IncidentRow>(
    `/api/v1/incidents?${params.toString()}`,
  );

  const columns: Column<IncidentRow>[] = [
    { key: "severity", header: "Severity", render: (r) => <SeverityBadge severity={r.severity} /> },
    {
      key: "title",
      header: "Incident",
      render: (r) => (
        <Link href={`/incidents/${r.id}`} className="font-medium hover:underline">
          {r.title}
        </Link>
      ),
    },
    { key: "connector", header: "Connector", render: (r) => r.connector.displayName },
    { key: "status", header: "Status", render: (r) => <IncidentStatusBadge status={r.status} /> },
    { key: "openedAt", header: "Opened", render: (r) => <Timestamp date={r.openedAt} /> },
    {
      key: "duration",
      header: "Duration",
      // Open incidents keep counting; the 10s poll is what makes it tick.
      render: (r) => formatDuration(new Date(r.openedAt), r.resolvedAt ? new Date(r.resolvedAt) : new Date()),
    },
  ];

  return (
    <div>
      <PageHeader title="Incidents" description="Detected by the health engine, plus anything resolved by hand." />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v ?? "ALL")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "ALL" ? "All statuses" : s === "ACTIVE" ? "Active (not resolved)" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={connectorKey} onValueChange={(v) => setConnectorKey(v ?? "ALL")}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Connector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All connectors</SelectItem>
            {CONNECTOR_DEFS.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        error={error}
        onRetry={() => mutate()}
        emptyTitle="No incidents"
        emptyHint="Set a connector to OUTAGE from its detail page to watch one open."
        nextCursor={nextCursor}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}

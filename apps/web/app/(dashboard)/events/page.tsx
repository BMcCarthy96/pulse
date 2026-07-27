"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { EventStatusBadge } from "@/components/severity-badge";
import { Timestamp } from "@/components/timestamp";
import { JsonViewer } from "@/components/json-viewer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CONNECTOR_DEFS } from "@pulse/shared";
import { usePaginatedList } from "@/lib/use-paginated";
import type { EventRow } from "@/lib/types";

const STATUS_OPTIONS = ["ALL", "RECEIVED", "PROCESSING", "PROCESSED", "FAILED", "DUPLICATE", "INVALID"] as const;
const DIRECTION_OPTIONS = ["ALL", "INBOUND", "OUTBOUND"] as const;

export default function EventsPage() {
  const [status, setStatus] = useState<string>("ALL");
  const [direction, setDirection] = useState<string>("ALL");
  const [connectorKey, setConnectorKey] = useState<string>("ALL");
  const [selected, setSelected] = useState<EventRow | null>(null);

  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (direction !== "ALL") params.set("direction", direction);
  if (connectorKey !== "ALL") params.set("connectorKey", connectorKey);
  params.set("limit", "25");

  const { items, error, isLoading, mutate, nextCursor, loadMore, loadingMore } = usePaginatedList<EventRow>(
    `/api/v1/events?${params.toString()}`,
  );

  const columns: Column<EventRow>[] = [
    { key: "eventType", header: "Type", render: (r) => r.eventType },
    { key: "connector", header: "Connector", render: (r) => r.connector.displayName },
    { key: "direction", header: "Direction", render: (r) => r.direction },
    { key: "status", header: "Status", render: (r) => <EventStatusBadge status={r.status} /> },
    { key: "dedupeKey", header: "Dedupe key", render: (r) => <code className="text-xs">{r.dedupeKey?.slice(0, 8) ?? "—"}</code> },
    { key: "receivedAt", header: "Received", render: (r) => <Timestamp date={r.receivedAt} /> },
    { key: "processedAt", header: "Processed", render: (r) => <Timestamp date={r.processedAt} /> },
  ];

  return (
    <div>
      <PageHeader title="Events" description="Inbound and outbound webhook activity." />

      <div className="mb-4 flex flex-wrap gap-2">
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

        <Select value={direction} onValueChange={(v) => setDirection(v ?? "ALL")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            {DIRECTION_OPTIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {d === "ALL" ? "All directions" : d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => setStatus(v ?? "ALL")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "ALL" ? "All statuses" : s}
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
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No events"
        emptyHint="Use a connector's 'Simulate incoming results' or 'Submit test claims' action to generate events."
        nextCursor={nextCursor}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.eventType}</SheetTitle>
                <SheetDescription>
                  {selected.connector.displayName} · {selected.direction} · <EventStatusBadge status={selected.status} />
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                {selected.error && (
                  <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{selected.error}</p>
                )}
                <JsonViewer data={selected.payload} label="Payload" />
                <JsonViewer data={selected.headers} label="Headers (signature status)" />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

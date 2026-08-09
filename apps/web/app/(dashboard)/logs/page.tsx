"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Timestamp } from "@/components/timestamp";
import { JsonViewer } from "@/components/json-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CONNECTOR_DEFS } from "@pulse/shared";
import { usePaginatedList } from "@/lib/use-paginated";
import type { LogRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export default function LogsPage() {
  const [levels, setLevels] = useState<string[]>([]);
  const [connectorKey, setConnectorKey] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<LogRow | null>(null);

  const params = new URLSearchParams();
  if (levels.length > 0) params.set("level", levels.join(","));
  if (connectorKey !== "ALL") params.set("connectorKey", connectorKey);
  if (q.trim()) params.set("q", q.trim());
  params.set("limit", "30");

  const { items, error, isLoading, mutate, nextCursor, loadMore, loadingMore } =
    usePaginatedList<LogRow>(live ? `/api/v1/logs?${params.toString()}` : null);

  function toggleLevel(level: string) {
    setLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  }

  const columns: Column<LogRow>[] = [
    { key: "level", header: "Level", render: (r) => <StatusBadge status={r.level} /> },
    { key: "source", header: "Source", render: (r) => r.source },
    { key: "connector", header: "Connector", render: (r) => r.connector?.displayName ?? "—" },
    {
      key: "message",
      header: "Message",
      render: (r) => <span className="line-clamp-1">{r.message}</span>,
    },
    { key: "createdAt", header: "Time", render: (r) => <Timestamp date={r.createdAt} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Logs"
        description="Structured logs from the web app, worker, and simulator."
        actions={
          <Button
            size="sm"
            variant={live ? "default" : "outline"}
            onClick={() => setLive((v) => !v)}
          >
            Live: {live ? "On" : "Off"}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => toggleLevel(l)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium",
                levels.includes(l) ? "border-primary bg-primary/10" : "text-muted-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>

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

        <Input
          placeholder="Search message..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        error={error}
        onRetry={() => mutate()}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No logs match these filters"
        emptyHint="Try clearing the level or connector filter."
        nextCursor={nextCursor}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.message}</SheetTitle>
                <SheetDescription>
                  {selected.level} · {selected.source} ·{" "}
                  {selected.connector?.displayName ?? "no connector"}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                <JsonViewer data={selected.context} label="Context" />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

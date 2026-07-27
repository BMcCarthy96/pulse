"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Timestamp } from "@/components/timestamp";
import { JsonViewer } from "@/components/json-viewer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RoleGate } from "@/components/role-gate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CONNECTOR_DEFS } from "@pulse/shared";
import { usePaginatedList } from "@/lib/use-paginated";
import { usePolling } from "@/lib/hooks";
import { apiPost } from "@/lib/api-client";
import type { JobRow, PaginatedResponse } from "@/lib/types";
import { toast } from "sonner";

const STATUS_OPTIONS = ["DEAD", "FAILED", "SUCCEEDED", "ACTIVE", "QUEUED", "ALL"] as const;
/** Server-side cap on one bulk retry (doc 04: `POST /v1/jobs/retry-bulk`). */
const BULK_RETRY_CAP = 100;

export default function JobsPage() {
  const [status, setStatus] = useState<string>("DEAD");
  const [connectorKey, setConnectorKey] = useState<string>("ALL");
  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null);

  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (connectorKey !== "ALL") params.set("connectorKey", connectorKey);
  params.set("limit", "25");

  const { items, error, isLoading, mutate, nextCursor, loadMore, loadingMore } = usePaginatedList<JobRow>(
    `/api/v1/jobs?${params.toString()}`,
  );

  // "Retry all matching" ignores the status filter (it only ever touches DEAD) and is not
  // limited to the loaded page, so its count comes from its own COUNT query — not `items`.
  const deadParams = new URLSearchParams({ status: "DEAD", limit: "1", withTotal: "1" });
  if (connectorKey !== "ALL") deadParams.set("connectorKey", connectorKey);
  const { data: deadPage, mutate: mutateDeadCount } = usePolling<PaginatedResponse<JobRow>>(
    `/api/v1/jobs?${deadParams.toString()}`,
  );
  const deadCount = deadPage?.total ?? 0;
  const bulkCount = Math.min(deadCount, BULK_RETRY_CAP);

  async function retryJob(id: string) {
    try {
      await apiPost(`/api/v1/jobs/${id}/retry`);
      toast.success("Job re-queued");
      void mutate();
      void mutateDeadCount();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    }
  }

  const columns: Column<JobRow>[] = [
    { key: "type", header: "Type", render: (r) => r.type },
    { key: "connector", header: "Connector", render: (r) => r.connector.displayName },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "attempts", header: "Attempts", render: (r) => `${r.attempts}/${r.maxAttempts}` },
    {
      key: "lastError",
      header: "Last error",
      render: (r) => (r.lastError ? <span className="text-red-600">{truncate(r.lastError, 60)}</span> : "—"),
    },
    { key: "createdAt", header: "Created", render: (r) => <Timestamp date={r.createdAt} /> },
    { key: "finishedAt", header: "Finished", render: (r) => <Timestamp date={r.finishedAt} /> },
    {
      key: "actions",
      header: "",
      render: (r) =>
        (r.status === "DEAD" || r.status === "FAILED") && (
          <RoleGate minRole="OPS">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                void retryJob(r.id);
              }}
            >
              Retry
            </Button>
          </RoleGate>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Failed job queue"
        description="Jobs that failed and are awaiting retry, plus recent activity."
        actions={
          <RoleGate minRole="OPS">
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={deadCount === 0}>
                  Retry all matching ({deadCount})
                </Button>
              }
              title="Retry all matching DEAD jobs?"
              description={
                `This will re-queue ${bulkCount} DEAD job(s)${connectorKey !== "ALL" ? ` for ${connectorKey}` : " across all connectors"}.` +
                (deadCount > BULK_RETRY_CAP
                  ? ` ${deadCount} match in total — the oldest ${BULK_RETRY_CAP} go first; run it again for the rest.`
                  : "")
              }
              confirmLabel="Retry all"
              onConfirm={async () => {
                try {
                  const res = await apiPost<{ retried: number }>("/api/v1/jobs/retry-bulk", {
                    connectorKey: connectorKey !== "ALL" ? connectorKey : undefined,
                  });
                  toast.success(`Retried ${res.retried} job(s)`);
                  void mutate();
                  void mutateDeadCount();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Bulk retry failed");
                }
              }}
            />
          </RoleGate>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v ?? "DEAD")}>
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
        onRowClick={(row) => setSelectedJob(row)}
        emptyTitle="No failed jobs"
        emptyHint="Inject chaos from a connector page to see this fill up."
        nextCursor={nextCursor}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />

      <Sheet open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selectedJob && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedJob.type}</SheetTitle>
                <SheetDescription>
                  {selectedJob.connector.displayName} · {selectedJob.status} · attempt{" "}
                  {selectedJob.attempts}/{selectedJob.maxAttempts}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                <JsonViewer data={selectedJob.payload} label="Payload" />
                {selectedJob.errorHistory.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium">Error history</p>
                    <ol className="space-y-2 border-l pl-3">
                      {selectedJob.errorHistory.map((e, i) => (
                        <li key={i} className="text-xs">
                          <span className="text-muted-foreground">attempt {e.attempt} · </span>
                          <Timestamp date={e.at} />
                          <p className="text-red-600">{e.message}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {(selectedJob.status === "DEAD" || selectedJob.status === "FAILED") && (
                  <RoleGate minRole="OPS">
                    <Button
                      size="sm"
                      onClick={() => {
                        void retryJob(selectedJob.id);
                        setSelectedJob(null);
                      }}
                    >
                      Retry this job
                    </Button>
                  </RoleGate>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

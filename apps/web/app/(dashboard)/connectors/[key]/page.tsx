"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { usePolling } from "@/lib/hooks";
import { apiPatch, apiPost } from "@/lib/api-client";
import type { ConnectorDetailResponse, JobRow, EventRow, LogRow } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { HealthStrip } from "@/components/health-strip";
import { Timestamp } from "@/components/timestamp";
import { DataTable, type Column } from "@/components/data-table";
import { RoleGate } from "@/components/role-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EventStatusBadge } from "@/components/severity-badge";
import { toast } from "sonner";
import { ChaosPanel } from "./chaos-panel";
import { EligibilityDialog } from "./eligibility-dialog";

export default function ConnectorDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const router = useRouter();
  const { data, error, isLoading, mutate } = usePolling<ConnectorDetailResponse>(`/api/v1/connectors/${key}`);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Failed to load connector.</p>
        <Button size="sm" variant="outline" onClick={() => mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data) {
    router.push("/connectors");
    return null;
  }

  const { connector } = data;

  return (
    <div>
      <PageHeader
        title={connector.displayName}
        description={connector.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={connector.paused ? "PAUSED" : connector.status} />
            <RoleGate minRole="ADMIN">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await apiPatch(`/api/v1/connectors/${key}`, { paused: !connector.paused });
                    toast.success(connector.paused ? "Connector resumed" : "Connector paused");
                    void mutate();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to update connector");
                  }
                }}
              >
                {connector.paused ? "Resume" : "Pause"}
              </Button>
            </RoleGate>
            <RoleGate minRole="OPS">
              <ConnectorActions connectorKey={key} kind={connector.kind} onDone={() => void mutate()} />
            </RoleGate>
          </div>
        }
      />

      <RoleGate minRole="ADMIN">
        <div className="mb-6">
          <ChaosPanel connectorKey={key} currentMode={connector.chaosMode} onChanged={() => void mutate()} />
        </div>
      </RoleGate>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Health timeline (24h)</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthStrip snapshots={data.snapshots} />
        </CardContent>
      </Card>

      <Tabs defaultValue="sync">
        <TabsList>
          <TabsTrigger value="sync">Sync History</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="mt-4">
          <SyncHistoryTable runs={data.recentRuns} />
        </TabsContent>
        <TabsContent value="jobs" className="mt-4">
          <ConnectorJobsTable connectorKey={key} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <ConnectorEventsTable connectorKey={key} />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <ConnectorLogsTable connectorKey={key} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConnectorActions({
  connectorKey,
  kind,
  onDone,
}: {
  connectorKey: string;
  kind: string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: string, path: string, body?: unknown) {
    setPending(action);
    try {
      await apiPost(path, body);
      toast.success(`${action} triggered`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to trigger ${action}`);
    } finally {
      setPending(null);
    }
  }

  if (kind === "poll_sync") {
    return (
      <Button
        size="sm"
        disabled={pending === "sync"}
        onClick={() => run("sync", `/api/v1/connectors/${connectorKey}/sync`)}
      >
        {pending === "sync" ? "Starting..." : "Run sync now"}
      </Button>
    );
  }
  if (kind === "inbound_webhook") {
    return (
      <Button
        size="sm"
        disabled={pending === "simulate"}
        onClick={() => run("simulate", "/api/v1/simulate/lab-results", { count: 5 })}
      >
        {pending === "simulate" ? "Sending..." : "Simulate incoming results"}
      </Button>
    );
  }
  if (kind === "outbound_async") {
    return (
      <Button
        size="sm"
        disabled={pending === "claims"}
        onClick={() => run("claims", "/api/v1/simulate/claims", { count: 3 })}
      >
        {pending === "claims" ? "Submitting..." : "Submit test claims"}
      </Button>
    );
  }
  if (kind === "request_response") {
    return <EligibilityDialog />;
  }
  return null;
}

function SyncHistoryTable({ runs }: { runs: ConnectorDetailResponse["recentRuns"] }) {
  const cols: Column<ConnectorDetailResponse["recentRuns"][number]>[] = [
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "trigger", header: "Trigger", render: (r) => r.trigger },
    {
      key: "duration",
      header: "Duration",
      render: (r) =>
        r.finishedAt
          ? `${Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
          : "running...",
    },
    { key: "records", header: "Records", render: (r) => `${r.recordsFetched} fetched, ${r.recordsFailed} failed` },
    { key: "started", header: "Started", render: (r) => <Timestamp date={r.startedAt} /> },
    { key: "error", header: "Error", render: (r) => (r.error ? <span className="text-red-600">{r.error}</span> : "—") },
  ];
  return (
    <DataTable
      columns={cols}
      data={runs}
      isLoading={false}
      emptyTitle="No sync runs yet"
      emptyHint="Trigger a manual sync to see history here."
    />
  );
}

function ConnectorJobsTable({ connectorKey }: { connectorKey: string }) {
  const { data, error, isLoading, mutate } = usePolling<{ data: JobRow[] }>(
    `/api/v1/jobs?connectorKey=${connectorKey}&limit=20`,
  );
  const columns: Column<JobRow>[] = [
    { key: "type", header: "Type", render: (r) => r.type },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "attempts", header: "Attempts", render: (r) => `${r.attempts}/${r.maxAttempts}` },
    { key: "lastError", header: "Last error", render: (r) => r.lastError ?? "—" },
    { key: "createdAt", header: "Created", render: (r) => <Timestamp date={r.createdAt} /> },
  ];
  return (
    <DataTable
      columns={columns}
      data={data?.data}
      isLoading={isLoading}
      error={error}
      onRetry={() => mutate()}
      emptyTitle="No jobs for this connector"
      emptyHint="Trigger an action above to see jobs appear here."
    />
  );
}

function ConnectorEventsTable({ connectorKey }: { connectorKey: string }) {
  const { data, error, isLoading, mutate } = usePolling<{ data: EventRow[] }>(
    `/api/v1/events?connectorKey=${connectorKey}&limit=20`,
  );
  const columns: Column<EventRow>[] = [
    { key: "eventType", header: "Type", render: (r) => r.eventType },
    { key: "direction", header: "Direction", render: (r) => r.direction },
    { key: "status", header: "Status", render: (r) => <EventStatusBadge status={r.status} /> },
    { key: "receivedAt", header: "Received", render: (r) => <Timestamp date={r.receivedAt} /> },
  ];
  return (
    <DataTable
      columns={columns}
      data={data?.data}
      isLoading={isLoading}
      error={error}
      onRetry={() => mutate()}
      emptyTitle="No events for this connector"
    />
  );
}

function ConnectorLogsTable({ connectorKey }: { connectorKey: string }) {
  const { data, error, isLoading, mutate } = usePolling<{ data: LogRow[] }>(
    `/api/v1/logs?connectorKey=${connectorKey}&limit=20`,
  );
  const columns: Column<LogRow>[] = [
    { key: "level", header: "Level", render: (r) => <StatusBadge status={r.level} /> },
    { key: "message", header: "Message", render: (r) => r.message },
    { key: "createdAt", header: "Time", render: (r) => <Timestamp date={r.createdAt} /> },
  ];
  return (
    <DataTable
      columns={columns}
      data={data?.data}
      isLoading={isLoading}
      error={error}
      onRetry={() => mutate()}
      emptyTitle="No logs for this connector"
    />
  );
}

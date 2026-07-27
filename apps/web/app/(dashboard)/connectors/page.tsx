"use client";

import { useRouter } from "next/navigation";
import { usePolling } from "@/lib/hooks";
import type { ConnectorRow } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Sparkline } from "@/components/sparkline";

export default function ConnectorsPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = usePolling<{ data: ConnectorRow[] }>("/api/v1/connectors");

  const columns: Column<ConnectorRow>[] = [
    { key: "displayName", header: "Connector", render: (r) => <span className="font-medium">{r.displayName}</span> },
    { key: "kind", header: "Kind", render: (r) => <span className="text-muted-foreground">{r.kind}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.paused ? "PAUSED" : r.status} /> },
    { key: "chaos", header: "Chaos mode", render: (r) => <span>{r.chaosMode}</span> },
    { key: "sparkline", header: "Error rate (24h)", render: (r) => <Sparkline data={r.sparkline} /> },
  ];

  return (
    <div>
      <PageHeader title="Connectors" description="Every third-party integration Lakeview Health Partners depends on." />
      <DataTable
        columns={columns}
        data={data?.data}
        isLoading={isLoading}
        error={error}
        onRetry={() => mutate()}
        emptyTitle="No connectors configured"
        onRowClick={(row) => router.push(`/connectors/${row.key}`)}
      />
    </div>
  );
}

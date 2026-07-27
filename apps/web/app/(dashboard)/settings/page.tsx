"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Timestamp } from "@/components/timestamp";
import { JsonViewer } from "@/components/json-viewer";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { usePolling } from "@/lib/hooks";
import { usePaginatedList } from "@/lib/use-paginated";
import type { UserRow, AuditRow } from "@/lib/types";

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-800 border-purple-200",
  OPS: "bg-blue-100 text-blue-800 border-blue-200",
  VIEWER: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Team access and the audit trail. Admin only." />
      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="audit" className="mt-4">
          <AuditLogTable />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UsersTable() {
  const { data, error, isLoading, mutate } = usePolling<{ data: UserRow[] }>("/api/v1/users");

  const columns: Column<UserRow>[] = [
    { key: "name", header: "Name", render: (r) => r.name ?? "—" },
    { key: "email", header: "Email", render: (r) => <span className="font-mono text-xs">{r.email}</span> },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <Badge variant="outline" className={ROLE_STYLES[r.role] ?? ""}>
          {r.role}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Added", render: (r) => <Timestamp date={r.createdAt} /> },
  ];

  return (
    <>
      <p className="text-muted-foreground mb-3 text-sm">
        Roles are seeded for the demo and read-only here. VIEWER reads; OPS retries jobs and works
        incidents; ADMIN also changes connector config and chaos modes.
      </p>
      <DataTable
        columns={columns}
        data={data?.data}
        isLoading={isLoading}
        error={error}
        onRetry={() => mutate()}
        emptyTitle="No users"
        emptyHint="Run pnpm db:seed to create the demo team."
        nextCursor={null}
      />
    </>
  );
}

function AuditLogTable() {
  const [action, setAction] = useState("ALL");
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const params = new URLSearchParams({ limit: "25" });
  if (action !== "ALL") params.set("action", action);

  const { items, error, isLoading, mutate, nextCursor, loadMore, loadingMore } = usePaginatedList<AuditRow>(
    `/api/v1/audit?${params.toString()}`,
  );
  // The action list comes from the same endpoint; read it off an unfiltered request so the
  // dropdown does not shrink to one option as soon as you pick a filter.
  const { data: unfiltered } = usePolling<{ actions: string[] }>("/api/v1/audit?limit=1");

  const columns: Column<AuditRow>[] = [
    { key: "createdAt", header: "Time", render: (r) => <Timestamp date={r.createdAt} /> },
    { key: "user", header: "Actor", render: (r) => r.user?.name ?? r.user?.email ?? "system" },
    { key: "action", header: "Action", render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: "target", header: "Target", render: (r) => `${r.targetType} · ${r.targetId.slice(0, 12)}` },
    {
      key: "metadata",
      header: "Details",
      render: (r) => {
        const keys = Object.keys((r.metadata ?? {}) as Record<string, unknown>);
        return keys.length === 0 ? "—" : <span className="text-muted-foreground text-xs">{keys.join(", ")}</span>;
      },
    },
  ];

  return (
    <>
      <div className="mb-4">
        <Select value={action} onValueChange={(v) => setAction(v ?? "ALL")}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actions</SelectItem>
            {(unfiltered?.actions ?? []).map((a) => (
              <SelectItem key={a} value={a}>
                {a}
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
        emptyTitle="No audit entries"
        emptyHint="Every mutation writes one — retry a job or change a chaos mode."
        nextCursor={nextCursor}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-sm">{selected.action}</SheetTitle>
                <SheetDescription>
                  {selected.user?.name ?? "system"} · {selected.targetType} · <Timestamp date={selected.createdAt} />
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Target id</p>
                  <p className="font-mono text-xs break-all">{selected.targetId}</p>
                </div>
                <JsonViewer data={selected.metadata} label="Metadata" />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

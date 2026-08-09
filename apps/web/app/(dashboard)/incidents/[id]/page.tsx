"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SeverityBadge } from "@/components/severity-badge";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { StatusBadge } from "@/components/status-badge";
import { Timestamp } from "@/components/timestamp";
import { RoleGate } from "@/components/role-gate";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { usePolling } from "@/lib/hooks";
import { apiPost } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import type { IncidentDetailResponse } from "@/lib/types";
import { AiSummaryCard } from "./ai-summary-card";
import { CopilotPanel } from "./copilot-panel";
import { toast } from "sonner";

const TIMELINE_ICONS: Record<string, string> = {
  opened: "●",
  status_change: "→",
  health_transition: "◆",
  note: "✎",
  ai_summary: "✨",
  retry_burst: "↻",
};

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = usePolling<IncidentDetailResponse>(
    `/api/v1/incidents/${id}`,
  );
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  async function act(path: string, successMessage: string) {
    try {
      await apiPost(`/api/v1/incidents/${id}/${path}`);
      toast.success(successMessage);
      void mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      await apiPost(`/api/v1/incidents/${id}/notes`, { message: note.trim() });
      setNote("");
      toast.success("Note added");
      void mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setSavingNote(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm">Could not load this incident.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void mutate()}>
          Try again
        </Button>
      </div>
    );
  }

  const { incident, context } = data;
  const isResolved = incident.status === "RESOLVED";
  const endedAt = incident.resolvedAt ? new Date(incident.resolvedAt) : new Date();

  return (
    <div>
      <PageHeader
        title={incident.title}
        description={`Detected by ${incident.detectionSource} · open for ${formatDuration(new Date(incident.openedAt), endedAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            <RoleGate minRole="OPS">
              {incident.status === "OPEN" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void act("acknowledge", "Incident acknowledged")}
                >
                  Acknowledge
                </Button>
              )}
              {!isResolved && (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      Resolve
                    </Button>
                  }
                  title="Resolve this incident?"
                  description="Marks the incident RESOLVED now instead of waiting for the health engine's stability window. Writes a timeline entry and an audit record."
                  confirmLabel="Resolve"
                  onConfirm={() => act("resolve", "Incident resolved")}
                />
              )}
            </RoleGate>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <AiSummaryCard
            incidentId={id}
            status={incident.aiSummaryStatus}
            summary={incident.aiSummary}
            onChanged={() => void mutate()}
          />

          <CopilotPanel incidentId={id} />

          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
            <ol className="space-y-3 border-l pl-4">
              {incident.timeline.map((entry) => (
                <li key={entry.id} className="relative text-sm">
                  <span className="text-muted-foreground absolute top-0.5 -left-[1.4rem] text-xs">
                    {TIMELINE_ICONS[entry.kind] ?? "•"}
                  </span>
                  <p>{entry.message}</p>
                  <p className="text-muted-foreground text-xs">
                    {entry.actor === "system" ? "system" : "user"} ·{" "}
                    <Timestamp date={entry.createdAt} />
                  </p>
                </li>
              ))}
            </ol>

            <RoleGate minRole="OPS">
              <div className="mt-4 border-t pt-4">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note for the next responder..."
                  rows={2}
                />
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={!note.trim() || savingNote}
                  onClick={() => void addNote()}
                >
                  {savingNote ? "Adding..." : "Add note"}
                </Button>
              </div>
            </RoleGate>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Context</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Connector</dt>
                <dd>
                  <Link href={`/connectors/${incident.connector.key}`} className="hover:underline">
                    {incident.connector.displayName}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Status now</dt>
                <dd>
                  <StatusBadge status={incident.connector.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Chaos mode</dt>
                <dd>{incident.connector.chaosMode}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Opened</dt>
                <dd>
                  <Timestamp date={incident.openedAt} />
                </dd>
              </div>
              {incident.acknowledgedAt && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Acknowledged</dt>
                  <dd>
                    <Timestamp date={incident.acknowledgedAt} />
                  </dd>
                </div>
              )}
              {incident.resolvedAt && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Resolved</dt>
                  <dd>
                    <Timestamp date={incident.resolvedAt} />
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">During this incident</h2>
            <div className="space-y-2 text-sm">
              <Link
                href={`/jobs?connectorKey=${incident.connector.key}&status=DEAD`}
                className="flex items-center justify-between hover:underline"
              >
                <span className="text-muted-foreground">Failed jobs</span>
                <span className="font-medium">{context.failedJobs} →</span>
              </Link>
              <Link
                href={`/logs?connectorKey=${incident.connector.key}&level=ERROR`}
                className="flex items-center justify-between hover:underline"
              >
                <span className="text-muted-foreground">Error logs</span>
                <span className="font-medium">{context.errorLogs} →</span>
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

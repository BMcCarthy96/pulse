"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/timestamp";
import { RoleGate } from "@/components/role-gate";
import { apiPatch, apiPost } from "@/lib/api-client";
import type { AiSummary } from "@/lib/types";
import { toast } from "sonner";

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

/** doc 05 states: none / queued / generating / failed / ready / edited. */
export function AiSummaryCard({
  incidentId,
  status,
  summary,
  onChanged,
}: {
  incidentId: string;
  status: string;
  summary: AiSummary | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<AiSummary | null>(null);

  const hasContent = (status === "ready" || status === "edited") && summary;
  const inFlight = status === "queued" || status === "generating";

  async function regenerate() {
    setBusy(true);
    try {
      await apiPost(`/api/v1/incidents/${incidentId}/summary/regenerate`);
      toast.success("Summary re-queued");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate");
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    if (!summary) return;
    setDraft({
      summary: summary.summary,
      probableCause: summary.probableCause,
      impact: summary.impact,
      suggestedSteps: [...(summary.suggestedSteps ?? [])],
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!draft) return;
    setBusy(true);
    try {
      await apiPatch(`/api/v1/incidents/${incidentId}/summary`, {
        summary: draft.summary,
        probableCause: draft.probableCause,
        impact: draft.impact,
        suggestedSteps: draft.suggestedSteps.filter((s) => s.trim().length > 0),
      });
      toast.success("Summary updated");
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">AI incident summary</h2>
          {status === "edited" && (
            <Badge variant="outline" className="bg-slate-100 text-slate-700">
              edited
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {summary?.confidence && !editing && (
            <Badge variant="outline" className={CONFIDENCE_STYLES[summary.confidence] ?? ""}>
              {summary.confidence} confidence
            </Badge>
          )}
          <RoleGate minRole="OPS">
            {!editing && (
              <>
                {hasContent && (
                  <Button size="sm" variant="ghost" onClick={startEditing} disabled={busy}>
                    Edit
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void regenerate()}
                  disabled={busy || inFlight}
                >
                  {status === "failed" ? "Retry" : "Regenerate"}
                </Button>
              </>
            )}
          </RoleGate>
        </div>
      </div>

      {status === "none" && (
        <p className="text-muted-foreground text-sm">
          No summary yet. One is drafted automatically when the health engine opens an incident.
        </p>
      )}

      {status === "queued" && (
        <p className="text-muted-foreground text-sm">Queued — waiting for a summarizer worker.</p>
      )}

      {status === "generating" && (
        <div className="space-y-2" aria-busy="true">
          <p className="text-muted-foreground mb-2 text-sm">
            Drafting from the redacted incident context…
          </p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {status === "failed" && (
        <div className="text-sm">
          <p className="text-red-600">
            Summary unavailable{summary?.error ? ` — ${summary.error}` : ""}.
          </p>
          {summary?.error === "AI not configured" && (
            <p className="text-muted-foreground mt-1 text-xs">
              Set <code>ANTHROPIC_API_KEY</code> in the worker environment. Everything else in Pulse
              works without it.
            </p>
          )}
        </div>
      )}

      {hasContent && !editing && (
        <div className="space-y-3 text-sm">
          <p>{summary.summary}</p>
          <Field label="Probable cause">{summary.probableCause}</Field>
          <Field label="Impact">{summary.impact}</Field>
          {summary.suggestedSteps?.length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs font-medium uppercase">Suggested steps</p>
              <ul className="mt-1 space-y-1">
                {summary.suggestedSteps.map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground border-t pt-2 text-xs">
            Generated by {summary.model ?? "unknown model"} · prompt{" "}
            {summary.promptVersion ?? "n/a"}
            {summary.generatedAt && (
              <>
                {" · "}
                <Timestamp date={summary.generatedAt} />
              </>
            )}
            {status === "edited" && summary.editedBy && <> · edited by {summary.editedBy}</>}
          </p>
          {(summary.inputTokens !== undefined || summary.costUsd !== undefined) && (
            <p className="text-muted-foreground text-xs">
              {summary.inputTokens ?? 0} input · {summary.outputTokens ?? 0} output tokens
              {summary.costUsd !== undefined && ` · $${summary.costUsd.toFixed(6)}`}
              {summary.latencyMs !== undefined && ` · ${summary.latencyMs} ms`}
            </p>
          )}
        </div>
      )}

      {editing && draft && (
        <div className="space-y-3 text-sm">
          <EditField label="Summary">
            <Textarea
              rows={3}
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </EditField>
          <EditField label="Probable cause">
            <Textarea
              rows={2}
              value={draft.probableCause}
              onChange={(e) => setDraft({ ...draft, probableCause: e.target.value })}
            />
          </EditField>
          <EditField label="Impact">
            <Textarea
              rows={2}
              value={draft.impact}
              onChange={(e) => setDraft({ ...draft, impact: e.target.value })}
            />
          </EditField>
          <EditField label="Suggested steps">
            <div className="space-y-2">
              {draft.suggestedSteps.map((step, i) => (
                <Input
                  key={i}
                  value={step}
                  onChange={(e) => {
                    const next = [...draft.suggestedSteps];
                    next[i] = e.target.value;
                    setDraft({ ...draft, suggestedSteps: next });
                  }}
                />
              ))}
            </div>
          </EditField>
          <div className="flex gap-2 border-t pt-3">
            <Button size="sm" onClick={() => void saveEdit()} disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <p className="text-muted-foreground self-center text-xs">
              The generated version is kept alongside your edit.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium uppercase">{label}</p>
      <p>{children}</p>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{label}</p>
      {children}
    </div>
  );
}

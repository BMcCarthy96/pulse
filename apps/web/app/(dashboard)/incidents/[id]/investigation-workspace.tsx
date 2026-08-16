"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Timestamp } from "@/components/timestamp";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGuidedWalkthrough } from "@/components/guided-walkthrough";
import { apiFetch, apiPost } from "@/lib/api-client";
import { GUIDED_INVESTIGATION_QUESTIONS, type InvestigationActionType } from "@pulse/shared";
import { toast } from "sonner";

type Evidence = {
  id: string;
  kind: string;
  label: string;
  excerpt: string;
  href: string | null;
  observedAt: string | null;
};
type Action = {
  id: string;
  type: InvestigationActionType;
  targetId: string;
  rationale: string;
  evidenceIds: unknown;
  status: string;
  approvedAt?: string | null;
  executedAt?: string | null;
  errorMessage?: string | null;
};
type Report = {
  summary: string;
  hypotheses: { statement: string; confidence: string; evidenceIds: string[] }[];
  uncertainty: string;
};
type Activity = { id: number; label: string };
type Workspace = {
  id: string;
  status: string;
  report: Report | null;
  evidence: Evidence[];
  actions: Action[];
  aiRuns: {
    mode: string;
    model: string;
    promptVersion: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: string | null;
    latencyMs: number | null;
    traceId: string | null;
    createdAt: string;
    calls: {
      sequence: number;
      providerRequestId: string | null;
      status: string;
      latencyMs: number;
      costUsd: string | null;
    }[];
  }[];
  audit: {
    id: string;
    action: string;
    targetId: string;
    createdAt: string;
    user: { name: string } | null;
  }[];
};

function formatCost(value: string | null | undefined) {
  if (value == null) return "$0.00";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0.00";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount > 0 && amount < 0.01 ? 6 : 2,
    maximumFractionDigits: 6,
  });
}

function parseFrame(raw: string) {
  const event = raw
    .split("\n")
    .find((line) => line.startsWith("event: "))
    ?.slice(7);
  const data = raw
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return null;
  }
}

function activityLabel(event: string, data: Record<string, unknown>) {
  if (event === "run.started")
    return (
      "Started " +
      (data.mode === "LIVE" ? "live investigation" : "deterministic demo investigation")
    );
  if (event === "evidence.added") return "Added evidence · " + String(data.label ?? data.kind);
  if (event === "tool.started")
    return "Server retrieval started · " + String(data.name ?? "evidence query");
  if (event === "tool.completed")
    return "Server retrieval completed · " + String(data.summary ?? data.name);
  if (event === "hypothesis.updated") return "Updated a cited hypothesis";
  if (event === "action.proposed")
    return "Proposed action · " + String(data.type ?? "operator approval");
  if (event === "report.completed") return "Validated evidence-bounded report";
  if (event === "run.completed") return "Investigation complete";
  if (event === "run.error") return "Investigation error · " + String(data.message ?? "unknown");
  return event.replaceAll(".", " ");
}

const ACTION_PRESENTATION: Record<
  InvestigationActionType,
  { label: string; targetLabel: string; expectedEffect: string; execution: string }
> = {
  RETRY_JOB: {
    label: "Retry job",
    targetLabel: "Job",
    expectedEffect: "Queue one guarded retry if the job is still failed and retryable.",
    execution:
      "The worker receives the queued retry; audit records the operator and queue handoff.",
  },
  ACKNOWLEDGE_INCIDENT: {
    label: "Acknowledge incident",
    targetLabel: "Incident",
    expectedEffect: "Mark the incident acknowledged and add a timeline entry if it is still open.",
    execution: "The server applies the eligible state change and records the operator in audit.",
  },
  RESOLVE_INCIDENT: {
    label: "Resolve incident",
    targetLabel: "Incident",
    expectedEffect:
      "Resolve only after the incident is monitoring, the connector is healthy, and the stability window has passed.",
    execution: "The server applies the eligible state change and records the operator in audit.",
  },
  REGENERATE_SUMMARY: {
    label: "Regenerate incident summary",
    targetLabel: "Incident",
    expectedEffect: "Queue a fresh summary if another summary run is not already active.",
    execution: "The worker receives the summary job; audit records the operator and queue handoff.",
  },
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "job.retry": "Job retry executed",
  "incident.acknowledge": "Incident acknowledged",
  "incident.resolve": "Incident resolved",
  "incident.summary_regenerate": "Incident summary regeneration queued",
  "investigation.action_approved": "Investigation action approved",
  "investigation.action_dismissed": "Investigation action dismissed",
};

function auditActionLabel(action: string) {
  const knownLabel = AUDIT_ACTION_LABELS[action];
  if (knownLabel) return knownLabel;
  const words = action.replaceAll(".", " ").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function InvestigationWorkspace({ incidentId }: { incidentId: string }) {
  const { completeStep } = useGuidedWalkthrough();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [evidenceAnnouncement, setEvidenceAnnouncement] = useState("");
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const askInFlightRef = useRef(false);
  const lastAskRef = useRef<{ question: string; startedAt: number } | null>(null);
  const actionInFlightRef = useRef(false);
  const activitySeqRef = useRef(0);

  const ensureWorkspace = useCallback(async () => {
    const response = await apiPost<{ investigation: Workspace }>(
      `/api/v1/incidents/${incidentId}/investigations`,
    );
    setWorkspace(response.investigation);
    return response.investigation;
  }, [incidentId]);

  useEffect(() => {
    void ensureWorkspace().finally(() => setLoading(false));
    return () => abortRef.current?.abort();
  }, [ensureWorkspace]);

  async function refresh(id = workspace?.id) {
    if (!id) return;
    const response = await apiFetch<{ investigation: Workspace }>(`/api/v1/investigations/${id}`);
    setWorkspace(response.investigation);
    return response.investigation;
  }

  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    const now = Date.now();
    const lastAsk = lastAskRef.current;
    // State updates are intentionally not the lock here: two pointer/keyboard events can land
    // before React commits `busy`, creating duplicate runs and replacing the action DOM mid-click.
    if (
      !trimmed ||
      askInFlightRef.current ||
      (lastAsk?.question === trimmed && now - lastAsk.startedAt < 1_000)
    )
      return;
    lastAskRef.current = { question: trimmed, startedAt: now };
    askInFlightRef.current = true;
    setBusy(true);
    setAnswer("");
    setActivity([]);
    activitySeqRef.current = 0;
    const current = workspace ?? (await ensureWorkspace());
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/v1/investigations/${current.id}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? response.statusText);
      }
      if (!response.body) throw new Error("Investigation returned no stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const raw of frames) {
          const parsed = parseFrame(raw);
          if (!parsed) continue;
          setActivity((previous) =>
            [
              ...previous,
              { id: activitySeqRef.current++, label: activityLabel(parsed.event, parsed.data) },
            ].slice(-20),
          );
          if (parsed.event === "report.completed" && typeof parsed.data.summary === "string") {
            setAnswer(parsed.data.summary);
          }
          if (parsed.event === "run.error") {
            toast.error(
              typeof parsed.data.message === "string"
                ? parsed.data.message
                : "Investigation failed",
            );
          }
          if (parsed.event === "run.completed") {
            await refresh(current.id);
            completeStep("run-investigation");
          }
        }
      }
      setQuestion("");
      await refresh(current.id);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(error instanceof Error ? error.message : "Investigation failed");
    } finally {
      abortRef.current = null;
      askInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function action(path: string, walkthroughApproval = false) {
    if (!workspace?.id || actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    setActionBusy(true);
    try {
      await apiPost(`/api/v1/investigations/${workspace.id}/actions/${path}`);
      await refresh();
      if (walkthroughApproval && path.endsWith("approve")) {
        window.setTimeout(() => completeStep("confirm-approval"), 0);
      }
      toast.success(
        path.endsWith("approve") ? "Action approved; audit record written" : "Action dismissed",
      );
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
      await refresh();
      return false;
    } finally {
      actionInFlightRef.current = false;
      setActionBusy(false);
    }
  }

  if (loading)
    return (
      <section className="rounded-lg border p-4 text-sm">
        Preparing investigation workspace…
      </section>
    );
  if (!workspace) return null;
  const proposed = workspace.actions.filter((item) => item.status === "PROPOSED");
  const history = workspace.actions.filter((item) => item.status !== "PROPOSED");
  const latestRun = workspace.aiRuns[0];
  const evidenceById = new Map(workspace.evidence.map((item) => [item.id, item]));
  function focusEvidence(id: string) {
    if (!workspace) return;
    const target = document.getElementById(`evidence-${id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    const index = workspace.evidence.findIndex((entry) => entry.id === id);
    const label = evidenceById.get(id)?.label ?? "Evidence";
    setEvidenceAnnouncement(`Focused evidence E${index + 1}: ${label}`);
  }

  return (
    <section className="rounded-lg border p-4" aria-labelledby="investigation-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="investigation-heading" className="text-sm font-semibold">
            Investigation workspace
          </h2>
          <p className="text-muted-foreground mt-1 max-w-xl text-xs">
            A durable evidence board for one incident. Pulse proposes; an OPS operator approves.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="bg-muted rounded-full px-2 py-1 text-xs">
            {!latestRun
              ? "Ready to investigate"
              : latestRun.mode === "LIVE"
                ? "Live provider"
                : "Deterministic demo synthesis"}
          </span>
          {latestRun && (
            <div
              className="text-muted-foreground max-w-sm text-right text-[11px]"
              data-testid="investigation-telemetry"
            >
              {latestRun.model} · {latestRun.promptVersion} ·{" "}
              {latestRun.latencyMs == null ? "latency n/a" : latestRun.latencyMs + "ms"} ·{" "}
              {latestRun.totalInputTokens + latestRun.totalOutputTokens} tokens
              {latestRun.traceId && (
                <span className="block truncate" title={latestRun.traceId}>
                  trace {latestRun.traceId.slice(0, 16)}…
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2 border-y py-3" aria-label="Investigation sections">
        {[
          ["investigate", "Investigate"],
          ...(workspace.report
            ? [
                ["findings", "Findings"],
                ["actions", "Actions"],
              ]
            : []),
          ["evidence", "Evidence"],
          ["run-details", "Run details"],
        ].map(([anchor, label]) => (
          <a
            key={anchor}
            href={`#${anchor}`}
            data-walkthrough={anchor === "actions" ? "open-actions" : undefined}
            onClick={() => {
              if (anchor === "actions") completeStep("open-actions");
            }}
            className="bg-muted text-foreground/80 hover:text-foreground rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
          >
            {label}
          </a>
        ))}
      </nav>

      <div
        id="investigate"
        tabIndex={-1}
        className="scroll-mt-6 rounded-md focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <p className="text-muted-foreground mb-2 text-xs">
          Start with a guided question to keep the demo deterministic, or ask your own question when
          live provider mode is enabled.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {GUIDED_INVESTIGATION_QUESTIONS.map((item) => (
            <Button
              key={item.id}
              data-testid={`guided-question-${item.id}`}
              data-walkthrough={item.id === "first-signal" ? "run-first-signal" : undefined}
              variant="outline"
              type="button"
              className="h-auto justify-start p-3 text-left text-xs whitespace-normal"
              disabled={busy}
              onClick={() => void ask(item.question)}
            >
              <span>
                <span className="font-medium">{item.label}</span>
                <br />
                <span className="text-muted-foreground group-hover/button:text-foreground">
                  {item.question}
                </span>
              </span>
            </Button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2_000}
            rows={2}
            disabled={busy}
            placeholder="Choose a guided question, or ask a live investigation question when AI is enabled…"
          />
          <Button
            type="button"
            className="self-end"
            disabled={busy || !question.trim()}
            onClick={() => void ask()}
          >
            {busy ? "Investigating…" : "Ask"}
          </Button>
        </div>

        {answer && (
          <p className="bg-muted/40 mt-4 rounded-md p-3 text-sm whitespace-pre-wrap">{answer}</p>
        )}

        {activity.length > 0 && (
          <div className="bg-muted/20 mt-4 rounded-md border p-3" aria-live="polite">
            <h3 className="text-xs font-semibold tracking-wide uppercase">
              Investigation activity
            </h3>
            <ol className="text-muted-foreground mt-2 space-y-1 text-xs">
              {activity.slice(-8).map((item) => (
                <li key={item.id} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {workspace.report && (
        <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
          <div
            id="findings"
            tabIndex={-1}
            className="scroll-mt-6 rounded-md focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <h3 className="text-xs font-semibold tracking-wide uppercase">Hypotheses</h3>
            <div className="mt-2 space-y-2">
              {workspace.report.hypotheses.map((item, index) => (
                <div key={`${item.statement}-${index}`} className="rounded-md border p-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{item.statement}</span>
                    <span className="text-muted-foreground text-xs">{item.confidence}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Evidence</span>
                    {item.evidenceIds.map((id, citationIndex) => (
                      <button
                        key={id}
                        type="button"
                        data-walkthrough={
                          index === 0 && citationIndex === 0 ? "open-first-citation" : undefined
                        }
                        className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100"
                        onClick={() => {
                          if (index === 0 && citationIndex === 0) completeStep("open-citation");
                          focusEvidence(id);
                        }}
                        aria-label={`View evidence E${workspace.evidence.findIndex((entry) => entry.id === id) + 1}: ${evidenceById.get(id)?.label ?? "Evidence"}`}
                        title={evidenceById.get(id)?.label ?? "Evidence"}
                      >
                        E{workspace.evidence.findIndex((entry) => entry.id === id) + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              <span className="font-medium">Uncertainty:</span> {workspace.report.uncertainty}
            </p>
          </div>
          <div
            id="actions"
            tabIndex={-1}
            className="scroll-mt-6 rounded-md focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <h3 className="text-xs font-semibold tracking-wide uppercase">Proposed actions</h3>
            {proposed.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">No pending actions.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {proposed.map((item) => (
                  <div key={item.id} className="rounded-md border p-2">
                    <p className="text-sm font-medium">{ACTION_PRESENTATION[item.type].label}</p>
                    <p className="text-muted-foreground mt-1 text-xs">{item.rationale}</p>
                    <div className="mt-2 flex gap-2">
                      <ConfirmDialog
                        trigger={
                          <Button
                            data-testid="approve-action"
                            data-walkthrough={
                              item.type === "RETRY_JOB" ? "open-retry-approval" : undefined
                            }
                            type="button"
                            size="sm"
                            disabled={actionBusy}
                          >
                            {actionBusy ? "Working…" : "Approve"}
                          </Button>
                        }
                        title="Approve this recovery action?"
                        description={
                          <div className="space-y-3 text-left">
                            <div className="bg-muted/40 rounded-lg border p-3">
                              <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                                AI proposal · no operation has run
                              </p>
                              <p className="text-foreground mt-1 font-medium">
                                {ACTION_PRESENTATION[item.type].label}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed">{item.rationale}</p>
                            </div>

                            <dl className="grid gap-2 text-xs sm:grid-cols-2">
                              <div className="rounded-md border p-2.5">
                                <dt className="text-foreground font-medium">Target</dt>
                                <dd className="mt-1">
                                  <span>{ACTION_PRESENTATION[item.type].targetLabel} </span>
                                  <code className="text-foreground break-all" title={item.targetId}>
                                    {item.targetId}
                                  </code>
                                </dd>
                              </div>
                              <div className="rounded-md border p-2.5">
                                <dt className="text-foreground font-medium">
                                  Current target state
                                </dt>
                                <dd className="mt-1">
                                  Not assumed in the browser; the server checks it on approval.
                                </dd>
                              </div>
                              <div className="rounded-md border p-2.5 sm:col-span-2">
                                <dt className="text-foreground font-medium">Expected effect</dt>
                                <dd className="mt-1">
                                  {ACTION_PRESENTATION[item.type].expectedEffect}
                                </dd>
                              </div>
                            </dl>

                            <div>
                              <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                                Human approval boundary
                              </p>
                              <ol
                                className="mt-2 grid gap-2 text-xs sm:grid-cols-2"
                                aria-label="Approval and execution sequence"
                              >
                                <li className="flex gap-2 rounded-md border p-2.5">
                                  <span
                                    aria-hidden="true"
                                    className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full font-semibold"
                                  >
                                    1
                                  </span>
                                  <span>
                                    <strong className="text-foreground block">AI proposes</strong>
                                    Recommendation only; it cannot approve itself.
                                  </span>
                                </li>
                                <li className="flex gap-2 rounded-md border p-2.5">
                                  <span
                                    aria-hidden="true"
                                    className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full font-semibold"
                                  >
                                    2
                                  </span>
                                  <span>
                                    <strong className="text-foreground block">OPS approves</strong>
                                    Your signed-in operator owns this decision.
                                  </span>
                                </li>
                                <li className="flex gap-2 rounded-md border p-2.5">
                                  <span
                                    aria-hidden="true"
                                    className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full font-semibold"
                                  >
                                    3
                                  </span>
                                  <span>
                                    <strong className="text-foreground block">
                                      Server revalidates
                                    </strong>
                                    It checks tenant scope, eligibility, and single execution.
                                  </span>
                                </li>
                                <li className="flex gap-2 rounded-md border p-2.5">
                                  <span
                                    aria-hidden="true"
                                    className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full font-semibold"
                                  >
                                    4
                                  </span>
                                  <span>
                                    <strong className="text-foreground block">
                                      Execute and record
                                    </strong>
                                    {ACTION_PRESENTATION[item.type].execution}
                                  </span>
                                </li>
                              </ol>
                            </div>
                          </div>
                        }
                        confirmLabel="Revalidate and approve"
                        contentClassName="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
                        confirmButtonProps={
                          item.type === "RETRY_JOB"
                            ? { "data-walkthrough": "confirm-retry-approval" }
                            : undefined
                        }
                        onOpenChange={(open) => {
                          if (open && item.type === "RETRY_JOB") completeStep("open-approval");
                        }}
                        onConfirm={() => action(`${item.id}/approve`, item.type === "RETRY_JOB")}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={actionBusy}
                        onClick={() => void action(`${item.id}/dismiss`)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {history.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Action history
                </h4>
                <div className="mt-2 space-y-1 text-xs">
                  {history.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2">
                      <span>{item.type.replaceAll("_", " ")}</span>
                      <span className="font-medium">{item.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {workspace.audit.length > 0 && (
              <div
                id="audit-trail"
                tabIndex={-1}
                data-walkthrough="review-audit"
                className="mt-3 scroll-mt-6 rounded-md border-t pt-3 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Audit trail
                </h4>
                <div className="mt-2 space-y-1 text-xs">
                  {workspace.audit.map((entry) => (
                    <div key={entry.id} className="flex items-start justify-between gap-3">
                      <span>
                        <span title={entry.action}>{auditActionLabel(entry.action)}</span>
                        <span className="text-muted-foreground block" title={entry.targetId}>
                          target {entry.targetId.slice(0, 12)}…
                        </span>
                      </span>
                      <span className="text-right">
                        {entry.user?.name ?? "system"}
                        <span className="text-muted-foreground block">
                          <Timestamp date={entry.createdAt} />
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div id="evidence" className="mt-4 scroll-mt-6 border-t pt-4">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          Evidence board ({workspace.evidence.length})
        </h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {workspace.evidence.map((item, index) => {
            const content = (
              <>
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    <span className="text-muted-foreground mr-1">E{index + 1}</span>
                    {item.label}
                  </span>
                  {item.observedAt && <Timestamp date={item.observedAt} />}
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2">{item.excerpt}</p>
              </>
            );
            const className =
              "hover:bg-muted/40 rounded-md border p-2 text-xs transition-shadow focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:outline-none";
            return item.href ? (
              <a
                key={item.id}
                id={`evidence-${item.id}`}
                href={item.href}
                aria-label={`Evidence E${index + 1}: ${item.label}`}
                className={className}
              >
                {content}
              </a>
            ) : (
              <div
                key={item.id}
                id={`evidence-${item.id}`}
                tabIndex={-1}
                role="group"
                aria-label={`Evidence E${index + 1}: ${item.label}`}
                className={className}
              >
                {content}
              </div>
            );
          })}
        </div>
        <p className="sr-only" aria-live="polite">
          {evidenceAnnouncement}
        </p>
      </div>

      <div id="run-details" className="mt-4 scroll-mt-6 border-t pt-4">
        <h3 className="text-xs font-semibold tracking-wide uppercase">Run details</h3>
        {latestRun ? (
          <dl className="text-muted-foreground mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-foreground font-medium">Source</dt>
              <dd>
                {latestRun.mode === "LIVE"
                  ? "Credentialed live provider"
                  : "Deterministic demo synthesis"}
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Engine</dt>
              <dd>
                {latestRun.mode === "LIVE" ? latestRun.model : `${latestRun.model} · no model call`}
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Prompt version</dt>
              <dd>{latestRun.promptVersion}</dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Usage</dt>
              <dd>
                {latestRun.totalInputTokens + latestRun.totalOutputTokens} tokens ·{" "}
                {formatCost(latestRun.totalCostUsd)}
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Latency</dt>
              <dd>{latestRun.latencyMs == null ? "Not reported" : `${latestRun.latencyMs}ms`}</dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Trace</dt>
              <dd className="truncate" title={latestRun.traceId ?? undefined}>
                {latestRun.traceId ? `${latestRun.traceId.slice(0, 18)}…` : "Not reported"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-foreground font-medium">Provider attempts</dt>
              <dd>
                {latestRun.calls.length === 0
                  ? "No provider call — deterministic demo synthesis"
                  : latestRun.calls
                      .map(
                        (call) =>
                          `#${call.sequence} ${call.status.toLowerCase()} · ${call.latencyMs}ms · ${formatCost(call.costUsd)}${call.providerRequestId ? ` · ${call.providerRequestId.slice(0, 12)}…` : ""}`,
                      )
                      .join(" | ")}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground mt-2 text-xs">
            Run a question to capture model and safety telemetry.
          </p>
        )}
      </div>
    </section>
  );
}

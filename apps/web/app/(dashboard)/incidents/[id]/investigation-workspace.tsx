"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Timestamp } from "@/components/timestamp";
import { announceRecruiterTourStep } from "@/components/recruiter-tour";
import { apiFetch, apiPost } from "@/lib/api-client";
import { GUIDED_INVESTIGATION_QUESTIONS } from "@pulse/shared";
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
  type: string;
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
  }[];
  audit: {
    id: string;
    action: string;
    targetId: string;
    createdAt: string;
    user: { name: string } | null;
  }[];
};

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
    return "Started " + (data.mode === "LIVE" ? "live investigation" : "recorded investigation");
  if (event === "evidence.added") return "Added evidence · " + String(data.label ?? data.kind);
  if (event === "tool.started") return "Tool started · " + String(data.name ?? "evidence query");
  if (event === "tool.completed") return "Tool completed · " + String(data.summary ?? data.name);
  if (event === "hypothesis.updated") return "Updated a cited hypothesis";
  if (event === "action.proposed")
    return "Proposed action · " + String(data.type ?? "operator approval");
  if (event === "answer.delta") return "Drafted evidence-bounded answer";
  if (event === "run.completed") return "Investigation complete";
  if (event === "run.error") return "Investigation error · " + String(data.message ?? "unknown");
  return event.replaceAll(".", " ");
}

export function InvestigationWorkspace({ incidentId }: { incidentId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
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
          if (parsed.event === "answer.delta" && typeof parsed.data.text === "string") {
            setAnswer((previous) => previous + parsed.data.text);
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
            announceRecruiterTourStep("investigate");
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

  async function action(path: string) {
    if (!workspace?.id || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActionBusy(true);
    try {
      await apiPost(`/api/v1/investigations/${workspace.id}/actions/${path}`);
      const refreshed = await refresh();
      if (path.endsWith("approve")) {
        announceRecruiterTourStep("approve");
        if (refreshed?.audit.some((entry) => entry.action === "investigation.action_approved")) {
          announceRecruiterTourStep("audit");
        }
      }
      toast.success(path.endsWith("approve") ? "Action approved and executed" : "Action dismissed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
      await refresh();
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
                ? "Live AI"
                : "Recorded fixture"}
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

      <div className="grid gap-3 md:grid-cols-3">
        {GUIDED_INVESTIGATION_QUESTIONS.map((item) => (
          <Button
            key={item.id}
            data-testid={`guided-question-${item.id}`}
            variant="outline"
            type="button"
            className="h-auto justify-start p-3 text-left text-xs whitespace-normal"
            disabled={busy}
            onClick={() => void ask(item.question)}
          >
            <span>
              <span className="font-medium">{item.label}</span>
              <br />
              <span className="text-muted-foreground">{item.question}</span>
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
          <h3 className="text-xs font-semibold tracking-wide uppercase">Investigation activity</h3>
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

      {workspace.report && (
        <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold tracking-wide uppercase">Hypotheses</h3>
            <div className="mt-2 space-y-2">
              {workspace.report.hypotheses.map((item, index) => (
                <div key={`${item.statement}-${index}`} className="rounded-md border p-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{item.statement}</span>
                    <span className="text-muted-foreground text-xs">{item.confidence}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {item.evidenceIds.length} evidence citations
                  </p>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              <span className="font-medium">Uncertainty:</span> {workspace.report.uncertainty}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold tracking-wide uppercase">Proposed actions</h3>
            {proposed.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">No pending actions.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {proposed.map((item) => (
                  <div key={item.id} className="rounded-md border p-2">
                    <p className="text-sm font-medium">{item.type.replaceAll("_", " ")}</p>
                    <p className="text-muted-foreground mt-1 text-xs">{item.rationale}</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        data-testid="approve-action"
                        type="button"
                        size="sm"
                        disabled={actionBusy}
                        onClick={() => void action(`${item.id}/approve`)}
                      >
                        {actionBusy ? "Working…" : "Approve"}
                      </Button>
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
              <div className="mt-3 border-t pt-3">
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Audit trail
                </h4>
                <div className="mt-2 space-y-1 text-xs">
                  {workspace.audit.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-2">
                      <span>{entry.action.replaceAll(".", " · ")}</span>
                      <span>{entry.user?.name ?? "system"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 border-t pt-4">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          Evidence board ({workspace.evidence.length})
        </h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {workspace.evidence.slice(-10).map((item) => (
            <a
              key={item.id}
              href={item.href ?? "#"}
              className="hover:bg-muted/40 rounded-md border p-2 text-xs"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{item.label}</span>
                {item.observedAt && <Timestamp date={item.observedAt} />}
              </div>
              <p className="text-muted-foreground mt-1 line-clamp-2">{item.excerpt}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

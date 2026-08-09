"use client";

import { useEffect, useRef, useState } from "react";
import { RoleGate } from "@/components/role-gate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Timestamp } from "@/components/timestamp";
import { usePolling } from "@/lib/hooks";
import { toast } from "sonner";

interface ToolEvent {
  name: string;
  turn?: number;
  summary?: string;
  rowCount?: number;
  state?: "started" | "completed";
}

interface HistoryItem {
  id: string;
  status: string;
  question: string | null;
  answer: string | null;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string | null;
  toolEvents: ToolEvent[] | null;
  createdAt: string;
  completedAt: string | null;
}

function parseSseChunk(chunk: string) {
  const lines = chunk.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function CopilotPanel({ incidentId }: { incidentId: string }) {
  return (
    <RoleGate minRole="OPS">
      <CopilotPanelInner incidentId={incidentId} />
    </RoleGate>
  );
}

function CopilotPanelInner({ incidentId }: { incidentId: string }) {
  const { data, mutate } = usePolling<{ data: HistoryItem[] }>(
    `/api/v1/incidents/${incidentId}/copilot?limit=20`,
  );
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setAnswer("");
    setTools([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/v1/incidents/${incidentId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? response.statusText);
      }
      if (!response.body) throw new Error("Copilot returned no stream");
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
          const parsed = parseSseChunk(raw);
          if (!parsed) continue;
          if (parsed.event === "answer.delta" && typeof parsed.data.text === "string") {
            setAnswer((current) => current + parsed.data.text);
          } else if (parsed.event === "tool.started" && typeof parsed.data.name === "string") {
            setTools((current) => [
              ...current,
              {
                name: parsed.data.name as string,
                turn: parsed.data.turn as number,
                state: "started",
              },
            ]);
          } else if (parsed.event === "tool.completed" && typeof parsed.data.name === "string") {
            setTools((current) =>
              current.map((tool, index) =>
                index ===
                current.findLastIndex(
                  (item) => item.name === parsed.data.name && item.state === "started",
                )
                  ? {
                      ...tool,
                      state: "completed",
                      summary: parsed.data.summary as string,
                      rowCount: parsed.data.rowCount as number,
                    }
                  : tool,
              ),
            );
          } else if (parsed.event === "run.error") {
            toast.error(
              typeof parsed.data.message === "string" ? parsed.data.message : "Copilot failed",
            );
          } else if (parsed.event === "run.completed") {
            void mutate();
          }
        }
      }
      setQuestion("");
      void mutate();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error instanceof Error ? error.message : "Copilot failed");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setBusy(false);
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Ask Pulse</h2>
          <p className="text-muted-foreground text-xs">
            Read-only, evidence-bounded answers scoped to this incident and connector.
          </p>
        </div>
        {busy && (
          <Button size="sm" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          value={question}
          maxLength={2_000}
          rows={2}
          disabled={busy}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What changed first, and what should I check next?"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">{question.length}/2000</span>
          <Button size="sm" onClick={() => void ask()} disabled={busy || !question.trim()}>
            {busy ? "Investigating..." : "Ask"}
          </Button>
        </div>
      </div>

      {busy && tools.length > 0 && (
        <div className="bg-muted/40 mt-4 rounded-md p-3 text-xs">
          <p className="mb-2 font-medium">Evidence gathered</p>
          <ul className="space-y-1">
            {tools.map((tool, index) => (
              <li key={`${tool.name}-${index}`} className="text-muted-foreground">
                {tool.state === "completed" ? "✓" : "…"} {tool.summary ?? `Running ${tool.name}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer && <div className="mt-4 text-sm whitespace-pre-wrap">{answer}</div>}

      {(data?.data ?? []).length > 0 && (
        <div className="mt-5 space-y-4 border-t pt-4">
          <h3 className="text-xs font-medium tracking-wide uppercase">Previous questions</h3>
          {data?.data.map((item) => (
            <article key={item.id} className="space-y-2 text-sm">
              <p className="font-medium">{item.question}</p>
              {item.answer && (
                <p className="text-muted-foreground whitespace-pre-wrap">{item.answer}</p>
              )}
              <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                <span>{item.status.toLowerCase()}</span>
                <span>{item.model}</span>
                <span>{item.totalInputTokens + item.totalOutputTokens} tokens</span>
                {item.totalCostUsd && <span>${item.totalCostUsd}</span>}
                <Timestamp date={item.completedAt ?? item.createdAt} />
              </div>
              {item.toolEvents && item.toolEvents.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  {item.toolEvents
                    .map((tool) => tool.summary)
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

import { prisma } from "@pulse/db";
import { withSpan } from "@pulse/shared";
import { redact, redactDeep } from "./redact.js";

/** doc 03 §6.1 caps. Oldest lines are dropped first when the budget is exceeded. */
const MAX_LOGS = 50;
const MAX_FAILED_JOBS = 20;
const MAX_EVENTS = 10;
const MAX_CLAIM_REJECTIONS = 10;
const MAX_CONTEXT_CHARS = 8_000;

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function asJson(value: unknown, knownNames: string[]): string {
  try {
    return truncate(JSON.stringify(redactDeep(value, knownNames)), 300);
  } catch {
    return "(unserialisable)";
  }
}

/**
 * Collapses consecutive identical lines into one with a count.
 *
 * A retry storm writes the same message dozens of times within the same second. Sent verbatim
 * it burns the context budget on repetition and buries the two or three lines that actually
 * distinguish the failure — "×34" carries the same information in one line.
 */
function collapseRepeats(lines: { key: string; text: string }[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let count = 1;
    while (i + count < lines.length && lines[i + count].key === lines[i].key) count++;
    out.push(count === 1 ? lines[i].text : `${lines[i].text} (×${count})`);
    i += count;
  }
  return out;
}

/**
 * Builds the redacted markdown context for one incident.
 *
 * The connector's **chaos mode is deliberately excluded**. It is the ground-truth answer, and
 * feeding it in would let the model restate the fault injection instead of reasoning from
 * symptoms — the summaries would look brilliant and prove nothing.
 */
export async function buildIncidentContext(
  incidentId: string,
): Promise<{ markdown: string; truncated: boolean }> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      connector: {
        select: { id: true, key: true, displayName: true, kind: true, description: true },
      },
      timeline: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!incident) throw new Error(`incident ${incidentId} not found`);

  const users = await prisma.user.findMany({ select: { name: true } });
  const knownNames = users.map((u) => u.name).filter((n): n is string => !!n);

  const windowEnd = incident.resolvedAt ?? new Date();
  const connectorId = incident.connectorId;

  const [logs, failedJobs, events, claimRejections] = await withSpan(
    "db:incident-context",
    { "db.operation": "load_incident_context" },
    () =>
      Promise.all([
        prisma.logEntry.findMany({
          where: {
            connectorId,
            level: { in: ["WARN", "ERROR"] },
            createdAt: { gte: incident.openedAt, lte: windowEnd },
          },
          orderBy: { createdAt: "desc" },
          take: MAX_LOGS,
        }),
        prisma.job.findMany({
          where: {
            connectorId,
            status: { in: ["FAILED", "DEAD"] },
            createdAt: { gte: incident.openedAt, lte: windowEnd },
          },
          orderBy: { createdAt: "desc" },
          take: MAX_FAILED_JOBS,
        }),
        prisma.integrationEvent.findMany({
          where: { connectorId, receivedAt: { gte: incident.openedAt, lte: windowEnd } },
          orderBy: { receivedAt: "desc" },
          take: MAX_EVENTS,
        }),
        // Phase 8 task 7: claim-ack rejections are the most informative signal on this connector,
        // and they are invisible in the job/log tables because a rejection is not a failure.
        incident.connector.key === "claims"
          ? prisma.integrationEvent.findMany({
              where: {
                connectorId,
                eventType: "claim.ack",
                receivedAt: { gte: incident.openedAt, lte: windowEnd },
              },
              orderBy: { receivedAt: "desc" },
              take: MAX_CLAIM_REJECTIONS,
            })
          : Promise.resolve([]),
      ]),
  );

  const sections: string[] = [];

  sections.push(
    [
      `# Incident context`,
      ``,
      `- Connector: ${incident.connector.displayName} (${incident.connector.key}, kind: ${incident.connector.kind})`,
      `- Purpose: ${redact(incident.connector.description ?? "n/a", knownNames)}`,
      `- Severity: ${incident.severity}`,
      `- Detected by: ${incident.detectionSource}`,
      `- Opened at: ${incident.openedAt.toISOString()}`,
      `- Current status: ${incident.status}`,
      incident.resolvedAt ? `- Resolved at: ${incident.resolvedAt.toISOString()}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (incident.timeline.length > 0) {
    sections.push(
      [
        `## Incident timeline`,
        ...incident.timeline.map(
          (t) => `- ${t.createdAt.toISOString()} [${t.kind}] ${redact(t.message, knownNames)}`,
        ),
      ].join("\n"),
    );
  }

  if (failedJobs.length > 0) {
    sections.push(
      [
        `## Failed jobs (${failedJobs.length}, newest first)`,
        ...collapseRepeats(
          failedJobs.map((j) => {
            const error = redact(j.lastError ?? "no error recorded", knownNames);
            return {
              key: `${j.type}|${j.status}|${error}`,
              text: `- ${j.createdAt.toISOString()} \`${j.type}\` on queue \`${j.queue}\` — ${j.status} after ${j.attempts}/${j.maxAttempts} attempts: ${error}`,
            };
          }),
        ),
      ].join("\n"),
    );
  }

  if (logs.length > 0) {
    sections.push(
      [
        `## Recent WARN/ERROR logs (${logs.length}, newest first)`,
        ...collapseRepeats(
          logs.map((l) => {
            const message = redact(l.message, knownNames);
            const context = l.context ? asJson(l.context, knownNames) : "";
            return {
              key: `${l.level}|${l.source}|${message}|${context}`,
              text: `- ${l.createdAt.toISOString()} ${l.level} [${l.source}] ${message}${context && context !== "{}" ? ` ${context}` : ""}`,
            };
          }),
        ),
      ].join("\n"),
    );
  }

  if (events.length > 0) {
    sections.push(
      [
        `## Recent integration events (${events.length}, newest first)`,
        ...events.map(
          (e) =>
            `- ${e.receivedAt.toISOString()} ${e.direction} \`${e.eventType}\` — ${e.status}${
              e.error ? `: ${redact(e.error, knownNames)}` : ""
            }`,
        ),
      ].join("\n"),
    );
  }

  if (claimRejections.length > 0) {
    sections.push(
      [
        `## Clearinghouse claim acknowledgements (${claimRejections.length}, newest first)`,
        ...claimRejections.map(
          (e) => `- ${e.receivedAt.toISOString()} ${asJson(e.payload, knownNames)}`,
        ),
      ].join("\n"),
    );
  }

  let markdown = sections.join("\n\n");
  let truncated = false;

  // Budget: drop whole sections from the end (which are the least decisive) before falling
  // back to a hard character cut, so the model never receives a half-line of evidence.
  while (markdown.length > MAX_CONTEXT_CHARS && sections.length > 2) {
    sections.pop();
    truncated = true;
    markdown = sections.join("\n\n");
  }
  if (markdown.length > MAX_CONTEXT_CHARS) {
    markdown = `${markdown.slice(0, MAX_CONTEXT_CHARS)}\n\n…(context truncated)`;
    truncated = true;
  }

  return { markdown, truncated };
}

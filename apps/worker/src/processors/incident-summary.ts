import type { Job as BullJob } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import { log } from "../log.js";
import { summarizeIncident, AiNotConfiguredError } from "../ai/summarize.js";

interface IncidentSummaryPayload {
  incidentId: string;
  reason?: "opened" | "resolution" | "manual";
}

/**
 * doc 03 §6: queued → generating → ready | failed.
 *
 * A missing API key is a *configuration* outcome, not a retryable fault — it is recorded as
 * `failed` with an honest message and the job returns successfully so BullMQ does not spend
 * its second attempt discovering the same thing. Everything else rethrows onto the normal
 * retry path (attempts: 2).
 */
export async function processIncidentSummaryJob(job: BullJob) {
  const { incidentId, reason = "opened" } = job.data as IncidentSummaryPayload;

  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    log.warn({ incidentId }, "incident summary requested for an incident that no longer exists");
    return;
  }

  await prisma.incident.update({ where: { id: incidentId }, data: { aiSummaryStatus: "generating" } });

  try {
    const result = await summarizeIncident(incidentId);

    const stored = {
      ...result.summary,
      model: result.model,
      promptVersion: result.promptVersion,
      generatedAt: result.generatedAt,
      reason,
    };

    await prisma.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id: incidentId },
        data: { aiSummary: stored as Prisma.InputJsonValue, aiSummaryStatus: "ready" },
      });
      await tx.incidentTimelineEntry.create({
        data: {
          incidentId,
          kind: "ai_summary",
          message: `AI summary generated (${result.model}, prompt ${result.promptVersion})`,
          actor: "system",
        },
      });
    });

    log.info(
      {
        incidentId,
        connectorId: incident.connectorId,
        model: result.model,
        promptVersion: result.promptVersion,
        contextChars: result.contextChars,
        contextTruncated: result.contextTruncated,
      },
      "incident summary ready",
    );
  } catch (err) {
    const notConfigured = err instanceof AiNotConfiguredError;
    const message = notConfigured ? "AI not configured" : err instanceof Error ? err.message : String(err);

    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        aiSummaryStatus: "failed",
        aiSummary: { error: message, failedAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });

    if (notConfigured) {
      // Not an error the operator can act on inside the app, and the app is designed to run
      // fully without a key — log it once at WARN and let the job succeed.
      log.warn({ incidentId, connectorId: incident.connectorId }, "incident summary skipped: AI not configured");
      return;
    }

    log.error({ incidentId, connectorId: incident.connectorId }, `incident summary failed: ${message}`);
    throw err;
  }
}

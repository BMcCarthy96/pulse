import type { Job as BullJob } from "bullmq";
import { prisma } from "@pulse/db";
import { log } from "../log.js";

/**
 * Phase 7 stub. The lifecycle already enqueues on open and on resolve, so the UI can render
 * the "queued" state of the AI summary card end-to-end; phase 8 replaces this body with the
 * real Anthropic call (redaction first, per CLAUDE.md).
 */
export async function processIncidentSummaryJob(job: BullJob) {
  const { incidentId, reason } = job.data as { incidentId: string; reason?: string };

  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    log.warn({ incidentId }, "incident summary requested for an incident that no longer exists");
    return;
  }

  await prisma.incident.update({ where: { id: incidentId }, data: { aiSummaryStatus: "queued" } });
  log.info(
    { incidentId, connectorId: incident.connectorId },
    `incident summary queued (${reason ?? "opened"}) — generation lands in phase 8`,
  );
}

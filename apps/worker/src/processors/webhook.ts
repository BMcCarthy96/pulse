import type { Job } from "bullmq";
import { prisma, type IntegrationEvent, type Prisma } from "@pulse/db";
import { labResultWebhookSchema, claimAckWebhookSchema } from "@pulse/shared";
import { log } from "../log.js";

class InvalidPayloadError extends Error {}

interface WebhookProcessPayload {
  eventId: string;
  connectorKey: string;
  eventType: string;
  dbJobId?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

async function processLabResult(event: IntegrationEvent) {
  const parsed = labResultWebhookSchema.safeParse(event.payload);
  if (!parsed.success) {
    throw new InvalidPayloadError(parsed.error.message);
  }
  await sleep(randomBetween(50, 200));
  log.info(
    { connectorId: event.connectorId },
    `lab result processed: order ${parsed.data.orderId}`,
  );
}

async function processClaimAck(event: IntegrationEvent) {
  const parsed = claimAckWebhookSchema.safeParse(event.payload);
  if (!parsed.success) {
    throw new InvalidPayloadError(parsed.error.message);
  }
  const { claimId, status, reason } = parsed.data;

  const claimJob = await prisma.job.findFirst({
    where: { type: "claim.submit", payload: { path: ["claimId"], equals: claimId } },
  });

  if (claimJob) {
    const existingPayload = (claimJob.payload as Record<string, unknown>) ?? {};
    await prisma.job.update({
      where: { id: claimJob.id },
      data: {
        payload: {
          ...existingPayload,
          ackStatus: status,
          ackReason: reason ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } else {
    log.warn(
      { connectorId: event.connectorId },
      `claim.ack for unknown claimId ${claimId} (no matching claim.submit job)`,
    );
  }

  if (status === "rejected") {
    // A business rejection is not a pipeline failure — the ack was processed successfully,
    // the claim just didn't get paid. Surface it as a WARN, not an event failure.
    log.warn(
      { connectorId: event.connectorId },
      `claim ${claimId} rejected: ${reason ?? "no reason given"}`,
    );
  } else {
    log.info({ connectorId: event.connectorId }, `claim ${claimId} accepted`);
  }
}

export async function processWebhookJob(job: Job<WebhookProcessPayload>) {
  const { eventId, eventType } = job.data ?? {};
  if (typeof eventId !== "string" || eventId.length === 0) {
    log.error({ bullJobId: job.id }, "webhook job missing eventId; refusing malformed payload");
    return;
  }

  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    // Queue payloads can outlive a reset or retention operation. Treat a reference to a
    // deleted event as already handled rather than retrying forever and flooding the logs.
    log.warn({ bullJobId: job.id, eventId }, "webhook job references a missing event; skipping");
    return;
  }
  await prisma.integrationEvent.update({ where: { id: eventId }, data: { status: "PROCESSING" } });

  try {
    if (eventType === "lab.result.created") {
      await processLabResult(event);
    } else if (eventType === "claim.ack") {
      await processClaimAck(event);
    } else {
      log.warn({ connectorId: event.connectorId }, `unrecognized webhook event type: ${eventType}`);
    }
    await prisma.integrationEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (err) {
    if (err instanceof InvalidPayloadError) {
      await prisma.integrationEvent.update({
        where: { id: eventId },
        data: { status: "INVALID", error: err.message, processedAt: new Date() },
      });
      log.warn({ connectorId: event.connectorId }, `webhook payload invalid: ${err.message}`);
      return; // schema will never validate on retry — don't throw, don't retry
    }
    throw err; // real failure — let BullMQ retry per policy; DEAD handling marks the event FAILED
  }
}

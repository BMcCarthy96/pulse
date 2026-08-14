import { prisma } from "@pulse/db";
import { createTrackedJob, getConnectorDef, QUEUE_NAMES } from "@pulse/shared";
import {
  verifyWebhookSignature,
  verifyWebhookSignatureV2,
  WEBHOOK_SIGNATURE_V2_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from "@pulse/shared/webhook-signature";
import { webhookProcessingQueue } from "@/lib/queue";
import { log, logToDb } from "@/lib/log";

const WEBHOOK_SIGNING_SECRET =
  process.env.WEBHOOK_SIGNING_SECRET ?? "change-me-local-dev-webhook-secret";

/**
 * The webhook ingest pipeline, extracted from the route handler so it can be integration-tested
 * as a plain function against a real database — spinning up `next start` just to assert dedupe
 * behaviour would test the framework more than the pipeline (phase 9 task 3).
 *
 * The route is a thin adapter: read the raw body and headers, call this, map the outcome to a
 * status code.
 */

export type IngestOutcome =
  | { outcome: "unknown-connector"; status: 404 }
  | { outcome: "invalid-signature"; status: 401; eventId: string }
  | { outcome: "duplicate"; status: 200 }
  | { outcome: "accepted"; status: 202; eventId: string };

export interface IngestInput {
  connectorKey: string;
  orgSlug?: string;
  rawBody: string;
  signature: string | null;
  signatureV2?: string | null;
  timestamp?: string | null;
  deliveryId: string | null;
  eventType: string | null;
}

function safeParseJson(raw: string): object {
  try {
    return JSON.parse(raw) as object;
  } catch {
    // Kept as a wrapper object rather than dropped: an unparseable body is exactly the evidence
    // an operator needs on the INVALID row, and the `payload` column is typed as JSON.
    return { raw };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

export function readWebhookHeaders(
  headers: Headers,
): Omit<IngestInput, "connectorKey" | "rawBody"> {
  return {
    signature: headers.get(WEBHOOK_SIGNATURE_HEADER),
    signatureV2: headers.get(WEBHOOK_SIGNATURE_V2_HEADER),
    timestamp: headers.get(WEBHOOK_TIMESTAMP_HEADER),
    deliveryId: headers.get(WEBHOOK_DELIVERY_HEADER),
    eventType: headers.get(WEBHOOK_EVENT_HEADER),
  };
}

export async function ingestWebhook(input: IngestInput): Promise<IngestOutcome> {
  const { connectorKey, rawBody, signature, signatureV2, timestamp, deliveryId } = input;
  const eventType = input.eventType ?? "unknown";

  const def = getConnectorDef(connectorKey);
  const connector = def
    ? await prisma.connector.findFirst({
        where: { key: connectorKey, ...(input.orgSlug ? { org: { slug: input.orgSlug } } : {}) },
      })
    : null;
  if (!def || !connector) return { outcome: "unknown-connector", status: 404 };

  const headersCapture = {
    [WEBHOOK_SIGNATURE_HEADER]: signature,
    [WEBHOOK_SIGNATURE_V2_HEADER]: signatureV2,
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_DELIVERY_HEADER]: deliveryId,
    [WEBHOOK_EVENT_HEADER]: eventType,
  };

  const v2Present = !!signatureV2 || !!timestamp;
  const v2Valid =
    v2Present && verifyWebhookSignatureV2(rawBody, signatureV2, timestamp, WEBHOOK_SIGNING_SECRET);
  const legacyAllowed = process.env.WEBHOOK_REQUIRE_TIMESTAMP !== "true";
  const signatureValid =
    v2Valid ||
    (!v2Present &&
      legacyAllowed &&
      verifyWebhookSignature(rawBody, signature, WEBHOOK_SIGNING_SECRET));
  if (!signatureValid) {
    // Recorded, not dropped. A rejected delivery is the single most useful row on the events
    // page when an upstream's secret has drifted.
    const invalid = await prisma.integrationEvent.create({
      data: {
        orgId: connector.orgId,
        connectorId: connector.id,
        direction: "INBOUND",
        eventType,
        dedupeKey: null,
        status: "INVALID",
        payload: safeParseJson(rawBody),
        headers: headersCapture,
        error: "signature verification failed",
      },
    });
    log.warn({ connectorKey, deliveryId }, "webhook signature verification failed");
    await logToDb("WARN", `${connectorKey} webhook rejected: signature verification failed`, {
      connectorId: connector.id,
    });
    return { outcome: "invalid-signature", status: 401, eventId: invalid.id };
  }

  try {
    const event = await prisma.integrationEvent.create({
      data: {
        orgId: connector.orgId,
        connectorId: connector.id,
        direction: "INBOUND",
        eventType,
        dedupeKey: deliveryId,
        status: "RECEIVED",
        payload: safeParseJson(rawBody),
        headers: headersCapture,
      },
    });

    await createTrackedJob(prisma, {
      queue: webhookProcessingQueue,
      queueName: QUEUE_NAMES.webhookProcessing,
      type: "webhook.process",
      connectorId: connector.id,
      orgId: connector.orgId,
      payload: { eventId: event.id, connectorKey, eventType },
    });

    log.info(
      { connectorKey, deliveryId, eventId: event.id },
      "webhook received, enqueued for processing",
    );
    return { outcome: "accepted", status: 202, eventId: event.id };
  } catch (err) {
    // Dedupe is enforced by the unique index on (connectorId, dedupeKey), not by a read-then-
    // write check — a replay arriving concurrently would slip through the gap between them.
    if (isUniqueConstraintError(err)) {
      log.info({ connectorKey, deliveryId }, "webhook duplicate delivery (dedupe hit)");
      return { outcome: "duplicate", status: 200 };
    }
    throw err;
  }
}

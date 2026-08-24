import { createHash } from "node:crypto";
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
  getWebhookSigningSecret,
} from "@pulse/shared/webhook-signature";
import { webhookProcessingQueue } from "@/lib/queue";
import { log, logToDb } from "@/lib/log";

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export async function readWebhookBody(
  request: Request,
  maxBytes = MAX_WEBHOOK_BODY_BYTES,
): Promise<{ rawBody: string; tooLarge: false } | { rawBody: null; tooLarge: true }> {
  if (!request.body) {
    const rawBody = await request.text();
    return Buffer.byteLength(rawBody, "utf8") > maxBytes
      ? { rawBody: null, tooLarge: true }
      : { rawBody, tooLarge: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { rawBody: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { rawBody: Buffer.concat(chunks).toString("utf8"), tooLarge: false };
}

export function webhookRateLimitScope(...parts: string[]) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

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
  | { outcome: "invalid-request"; status: 400; reason: string }
  | { outcome: "body-too-large"; status: 413 }
  | { outcome: "misconfigured"; status: 503 }
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

function rejectedBodySummary(raw: string): object {
  return {
    rejected: true,
    bytes: Buffer.byteLength(raw, "utf8"),
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function boundedHeader(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.slice(0, maxLength);
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
    // Bound attacker-controlled header values before signature parsing or structured logging.
    signature: boundedHeader(headers.get(WEBHOOK_SIGNATURE_HEADER), 256),
    signatureV2: boundedHeader(headers.get(WEBHOOK_SIGNATURE_V2_HEADER), 256),
    timestamp: boundedHeader(headers.get(WEBHOOK_TIMESTAMP_HEADER), 32),
    deliveryId: boundedHeader(headers.get(WEBHOOK_DELIVERY_HEADER), 200),
    eventType: boundedHeader(headers.get(WEBHOOK_EVENT_HEADER), 128),
  };
}

export async function ingestWebhook(input: IngestInput): Promise<IngestOutcome> {
  const { connectorKey, rawBody, signature, signatureV2, timestamp, deliveryId } = input;
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return { outcome: "body-too-large", status: 413 };
  }

  const production = process.env.NODE_ENV === "production";
  const orgSlug = input.orgSlug?.trim();
  if (production && !orgSlug) {
    return {
      outcome: "invalid-request",
      status: 400,
      reason: "tenant-scoped webhook route is required",
    };
  }
  if (production && !deliveryId?.trim()) {
    return {
      outcome: "invalid-request",
      status: 400,
      reason: "delivery id is required",
    };
  }
  if (production && (!signatureV2 || !timestamp)) {
    return {
      outcome: "invalid-request",
      status: 400,
      reason: "timestamped v2 signature is required",
    };
  }

  let webhookSecret: string;
  try {
    webhookSecret = getWebhookSigningSecret();
  } catch {
    log.error({ connectorKey }, "webhook signing secret is not configured");
    return { outcome: "misconfigured", status: 503 };
  }

  const eventType = boundedHeader(input.eventType, 128) ?? "unknown";
  const normalizedDeliveryId = boundedHeader(deliveryId, 200);

  const def = getConnectorDef(connectorKey);
  const connector = def
    ? await prisma.connector.findFirst({
        where: { key: connectorKey, ...(orgSlug ? { org: { slug: orgSlug } } : {}) },
      })
    : null;
  if (!def || !connector) return { outcome: "unknown-connector", status: 404 };

  const headersCapture = {
    // Preserve whether a signature arrived without storing reusable authentication material.
    [WEBHOOK_SIGNATURE_HEADER]: signature ? "[REDACTED]" : null,
    [WEBHOOK_SIGNATURE_V2_HEADER]: signatureV2 ? "[REDACTED]" : null,
    [WEBHOOK_TIMESTAMP_HEADER]: boundedHeader(timestamp, 32),
    [WEBHOOK_DELIVERY_HEADER]: normalizedDeliveryId,
    [WEBHOOK_EVENT_HEADER]: eventType,
  };

  const v2Present = !!signatureV2 || !!timestamp;
  const v2Valid =
    v2Present && verifyWebhookSignatureV2(rawBody, signatureV2, timestamp, webhookSecret);
  const legacyAllowed = !production && process.env.WEBHOOK_REQUIRE_TIMESTAMP !== "true";
  const signatureValid =
    v2Valid ||
    (!v2Present && legacyAllowed && verifyWebhookSignature(rawBody, signature, webhookSecret));
  if (!signatureValid) {
    // Recorded, not dropped. A rejected delivery is the single most useful row on the events
    // page when an upstream's secret has drifted.
    let invalid;
    try {
      invalid = await prisma.integrationEvent.create({
        data: {
          orgId: connector.orgId,
          connectorId: connector.id,
          direction: "INBOUND",
          eventType,
          dedupeKey: normalizedDeliveryId,
          status: "INVALID",
          payload: rejectedBodySummary(rawBody),
          headers: headersCapture,
          error: "signature verification failed",
        },
      });
    } catch (err) {
      // A repeated invalid delivery is still an authentication failure. Do not turn a replayed
      // bad request into a 500 just because the dedupe key already exists.
      if (isUniqueConstraintError(err)) {
        return { outcome: "invalid-signature", status: 401, eventId: "duplicate" };
      }
      throw err;
    }
    log.warn(
      { connectorKey, deliveryId: normalizedDeliveryId },
      "webhook signature verification failed",
    );
    await logToDb("WARN", `${connectorKey} webhook rejected: signature verification failed`, {
      orgId: connector.orgId,
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
        dedupeKey: normalizedDeliveryId,
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
      { connectorKey, deliveryId: normalizedDeliveryId, eventId: event.id },
      "webhook received, enqueued for processing",
    );
    return { outcome: "accepted", status: 202, eventId: event.id };
  } catch (err) {
    // Dedupe is enforced by the unique index on (connectorId, dedupeKey), not by a read-then-
    // write check — a replay arriving concurrently would slip through the gap between them.
    if (isUniqueConstraintError(err)) {
      log.info(
        { connectorKey, deliveryId: normalizedDeliveryId },
        "webhook duplicate delivery (dedupe hit)",
      );
      return { outcome: "duplicate", status: 200 };
    }
    throw err;
  }
}

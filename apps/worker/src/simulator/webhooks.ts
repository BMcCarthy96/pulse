import { randomUUID } from "node:crypto";
import {
  signWebhookBody,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from "@pulse/shared/webhook-signature";
import { log } from "../log.js";
import { getChaosState } from "./chaos.js";

const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL ?? "http://localhost:3010";
const WEBHOOK_SIGNING_SECRET = process.env.WEBHOOK_SIGNING_SECRET ?? "change-me-local-dev-webhook-secret";
const EMIT_TIMEOUT_MS = 5000;

async function post(connectorKey: string, eventType: string, body: string, deliveryId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMIT_TIMEOUT_MS);
  try {
    const res = await fetch(`${WEBHOOK_TARGET_URL}/api/webhooks/${connectorKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(body, WEBHOOK_SIGNING_SECRET),
        [WEBHOOK_DELIVERY_HEADER]: deliveryId,
        [WEBHOOK_EVENT_HEADER]: eventType,
      },
      body,
      signal: controller.signal,
    });
    log.info(
      { connectorKey, eventType, deliveryId, status: res.status },
      "simulator webhook delivered",
    );
  } catch (err) {
    log.warn({ connectorKey, eventType, deliveryId, err }, "simulator webhook delivery failed");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fire-and-forget webhook emission. Chaos-coupled per doc 03 §2: DEGRADED occasionally
 * double-sends with the same delivery id (exercises inbound dedupe); BAD_PAYLOAD sends a
 * malformed body (exercises INVALID handling).
 */
export async function emitWebhook(
  connectorKey: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  const { mode } = await getChaosState(connectorKey);
  const deliveryId = randomUUID();

  const bodyObj = mode === "BAD_PAYLOAD" ? { malformed: true, eventType } : { eventType, ...(payload as object) };
  const body = JSON.stringify(bodyObj);

  if (mode === "BAD_PAYLOAD") {
    log.warn({ connectorKey, eventType, deliveryId, body: bodyObj }, "emitting schema-invalid webhook body (chaos: BAD_PAYLOAD)");
  }

  void post(connectorKey, eventType, body, deliveryId);

  if (mode === "DEGRADED" && Math.random() < 0.15) {
    // Duplicate delivery: same delivery id, sent again shortly after.
    setTimeout(() => void post(connectorKey, eventType, body, deliveryId), 500);
  }
}

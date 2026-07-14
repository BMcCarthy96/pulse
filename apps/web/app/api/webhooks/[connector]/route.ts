import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@pulse/db";
import { getConnectorDef, createTrackedJob, QUEUE_NAMES } from "@pulse/shared";
import { webhookProcessingQueue } from "@/lib/queue";
import { log, logToDb } from "@/lib/log";

const WEBHOOK_SIGNING_SECRET = process.env.WEBHOOK_SIGNING_SECRET ?? "change-me-local-dev-webhook-secret";

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", WEBHOOK_SIGNING_SECRET).update(rawBody).digest("hex");
  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "hex");
    providedBuf = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function safeParseJson(raw: string): object {
  try {
    return JSON.parse(raw) as object;
  } catch {
    return { raw };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

export async function POST(req: Request, { params }: { params: Promise<{ connector: string }> }) {
  const { connector: connectorKey } = await params;

  const def = getConnectorDef(connectorKey);
  const connector = def ? await prisma.connector.findUnique({ where: { key: connectorKey } }) : null;
  if (!def || !connector) {
    return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-pulse-signature");
  const deliveryId = req.headers.get("x-pulse-delivery");
  const eventType = req.headers.get("x-pulse-event") ?? "unknown";
  const headersCapture = { "x-pulse-signature": signature, "x-pulse-delivery": deliveryId, "x-pulse-event": eventType };

  if (!verifySignature(rawBody, signature)) {
    await prisma.integrationEvent.create({
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
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = safeParseJson(rawBody);

  try {
    const event = await prisma.integrationEvent.create({
      data: {
        orgId: connector.orgId,
        connectorId: connector.id,
        direction: "INBOUND",
        eventType,
        dedupeKey: deliveryId,
        status: "RECEIVED",
        payload,
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

    log.info({ connectorKey, deliveryId, eventId: event.id }, "webhook received, enqueued for processing");
    return NextResponse.json({ received: true }, { status: 202 });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      log.info({ connectorKey, deliveryId }, "webhook duplicate delivery (dedupe hit)");
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    throw err;
  }
}

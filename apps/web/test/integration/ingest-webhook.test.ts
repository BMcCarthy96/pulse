import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@pulse/db";
import { signWebhookBody, signWebhookBodyV2 } from "@pulse/shared/webhook-signature";
import { ingestWebhook } from "@/lib/ingest-webhook";
import { webhookProcessingQueue } from "@/lib/queue";
import { createConnector, createOrg } from "../../../../test/integration/fixtures.js";

/**
 * The inbound webhook pipeline against a real database and a real queue.
 *
 * Tested as a function rather than through `next start`: the behaviour that matters here —
 * signature rejection, dedupe, the tracked job — is all in `ingestWebhook`, and an HTTP server
 * in the middle would only add a way for the test to be flaky.
 */

const SECRET = "integration-test-secret";
const LAB_BODY = JSON.stringify({ eventType: "lab.result", patientRef: "PAT-4821", value: 12.4 });
const mutableEnv = process.env as Record<string, string | undefined>;

async function seedLabConnector() {
  const org = await createOrg();
  const connector = await createConnector(org.id, {
    key: "lab-results",
    displayName: "Northside Labs (HL7v2)",
    kind: "inbound_webhook",
    syncIntervalSec: null,
  });
  return { org, connector };
}

function delivery(over: Partial<Parameters<typeof ingestWebhook>[0]> = {}) {
  const rawBody = over.rawBody ?? LAB_BODY;
  return {
    connectorKey: "lab-results",
    rawBody,
    signature: signWebhookBody(rawBody, SECRET),
    deliveryId: `delivery-${Math.random().toString(36).slice(2, 10)}`,
    eventType: "lab.result",
    ...over,
  };
}

afterAll(async () => {
  await webhookProcessingQueue.close();
});

describe("ingestWebhook — happy path", () => {
  it("persists the event and enqueues a tracked job", async () => {
    const { connector } = await seedLabConnector();

    const result = await ingestWebhook(delivery());

    expect(result).toMatchObject({ outcome: "accepted", status: 202 });

    const event = await prisma.integrationEvent.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    expect(event.status).toBe("RECEIVED");
    expect(event.direction).toBe("INBOUND");
    expect(event.eventType).toBe("lab.result");

    const job = await prisma.job.findFirstOrThrow({ where: { connectorId: connector.id } });
    expect(job.type).toBe("webhook.process");
    expect(job.queue).toBe("webhook-processing");
    expect(job.status).toBe("QUEUED");
    expect(job.payload).toMatchObject({ eventId: event.id });
  });

  it("captures the delivery headers for later inspection", async () => {
    await seedLabConnector();
    const input = delivery();

    await ingestWebhook(input);

    const event = await prisma.integrationEvent.findFirstOrThrow({});
    expect(event.headers).toMatchObject({
      "x-pulse-signature": "[REDACTED]",
      "x-pulse-delivery": input.deliveryId,
      "x-pulse-event": "lab.result",
    });
    expect(JSON.stringify(event.headers)).not.toContain(input.signature);
  });

  it("stores the parsed payload", async () => {
    await seedLabConnector();
    await ingestWebhook(delivery());

    const event = await prisma.integrationEvent.findFirstOrThrow({});
    expect(event.payload).toMatchObject({ eventType: "lab.result", value: 12.4 });
  });
});

describe("ingestWebhook — signature rejection", () => {
  it("requires a delivery id and timestamped signature in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    mutableEnv.NODE_ENV = "production";
    try {
      const result = await ingestWebhook(delivery({ orgSlug: "test-scope", deliveryId: null }));
      expect(result).toMatchObject({ outcome: "invalid-request", status: 400 });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const unscoped = await ingestWebhook(
        delivery({
          signature: null,
          signatureV2: signWebhookBodyV2(LAB_BODY, SECRET, Number(timestamp)),
          timestamp,
        }),
      );
      expect(unscoped).toMatchObject({
        outcome: "invalid-request",
        status: 400,
        reason: "tenant-scoped webhook route is required",
      });
      expect(await prisma.integrationEvent.count()).toBe(0);
    } finally {
      mutableEnv.NODE_ENV = previousNodeEnv;
    }
  });

  it("accepts a valid timestamped production delivery", async () => {
    const { org } = await seedLabConnector();
    const previousNodeEnv = process.env.NODE_ENV;
    mutableEnv.NODE_ENV = "production";
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const result = await ingestWebhook(
        delivery({
          orgSlug: org.slug,
          signature: null,
          signatureV2: signWebhookBodyV2(LAB_BODY, SECRET, Number(timestamp)),
          timestamp,
        }),
      );
      expect(result).toMatchObject({ outcome: "accepted", status: 202 });
    } finally {
      mutableEnv.NODE_ENV = previousNodeEnv;
    }
  });

  it("rejects a tampered body and records it as INVALID", async () => {
    const { connector } = await seedLabConnector();

    const signature = signWebhookBody(LAB_BODY, SECRET);
    const tampered = LAB_BODY.replace("12.4", "999.9");
    const result = await ingestWebhook(delivery({ rawBody: tampered, signature }));

    expect(result).toMatchObject({ outcome: "invalid-signature", status: 401 });

    const event = await prisma.integrationEvent.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    expect(event.status).toBe("INVALID");
    expect(event.error).toBe("signature verification failed");
    // The rejected delivery is kept without persisting untrusted body content. Operators still
    // get a stable hash and byte count to correlate with an upstream log or support ticket.
    expect(event.payload).toMatchObject({ rejected: true, bytes: tampered.length });
    expect(JSON.stringify(event.payload)).not.toContain("999.9");
  });

  it("treats a repeated invalid delivery as a 401 without duplicate rows", async () => {
    const { connector } = await seedLabConnector();
    const input = delivery({ deliveryId: "invalid-replay", signature: "not-valid" });

    const first = await ingestWebhook(input);
    const second = await ingestWebhook(input);

    expect(first).toMatchObject({ outcome: "invalid-signature", status: 401 });
    expect(second).toMatchObject({ outcome: "invalid-signature", status: 401 });
    expect(await prisma.integrationEvent.count({ where: { connectorId: connector.id } })).toBe(1);
  });

  it("rejects a missing signature", async () => {
    await seedLabConnector();
    const result = await ingestWebhook(delivery({ signature: null }));
    expect(result).toMatchObject({ outcome: "invalid-signature", status: 401 });
  });

  it("rejects a signature made with the wrong secret", async () => {
    await seedLabConnector();
    const result = await ingestWebhook(
      delivery({ signature: signWebhookBody(LAB_BODY, "wrong-secret") }),
    );
    expect(result).toMatchObject({ outcome: "invalid-signature", status: 401 });
  });

  it("does not enqueue work for a rejected delivery", async () => {
    await seedLabConnector();
    await ingestWebhook(delivery({ signature: "deadbeef" }));
    expect(await prisma.job.count()).toBe(0);
  });

  it("writes a WARN log entry an operator can find", async () => {
    const { connector } = await seedLabConnector();
    await ingestWebhook(delivery({ signature: null }));

    const logs = await prisma.logEntry.findMany({
      where: { connectorId: connector.id, level: "WARN" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toContain("signature verification failed");
    expect(logs[0].source).toBe("web");
  });
});

describe("ingestWebhook — malformed body", () => {
  it("keeps an unparseable body verbatim rather than dropping the delivery", async () => {
    await seedLabConnector();
    const raw = "{not json at all";

    // Correctly signed, but the payload is garbage — this is the BAD_PAYLOAD chaos mode.
    const result = await ingestWebhook(
      delivery({ rawBody: raw, signature: signWebhookBody(raw, SECRET) }),
    );

    expect(result.outcome).toBe("accepted");
    const event = await prisma.integrationEvent.findFirstOrThrow({});
    expect(event.payload).toEqual({ raw });
  });
});

describe("ingestWebhook — dedupe", () => {
  it("treats a replayed delivery id as a duplicate without creating a second event", async () => {
    const { connector } = await seedLabConnector();
    const input = delivery();

    const first = await ingestWebhook(input);
    const second = await ingestWebhook(input);

    expect(first).toMatchObject({ outcome: "accepted", status: 202 });
    expect(second).toMatchObject({ outcome: "duplicate", status: 200 });

    expect(await prisma.integrationEvent.count({ where: { connectorId: connector.id } })).toBe(1);
    // Critically, the replay must not enqueue a second unit of work.
    expect(await prisma.job.count({ where: { connectorId: connector.id } })).toBe(1);
  });

  it("leaves the original event untouched on replay", async () => {
    await seedLabConnector();
    const input = delivery();

    await ingestWebhook(input);
    const original = await prisma.integrationEvent.findFirstOrThrow({});

    await ingestWebhook(input);
    const after = await prisma.integrationEvent.findFirstOrThrow({});

    expect(after).toEqual(original);
  });

  it("accepts distinct delivery ids carrying the same body", async () => {
    await seedLabConnector();

    await ingestWebhook(delivery());
    const second = await ingestWebhook(delivery());

    expect(second.outcome).toBe("accepted");
    expect(await prisma.integrationEvent.count()).toBe(2);
  });

  it("accepts legacy test deliveries with no delivery id outside production", async () => {
    await seedLabConnector();

    // A null dedupeKey is excluded from the unique index in Postgres, so these must both land
    // rather than the second silently disappearing.
    const first = await ingestWebhook(delivery({ deliveryId: null }));
    const second = await ingestWebhook(delivery({ deliveryId: null }));

    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("accepted");
    expect(await prisma.integrationEvent.count()).toBe(2);
  });

  it("scopes dedupe per connector", async () => {
    const { org } = await seedLabConnector();
    await createConnector(org.id, {
      key: "claims",
      displayName: "ClearPath Clearinghouse (X12 837)",
      kind: "outbound_async",
      syncIntervalSec: null,
    });

    const shared = delivery();
    await ingestWebhook(shared);
    const other = await ingestWebhook({ ...shared, connectorKey: "claims" });

    expect(other.outcome).toBe("accepted");
    expect(await prisma.integrationEvent.count()).toBe(2);
  });
});

describe("ingestWebhook — unknown connector", () => {
  it("404s without writing anything", async () => {
    await seedLabConnector();

    const result = await ingestWebhook(delivery({ connectorKey: "not-a-connector" }));

    expect(result).toMatchObject({ outcome: "unknown-connector", status: 404 });
    expect(await prisma.integrationEvent.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });

  it("404s for a known connector key that has no row in this org", async () => {
    // getConnectorDef knows "erx", but nothing seeded it here.
    const result = await ingestWebhook(delivery({ connectorKey: "erx" }));
    expect(result.status).toBe(404);
  });
});

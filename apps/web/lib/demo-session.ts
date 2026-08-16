import { createHash, randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma, type Prisma } from "@pulse/db";
import { CONNECTOR_DEFS, QUEUE_NAMES, getRedisConnectionOptions } from "@pulse/shared";

const DEMO_TTL_MS = 60 * 60 * 1_000;
const MAX_ACTIVE_DEMO_SESSIONS = 25;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const TENANT_QUEUE_NAMES = [
  QUEUE_NAMES.sync,
  QUEUE_NAMES.webhookProcessing,
  QUEUE_NAMES.claimsSubmit,
  QUEUE_NAMES.eligibility,
  QUEUE_NAMES.incidentSummary,
  QUEUE_NAMES.demoReset,
] as const;

type DemoTenantRefs = {
  sessionId: string;
  orgId: string;
  userId: string;
  connectorIds: Set<string>;
  incidentIds: Set<string>;
  dbJobIds: Set<string>;
  bullJobIds: Set<string>;
};

function demoEnabled() {
  return process.env.DEMO_MODE === "true";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function demoOrgSlug() {
  return `demo-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function belongsToDemoTenant(job: { id?: string | number; data?: unknown }, refs: DemoTenantRefs) {
  const data =
    job.data && typeof job.data === "object" ? (job.data as Record<string, unknown>) : {};
  const matches = (value: unknown, values: Set<string>) =>
    typeof value === "string" && values.has(value);
  return (
    data.orgId === refs.orgId ||
    data.userId === refs.userId ||
    matches(data.connectorId, refs.connectorIds) ||
    matches(data.incidentId, refs.incidentIds) ||
    matches(data.dbJobId, refs.dbJobIds) ||
    (job.id !== undefined && refs.bullJobIds.has(String(job.id)))
  );
}

/**
 * Remove queue records that can still dispatch work for the pre-reset scenario. BullMQ does not
 * permit another process to remove an active job while its worker owns the lock; replacing every
 * connector during the database reset is the generation fence for that narrow race. Such a job
 * can finish in Redis, but all of its database foreign keys are stale and lifecycle handlers use
 * updateMany/find-before-write, so it cannot contaminate the newly-created baseline.
 */
async function clearDemoQueueState(refs: DemoTenantRefs) {
  for (const queueName of TENANT_QUEUE_NAMES) {
    const queue = new Queue(queueName, {
      connection: getRedisConnectionOptions(REDIS_URL),
    });
    try {
      const jobs = await queue.getJobs(
        ["waiting", "delayed", "prioritized", "paused", "active", "completed", "failed"],
        0,
        9_999,
      );
      for (const job of jobs) {
        if (!belongsToDemoTenant(job, refs)) continue;
        // Active jobs are protected by the connector-id generation fence documented above.
        await job.remove().catch(() => undefined);
      }
      if (queueName === QUEUE_NAMES.sync) {
        for (const repeatable of await queue.getRepeatableJobs()) {
          const identity = `${repeatable.key} ${repeatable.id ?? ""}`;
          if (identity.includes(refs.orgId)) {
            await queue.removeRepeatableByKey(repeatable.key).catch(() => undefined);
          }
        }
      }
    } catch {
      // Redis availability must not prevent the database generation fence from restoring the
      // workspace. Readiness reports Redis separately, and queued stale IDs remain harmless.
    } finally {
      await queue.close().catch(() => undefined);
    }
  }
}

function scanKeys(redis: Redis, pattern: string) {
  return new Promise<string[]>((resolve, reject) => {
    const keys: string[] = [];
    const stream = redis.scanStream({ match: pattern, count: 100 });
    stream.on("data", (batch: string[]) => keys.push(...batch));
    stream.on("end", () => resolve(keys));
    stream.on("error", reject);
  });
}

/** Restore tenant/session quotas without touching deployment-wide recruiter guardrails. */
async function clearDemoQuotaState(refs: DemoTenantRefs) {
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
  });
  try {
    await redis.connect();
    const patterns = [
      `pulse:ratelimit:user:${refs.userId}:*`,
      `pulse:ratelimit:org:${refs.orgId}:*`,
      `pulse:ratelimit:demo:${refs.sessionId}:investigation:*`,
      `pulse:ai-budget:${refs.orgId}:*`,
    ];
    for (const pattern of patterns) {
      const keys = await scanKeys(redis, pattern);
      if (keys.length > 0) await redis.unlink(...keys);
    }
  } catch {
    // Quotas have TTLs and are secondary to restoring the authoritative database scenario.
  } finally {
    if (redis.status === "ready") await redis.quit().catch(() => redis.disconnect());
    else redis.disconnect();
  }
}

async function createDemoBaseline(
  tx: Prisma.TransactionClient,
  args: { orgId: string; sessionId: string; now: Date },
) {
  const connectorRows = CONNECTOR_DEFS.slice(0, 4);
  const connectors = [];
  for (const def of connectorRows) {
    connectors.push(
      await tx.connector.create({
        data: {
          orgId: args.orgId,
          key: def.key,
          displayName: def.displayName,
          description: def.description,
          kind: def.kind,
          syncIntervalSec: def.syncIntervalSec,
          status: def.key === "ehr-fhir" ? "DOWN" : "HEALTHY",
          chaosMode: def.key === "ehr-fhir" ? "OUTAGE" : "HEALTHY",
        },
      }),
    );
  }
  const ehr = connectors.find((connector) => connector.key === "ehr-fhir")!;
  const openedAt = new Date(args.now.getTime() - 12 * 60_000);
  const incident = await tx.incident.create({
    data: {
      orgId: args.orgId,
      connectorId: ehr.id,
      status: "OPEN",
      severity: "CRITICAL",
      title: "Mercy General EHR sync is failing",
      openedAt,
      detectionSource: "health-engine",
      timeline: {
        create: [
          {
            kind: "opened",
            message: "Incident opened after the EHR connector crossed the error-rate threshold.",
            actor: "system",
            createdAt: openedAt,
          },
          {
            kind: "health_transition",
            message: "Upstream returned repeated 503 responses during scheduled syncs.",
            actor: "system",
            createdAt: new Date(openedAt.getTime() + 2 * 60_000),
          },
        ],
      },
    },
  });
  await tx.job.create({
    data: {
      orgId: args.orgId,
      connectorId: ehr.id,
      queue: "sync",
      type: "sync.page",
      status: "DEAD",
      attempts: 5,
      maxAttempts: 5,
      payload: { page: 1, connectorKey: "ehr-fhir", demo: true },
      lastError: "upstream 503: service unavailable",
      errorHistory: [
        { attempt: 1, message: "upstream 503: service unavailable" },
        { attempt: 2, message: "upstream 503: service unavailable" },
        { attempt: 3, message: "upstream 503: service unavailable" },
        { attempt: 4, message: "upstream 503: service unavailable" },
        { attempt: 5, message: "upstream 503: service unavailable" },
      ],
      createdAt: new Date(openedAt.getTime() + 3 * 60_000),
      updatedAt: new Date(openedAt.getTime() + 3 * 60_000),
    },
  });
  await tx.job.create({
    data: {
      orgId: args.orgId,
      connectorId: ehr.id,
      queue: "sync",
      type: "sync.page",
      status: "FAILED",
      attempts: 3,
      maxAttempts: 5,
      payload: { page: 2, connectorKey: "ehr-fhir", demo: true },
      lastError: "upstream 503: service unavailable",
      errorHistory: [{ attempt: 3, message: "upstream 503: service unavailable" }],
      createdAt: new Date(openedAt.getTime() + 4 * 60_000),
      updatedAt: new Date(openedAt.getTime() + 4 * 60_000),
    },
  });
  await tx.logEntry.createMany({
    data: [
      {
        orgId: args.orgId,
        connectorId: ehr.id,
        incidentId: incident.id,
        level: "ERROR",
        source: "worker",
        message: "sync.page failed after retry budget exhausted",
        context: { statusCode: 503, upstream: "ehr-fhir" },
        createdAt: new Date(openedAt.getTime() + 4 * 60_000),
      },
      {
        orgId: args.orgId,
        connectorId: ehr.id,
        incidentId: incident.id,
        level: "WARN",
        source: "health-engine",
        message: "error rate 100% across the last health window",
        context: { errorRate: 1, p95LatencyMs: 5000 },
        createdAt: new Date(openedAt.getTime() + 5 * 60_000),
      },
    ],
  });
  await tx.integrationEvent.create({
    data: {
      orgId: args.orgId,
      connectorId: ehr.id,
      direction: "OUTBOUND",
      eventType: "sync.page.requested",
      dedupeKey: `${args.sessionId}:sync-page-1`,
      status: "FAILED",
      payload: { page: 1, recordCount: 42, demo: true },
      error: "upstream 503: service unavailable",
      receivedAt: new Date(openedAt.getTime() + 3 * 60_000),
    },
  });
  await tx.healthSnapshot.createMany({
    data: [
      {
        connectorId: ehr.id,
        status: "HEALTHY",
        errorRate: 0.01,
        p95LatencyMs: 240,
        totalCalls: 100,
        failedCalls: 1,
        windowStart: new Date(openedAt.getTime() - 15 * 60_000),
        windowEnd: openedAt,
        createdAt: openedAt,
      },
      {
        connectorId: ehr.id,
        status: "DOWN",
        errorRate: 1,
        p95LatencyMs: 5000,
        totalCalls: 10,
        failedCalls: 10,
        windowStart: openedAt,
        windowEnd: args.now,
        createdAt: new Date(openedAt.getTime() + 5 * 60_000),
      },
    ],
  });
  return { connectors, incident };
}

/**
 * Creates a small, isolated tenant instead of sharing the seeded Lakeview tenant. The data is
 * intentionally compact so a recruiter can get from the login button to the investigation in
 * one request, while every row still carries an org boundary for the same queries used in prod.
 */
export async function provisionDemoSession() {
  if (!demoEnabled()) return null;
  const now = new Date();
  const sessionId = randomUUID();
  const tokenHash = sha256(sessionId);
  const expiresAt = new Date(now.getTime() + DEMO_TTL_MS);
  const orgSlug = demoOrgSlug();

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize capacity checks across concurrent recruiter clicks. A plain count-then-create
      // allows a burst to exceed the deployment-wide 25-tenant limit.
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('pulse:demo-capacity'))");
      const active = await tx.demoSession.count({
        where: { status: "ACTIVE", expiresAt: { gt: now } },
      });
      if (active >= MAX_ACTIVE_DEMO_SESSIONS) throw new Error("DEMO_CAPACITY");

      const org = await tx.organization.create({
        data: { name: "Pulse Guided Demo", slug: orgSlug },
      });
      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email: `${sessionId}@demo.pulse.local`,
          name: "Demo Operator",
          role: "OPS",
          passwordHash: sha256(`${sessionId}:demo`),
        },
      });
      await createDemoBaseline(tx, { orgId: org.id, sessionId, now });
      const demoSession = await tx.demoSession.create({
        data: {
          id: sessionId,
          orgId: org.id,
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
      return { id: demoSession.id, orgId: org.id, user };
    });
  } catch (error) {
    // A capacity race should not leave a partially-created tenant behind.
    if (error instanceof Error && error.message.includes("DEMO_CAPACITY")) throw error;
    throw error;
  }
}

export async function resetDemoSession(orgId: string, userId: string) {
  if (!demoEnabled()) throw new Error("DEMO_DISABLED");
  const session = await prisma.demoSession.findFirst({
    where: { orgId, userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { id: true, orgId: true },
  });
  if (!session) return false;
  let runtimeRefs: DemoTenantRefs | null = null;
  const reset = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pulse:demo-reset:${orgId}`}, 0))::text AS "lock"`;
    const activeSession = await tx.demoSession.findFirst({
      where: { id: session.id, orgId, userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!activeSession) return false;

    const [connectors, incidents, jobs] = await Promise.all([
      tx.connector.findMany({ where: { orgId }, select: { id: true } }),
      tx.incident.findMany({ where: { orgId }, select: { id: true } }),
      tx.job.findMany({ where: { orgId }, select: { id: true, bullJobId: true } }),
    ]);
    runtimeRefs = {
      sessionId: session.id,
      orgId,
      userId,
      connectorIds: new Set(connectors.map((item) => item.id)),
      incidentIds: new Set(incidents.map((item) => item.id)),
      dbJobIds: new Set(jobs.map((item) => item.id)),
      bullJobIds: new Set(jobs.flatMap((item) => (item.bullJobId ? [item.bullJobId] : []))),
    };

    // Remove every mutable row owned by this demo tenant. Identity and the signed-in session are
    // intentionally retained; connector recreation gives the replacement scenario fresh IDs.
    await tx.investigation.deleteMany({ where: { orgId } });
    await tx.aiRun.deleteMany({ where: { orgId } });
    await tx.auditEntry.deleteMany({ where: { orgId } });
    await tx.logEntry.deleteMany({ where: { orgId } });
    await tx.integrationEvent.deleteMany({ where: { orgId } });
    await tx.job.deleteMany({ where: { orgId } });
    await tx.syncRun.deleteMany({ where: { connector: { orgId } } });
    await tx.incident.deleteMany({ where: { orgId } });
    await tx.healthSnapshot.deleteMany({ where: { connector: { orgId } } });
    await tx.connector.deleteMany({ where: { orgId } });
    await createDemoBaseline(tx, { orgId, sessionId: session.id, now: new Date() });
    await tx.demoSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    // The audit is part of the serialized reset itself. Concurrent resets therefore converge on
    // one current entry: the later transaction removes the earlier generation before writing its
    // own, and a successful reset can never be committed without its audit record.
    await tx.auditEntry.create({
      data: {
        orgId,
        userId,
        action: "demo.reset",
        targetType: "demo_session",
        targetId: session.id,
        metadata: {},
      },
    });
    return true;
  });
  if (runtimeRefs) {
    // Runtime cleanup is intentionally outside the short database transaction. New connector
    // IDs already fence active jobs, while this removes waiting/delayed history and resets only
    // tenant/session quotas without holding database locks on Redis round trips.
    await Promise.all([clearDemoQueueState(runtimeRefs), clearDemoQuotaState(runtimeRefs)]);
  }
  return reset;
}

export function demoTokenHash(value: string) {
  return sha256(value);
}

export type DemoProvisionedUser = Awaited<ReturnType<typeof provisionDemoSession>>;

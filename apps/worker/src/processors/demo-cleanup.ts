import { Redis } from "ioredis";
import { prisma } from "@pulse/db";
import {
  claimsSubmitQueue,
  demoResetQueue,
  eligibilityQueue,
  incidentSummaryQueue,
  syncQueue,
  webhookProcessingQueue,
} from "../queues.js";
import { log } from "../log.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const TENANT_QUEUES = [
  syncQueue,
  webhookProcessingQueue,
  claimsSubmitQueue,
  eligibilityQueue,
  incidentSummaryQueue,
  demoResetQueue,
];

type TenantRefs = {
  sessionId: string;
  orgId: string;
  userId: string;
  connectorIds: Set<string>;
  incidentIds: Set<string>;
  dbJobIds: Set<string>;
  bullJobIds: Set<string>;
};

function belongsToTenant(job: { id?: string | number; data?: unknown }, refs: TenantRefs) {
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

async function removeTenantQueueState(refs: TenantRefs) {
  let cleared = true;
  for (const queue of TENANT_QUEUES) {
    try {
      const jobs = await queue.getJobs(
        ["waiting", "delayed", "prioritized", "paused", "active", "completed", "failed"],
        0,
        9_999,
      );
      for (const job of jobs) {
        if (!belongsToTenant(job, refs)) continue;
        try {
          await job.remove();
        } catch (error) {
          cleared = false;
          // Active BullMQ jobs cannot always be removed. The next janitor pass will retry after
          // the worker has released the lock, while the expired session remains inaccessible.
          log.warn({ queue: queue.name, jobId: job.id, err: error }, "could not remove demo job");
        }
      }
    } catch (error) {
      cleared = false;
      log.warn({ queue: queue.name, orgId: refs.orgId, err: error }, "could not scan demo queue");
    }
  }

  try {
    // Repeatable sync schedules are keyed with the tenant id. Removing them prevents an expired
    // demo connector from being re-enqueued after its organization has been deleted.
    for (const repeatable of await syncQueue.getRepeatableJobs()) {
      const repeatKey = repeatable.key + " " + (repeatable.id ?? "");
      if (repeatKey.includes(refs.orgId))
        await syncQueue.removeRepeatableByKey(repeatable.key).catch((error) => {
          cleared = false;
          log.warn(
            { key: repeatable.key, orgId: refs.orgId, err: error },
            "could not remove demo repeatable job",
          );
        });
    }
  } catch (error) {
    cleared = false;
    log.warn({ orgId: refs.orgId, err: error }, "could not scan repeatable demo jobs");
  }
  return cleared;
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

async function clearTenantRedisState(refs: TenantRefs) {
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
  });
  try {
    await redis.connect();
    const patterns = [
      "pulse:ratelimit:user:" + refs.userId + ":*",
      "pulse:ratelimit:org:" + refs.orgId + ":*",
      "pulse:ratelimit:demo:" + refs.sessionId + ":*",
      "pulse:ai-budget:" + refs.orgId + ":*",
    ];
    for (const pattern of patterns) {
      const keys = await scanKeys(redis, pattern);
      if (keys.length > 0) await redis.unlink(...keys);
    }
    return true;
  } catch (error) {
    // Redis keys have TTLs, but keep the database janitor fail-safe when Redis is briefly down.
    log.warn({ orgId: refs.orgId, err: error }, "could not clear demo Redis state");
    return false;
  } finally {
    if (redis.status === "ready") await redis.quit().catch(() => redis.disconnect());
    else redis.disconnect();
  }
}

/** Five-minute janitor for guarded demo tenants. Claims rows before deleting the org. */
export async function runDemoCleanup() {
  if (process.env.DEMO_MODE !== "true") return { deleted: 0 };
  const now = new Date();
  const staleDeletingAt = new Date(now.getTime() - 10 * 60_000);
  const expired = await prisma.demoSession.findMany({
    where: {
      OR: [
        { status: "ACTIVE", expiresAt: { lte: now } },
        { status: "DELETING", lastSeenAt: { lte: staleDeletingAt } },
      ],
    },
    select: { id: true, orgId: true, userId: true, status: true },
    take: 50,
  });
  let deleted = 0;
  for (const session of expired) {
    const claimed = await prisma.demoSession.updateMany({
      where: {
        id: session.id,
        ...(session.status === "ACTIVE"
          ? { status: "ACTIVE", expiresAt: { lte: now } }
          : { status: "DELETING", lastSeenAt: { lte: staleDeletingAt } }),
      },
      data: { status: "DELETING", lastSeenAt: now },
    });
    if (claimed.count !== 1) continue;

    const [connectors, incidents, jobs] = await Promise.all([
      prisma.connector.findMany({ where: { orgId: session.orgId }, select: { id: true } }),
      prisma.incident.findMany({ where: { orgId: session.orgId }, select: { id: true } }),
      prisma.job.findMany({
        where: { orgId: session.orgId },
        select: { id: true, bullJobId: true },
      }),
    ]);
    const refs: TenantRefs = {
      sessionId: session.id,
      orgId: session.orgId,
      userId: session.userId,
      connectorIds: new Set(connectors.map((item) => item.id)),
      incidentIds: new Set(incidents.map((item) => item.id)),
      dbJobIds: new Set(jobs.map((item) => item.id)),
      bullJobIds: new Set(jobs.flatMap((item) => (item.bullJobId ? [item.bullJobId] : []))),
    };

    const queuesCleared = await removeTenantQueueState(refs);
    const redisCleared = await clearTenantRedisState(refs);
    if (!queuesCleared || !redisCleared) {
      await prisma.demoSession
        .update({ where: { id: session.id }, data: { status: "DELETING", lastSeenAt: new Date() } })
        .catch(() => undefined);
      log.warn(
        { orgId: session.orgId, queuesCleared, redisCleared },
        "demo cleanup deferred until tenant runtime state can be cleared",
      );
      continue;
    }
    try {
      await prisma.organization.delete({ where: { id: session.orgId } });
      deleted++;
    } catch (error) {
      // Allow a later pass to retry if a concurrent worker still holds a tenant row.
      await prisma.demoSession
        .update({ where: { id: session.id }, data: { status: "DELETING", lastSeenAt: new Date() } })
        .catch(() => undefined);
      log.warn({ orgId: session.orgId, err: error }, "could not delete expired demo org");
    }
  }
  log.info({ deleted }, "expired demo sessions cleaned up");
  return { deleted };
}

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { APP_NAME, QUEUE_NAMES, getHealthConfig, injectTrace } from "@pulse/shared";
import { prisma } from "@pulse/db";

import { log, flushLogs } from "./log.js";
import { ehrApp } from "./simulator/ehr.js";
import { clearinghouseApp } from "./simulator/clearinghouse.js";
import { eligibilityApp } from "./simulator/eligibility.js";
import { labsApp } from "./simulator/labs.js";
import {
  syncQueue,
  webhookProcessingQueue,
  claimsSubmitQueue,
  eligibilityQueue,
  incidentSummaryQueue,
  healthTickQueue,
  retentionQueue,
  demoResetQueue,
  demoCleanupQueue,
  createTrackedWorker,
  eligibilityBackoffStrategy,
  incidentSummaryBackoffStrategy,
} from "./queues.js";
import { processSyncJob } from "./processors/sync.js";
import { processClaimJob } from "./processors/claim.js";
import { processEligibilityJob } from "./processors/eligibility.js";
import { processWebhookJob } from "./processors/webhook.js";
import { processIncidentSummaryJob } from "./processors/incident-summary.js";
import { runHealthTick } from "./health/engine.js";
import { runRetentionPrune } from "./processors/retention.js";
import { runDemoReset } from "./processors/demo-reset.js";
import { runDemoCleanup } from "./processors/demo-cleanup.js";
import { startTelemetry, stopTelemetry } from "./telemetry.js";

const SIMULATOR_PORT = Number(process.env.SIMULATOR_PORT ?? 4001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Both schedules are fully rebuilt on every boot. Matching the old entry by id was not
 * reliable — changing an interval left the previous scheduler running alongside the new one
 * (a 60s and a 15s health tick both firing, so every minute ticked twice). Clearing the queue's
 * repeatables first makes "the config at boot" the only thing that decides what runs.
 */
async function clearRepeatables(queue: {
  getRepeatableJobs: () => Promise<{ key: string }[]>;
  removeRepeatableByKey: (key: string) => Promise<boolean>;
}) {
  for (const rep of await queue.getRepeatableJobs()) {
    await queue.removeRepeatableByKey(rep.key);
  }
}

async function registerRepeatables() {
  const pollConnectors = (
    await prisma.connector.findMany({
      where: { kind: "poll_sync" },
      include: { org: { select: { demoSession: { select: { status: true } } } } },
    })
  ).filter((connector) => connector.org.demoSession?.status !== "ACTIVE");
  await clearRepeatables(syncQueue);

  for (const connector of pollConnectors) {
    const repeatKey = `sync-start-${connector.orgId}-${connector.key}`;

    if (connector.paused || !connector.syncIntervalSec) {
      log.info(
        { connectorId: connector.id },
        `${connector.key}: repeatable sync skipped (paused or no interval)`,
      );
      continue;
    }

    await syncQueue.add(
      "sync.start",
      { connectorId: connector.id, orgId: connector.orgId, trigger: "schedule", ...injectTrace() },
      { repeat: { every: connector.syncIntervalSec * 1000 }, jobId: repeatKey },
    );
    log.info(
      { connectorId: connector.id },
      `${connector.key}: registered repeatable sync every ${connector.syncIntervalSec}s`,
    );
  }

  const tickSec = getHealthConfig().tickIntervalSec;
  await clearRepeatables(healthTickQueue);
  await healthTickQueue.add(
    "health.tick",
    { ...injectTrace() },
    { repeat: { every: tickSec * 1000 }, jobId: "health-tick" },
  );
  log.info(`health engine: tick registered every ${tickSec}s`);

  await clearRepeatables(retentionQueue);
  await retentionQueue.add(
    "retention.prune",
    { ...injectTrace() },
    { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: "retention-prune" },
  );

  await clearRepeatables(demoCleanupQueue);
  await demoCleanupQueue.add(
    "demo.cleanup",
    { ...injectTrace() },
    { repeat: { every: 5 * 60 * 1000 }, jobId: "demo-cleanup" },
  );
}

async function main() {
  log.info(`${APP_NAME} worker booted`);

  const healthRedis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
  });
  const pong = await healthRedis.ping();
  log.info({ pong }, "redis connection ok");

  await prisma.$queryRaw`SELECT 1`;
  log.info("postgres connection ok");

  let workerReady = false;
  const app = new Hono();
  app.get("/livez", (c) => c.json({ ok: true, service: "worker" }));
  app.get("/healthz", (c) => c.json({ ok: true, service: "worker" }));
  app.get("/readyz", async (c) => {
    let db = false;
    let redis = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    try {
      await healthRedis.ping();
      redis = true;
    } catch {
      redis = false;
    }
    const ready = workerReady && db && redis;
    return c.json({ ok: ready, ready, db, redis }, ready ? 200 : 503);
  });
  app.route("/", ehrApp);
  app.route("/", clearinghouseApp);
  app.route("/", eligibilityApp);
  app.route("/", labsApp);

  const server = serve({ fetch: app.fetch, port: SIMULATOR_PORT }, (info) => {
    log.info({ port: info.port }, "simulator http server listening");
  });

  const syncWorker = createTrackedWorker(QUEUE_NAMES.sync, processSyncJob, { concurrency: 2 });
  const claimsWorker = createTrackedWorker(QUEUE_NAMES.claimsSubmit, processClaimJob, {
    concurrency: 3,
  });
  const eligibilityWorker = createTrackedWorker(QUEUE_NAMES.eligibility, processEligibilityJob, {
    concurrency: 3,
    backoffStrategy: eligibilityBackoffStrategy,
  });
  const webhookWorker = createTrackedWorker(QUEUE_NAMES.webhookProcessing, processWebhookJob, {
    concurrency: 5,
  });
  const incidentSummaryWorker = createTrackedWorker(
    QUEUE_NAMES.incidentSummary,
    processIncidentSummaryJob,
    {
      concurrency: 1,
      backoffStrategy: incidentSummaryBackoffStrategy,
    },
  );
  const healthTickWorker = createTrackedWorker(QUEUE_NAMES.healthTick, () => runHealthTick(), {
    concurrency: 1,
  });
  const retentionWorker = createTrackedWorker(QUEUE_NAMES.retention, () => runRetentionPrune(), {
    concurrency: 1,
  });
  const demoResetWorker = createTrackedWorker(QUEUE_NAMES.demoReset, runDemoReset, {
    concurrency: 1,
  });
  const demoCleanupWorker = createTrackedWorker(QUEUE_NAMES.demoCleanup, runDemoCleanup, {
    concurrency: 1,
  });
  log.info(
    "queue workers started: sync, claims-submit, eligibility, webhook-processing, incident-summary, health-tick, demo-cleanup",
  );

  await registerRepeatables();
  workerReady = true;
  log.info(`${APP_NAME} worker ready`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    workerReady = false;
    log.info({ signal }, "shutting down worker");

    // Release :4001 first and *wait* for it. Closing it last (or not awaiting it) meant a
    // `tsx watch` reload raced its own replacement to the port and died on EADDRINUSE while
    // the queue drain finished.
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await Promise.all([
      syncWorker.close(),
      claimsWorker.close(),
      eligibilityWorker.close(),
      webhookWorker.close(),
      incidentSummaryWorker.close(),
      healthTickWorker.close(),
      retentionWorker.close(),
      demoResetWorker.close(),
      demoCleanupWorker.close(),
    ]);
    await Promise.all([
      syncQueue.close(),
      webhookProcessingQueue.close(),
      claimsSubmitQueue.close(),
      eligibilityQueue.close(),
      incidentSummaryQueue.close(),
      healthTickQueue.close(),
      retentionQueue.close(),
      demoResetQueue.close(),
      demoCleanupQueue.close(),
    ]);
    await flushLogs();
    await stopTelemetry();
    await healthRedis.quit().catch(() => healthRedis.disconnect());
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

startTelemetry();
main().catch((err) => {
  log.error({ err }, "worker failed to boot");
  process.exit(1);
});

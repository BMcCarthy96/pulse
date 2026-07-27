import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { APP_NAME, QUEUE_NAMES, getHealthConfig } from "@pulse/shared";
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
  createTrackedWorker,
  eligibilityBackoffStrategy,
} from "./queues.js";
import { processSyncJob } from "./processors/sync.js";
import { processClaimJob } from "./processors/claim.js";
import { processEligibilityJob } from "./processors/eligibility.js";
import { processWebhookJob } from "./processors/webhook.js";
import { processIncidentSummaryJob } from "./processors/incident-summary.js";
import { runHealthTick } from "./health/engine.js";

const SIMULATOR_PORT = Number(process.env.SIMULATOR_PORT ?? 4001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Both schedules are fully rebuilt on every boot. Matching the old entry by id was not
 * reliable — changing an interval left the previous scheduler running alongside the new one
 * (a 60s and a 15s health tick both firing, so every minute ticked twice). Clearing the queue's
 * repeatables first makes "the config at boot" the only thing that decides what runs.
 */
async function clearRepeatables(queue: { getRepeatableJobs: () => Promise<{ key: string }[]>; removeRepeatableByKey: (key: string) => Promise<boolean> }) {
  for (const rep of await queue.getRepeatableJobs()) {
    await queue.removeRepeatableByKey(rep.key);
  }
}

async function registerRepeatables() {
  const pollConnectors = await prisma.connector.findMany({ where: { kind: "poll_sync" } });
  await clearRepeatables(syncQueue);

  for (const connector of pollConnectors) {
    const repeatKey = `sync-start-${connector.key}`;

    if (connector.paused || !connector.syncIntervalSec) {
      log.info({ connectorId: connector.id }, `${connector.key}: repeatable sync skipped (paused or no interval)`);
      continue;
    }

    await syncQueue.add(
      "sync.start",
      { connectorId: connector.id, orgId: connector.orgId, trigger: "schedule" },
      { repeat: { every: connector.syncIntervalSec * 1000 }, jobId: repeatKey },
    );
    log.info({ connectorId: connector.id }, `${connector.key}: registered repeatable sync every ${connector.syncIntervalSec}s`);
  }

  const tickSec = getHealthConfig().tickIntervalSec;
  await clearRepeatables(healthTickQueue);
  await healthTickQueue.add("health.tick", {}, { repeat: { every: tickSec * 1000 }, jobId: "health-tick" });
  log.info(`health engine: tick registered every ${tickSec}s`);
}

async function main() {
  log.info(`${APP_NAME} worker booted`);

  const healthRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
  const pong = await healthRedis.ping();
  log.info({ pong }, "redis connection ok");
  await healthRedis.quit();

  await prisma.$queryRaw`SELECT 1`;
  log.info("postgres connection ok");

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", ehrApp);
  app.route("/", clearinghouseApp);
  app.route("/", eligibilityApp);
  app.route("/", labsApp);

  const server = serve({ fetch: app.fetch, port: SIMULATOR_PORT }, (info) => {
    log.info({ port: info.port }, "simulator http server listening");
  });

  const syncWorker = createTrackedWorker(QUEUE_NAMES.sync, processSyncJob, { concurrency: 2 });
  const claimsWorker = createTrackedWorker(QUEUE_NAMES.claimsSubmit, processClaimJob, { concurrency: 3 });
  const eligibilityWorker = createTrackedWorker(QUEUE_NAMES.eligibility, processEligibilityJob, {
    concurrency: 3,
    backoffStrategy: eligibilityBackoffStrategy,
  });
  const webhookWorker = createTrackedWorker(QUEUE_NAMES.webhookProcessing, processWebhookJob, { concurrency: 5 });
  const incidentSummaryWorker = createTrackedWorker(QUEUE_NAMES.incidentSummary, processIncidentSummaryJob, {
    concurrency: 1,
  });
  const healthTickWorker = createTrackedWorker(QUEUE_NAMES.healthTick, () => runHealthTick(), { concurrency: 1 });
  log.info("queue workers started: sync, claims-submit, eligibility, webhook-processing, incident-summary, health-tick");

  await registerRepeatables();
  log.info(`${APP_NAME} worker ready`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
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
    ]);
    await Promise.all([
      syncQueue.close(),
      webhookProcessingQueue.close(),
      claimsSubmitQueue.close(),
      eligibilityQueue.close(),
      incidentSummaryQueue.close(),
      healthTickQueue.close(),
    ]);
    await flushLogs();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error({ err }, "worker failed to boot");
  process.exit(1);
});

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { APP_NAME, QUEUE_NAMES } from "@pulse/shared";
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
  createTrackedWorker,
  eligibilityBackoffStrategy,
} from "./queues.js";
import { processSyncJob } from "./processors/sync.js";
import { processClaimJob } from "./processors/claim.js";
import { processEligibilityJob } from "./processors/eligibility.js";
import { processWebhookJob } from "./processors/webhook.js";

const SIMULATOR_PORT = Number(process.env.SIMULATOR_PORT ?? 4001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function registerRepeatables() {
  const pollConnectors = await prisma.connector.findMany({ where: { kind: "poll_sync" } });
  const existingRepeatables = await syncQueue.getRepeatableJobs();

  for (const connector of pollConnectors) {
    const repeatKey = `sync-start-${connector.key}`;
    for (const rep of existingRepeatables) {
      if (rep.id === repeatKey) await syncQueue.removeRepeatableByKey(rep.key);
    }

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
  log.info("queue workers started: sync, claims-submit, eligibility, webhook-processing");

  await registerRepeatables();
  log.info(`${APP_NAME} worker ready`);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down worker");
    server.close();
    await Promise.all([syncWorker.close(), claimsWorker.close(), eligibilityWorker.close(), webhookWorker.close()]);
    await Promise.all([
      syncQueue.close(),
      webhookProcessingQueue.close(),
      claimsSubmitQueue.close(),
      eligibilityQueue.close(),
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

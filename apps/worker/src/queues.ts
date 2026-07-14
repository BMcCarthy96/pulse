import { Queue, Worker, type Job as BullJob } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import {
  QUEUE_NAMES,
  getRedisConnectionOptions,
  createTrackedJob as sharedCreateTrackedJob,
  retryTrackedJob as sharedRetryTrackedJob,
  type TrackedJobParams,
} from "@pulse/shared";
import { log } from "./log.js";
import { RetryAfterError } from "./processors/eligibility.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const connectionOptions = getRedisConnectionOptions(REDIS_URL);

export const syncQueue = new Queue(QUEUE_NAMES.sync, { connection: connectionOptions });
export const webhookProcessingQueue = new Queue(QUEUE_NAMES.webhookProcessing, { connection: connectionOptions });
export const claimsSubmitQueue = new Queue(QUEUE_NAMES.claimsSubmit, { connection: connectionOptions });
export const eligibilityQueue = new Queue(QUEUE_NAMES.eligibility, { connection: connectionOptions });

const queueByName: Record<string, Queue> = {
  [QUEUE_NAMES.sync]: syncQueue,
  [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
  [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
  [QUEUE_NAMES.eligibility]: eligibilityQueue,
};

export function createTrackedJob(params: TrackedJobParams) {
  return sharedCreateTrackedJob(prisma, params);
}

export function retryTrackedJob(dbJobId: string) {
  return sharedRetryTrackedJob(prisma, queueByName, dbJobId);
}

async function markWebhookEventFailed(dbJob: { queue: string; payload: Prisma.JsonValue }, error: string) {
  if (dbJob.queue !== QUEUE_NAMES.webhookProcessing) return;
  const eventId = (dbJob.payload as { eventId?: string } | null)?.eventId;
  if (!eventId) return;
  await prisma.integrationEvent
    .update({ where: { id: eventId }, data: { status: "FAILED", error, processedAt: new Date() } })
    .catch(() => {});
}

async function markSyncRunOutcome(syncRunId: string, opts: { failed: boolean; error: string }) {
  const run = await prisma.syncRun.findUnique({ where: { id: syncRunId } });
  if (!run || run.status !== "RUNNING") return;
  const status = opts.failed ? (run.recordsFetched > 0 ? "PARTIAL" : "FAILED") : "SUCCEEDED";
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: { status, finishedAt: new Date(), error: opts.failed ? opts.error : null },
  });
}

async function handleActive(job: BullJob) {
  const dbJobId = job.data.dbJobId as string | undefined;
  if (!dbJobId) return;
  await prisma.job
    .update({
      where: { id: dbJobId },
      data: { status: "ACTIVE", startedAt: new Date(), attempts: job.attemptsMade + 1 },
    })
    .catch(() => {});
}

async function handleCompleted(job: BullJob) {
  const dbJobId = job.data.dbJobId as string | undefined;
  if (!dbJobId) return;
  await prisma.job
    .update({
      where: { id: dbJobId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), attempts: job.attemptsMade },
    })
    .catch(() => {});
}

async function handleFailed(job: BullJob | undefined, err: Error) {
  if (!job) return;
  const dbJobId = job.data.dbJobId as string | undefined;
  if (!dbJobId) return;

  const dbJob = await prisma.job.findUnique({ where: { id: dbJobId } });
  if (!dbJob) return;

  const attemptsMade = job.attemptsMade;
  const isDead = attemptsMade >= (job.opts.attempts ?? 1);
  const priorHistory = Array.isArray(dbJob.errorHistory) ? (dbJob.errorHistory as Record<string, unknown>[]) : [];
  const errorHistory = [
    ...priorHistory,
    {
      attempt: attemptsMade,
      at: new Date().toISOString(),
      message: err.message,
      durationMs: job.processedOn ? Date.now() - job.processedOn : undefined,
    },
  ];

  await prisma.job.update({
    where: { id: dbJobId },
    data: {
      status: isDead ? "DEAD" : "FAILED",
      attempts: attemptsMade,
      lastError: err.message,
      errorHistory: errorHistory as Prisma.InputJsonValue,
      finishedAt: isDead ? new Date() : null,
    },
  });

  log.error(
    { connectorId: dbJob.connectorId, jobId: dbJobId, syncRunId: dbJob.syncRunId ?? undefined },
    `job ${isDead ? "exhausted retries (DEAD)" : "attempt failed, will retry"}: ${err.message}`,
  );

  if (isDead && dbJob.syncRunId) {
    await markSyncRunOutcome(dbJob.syncRunId, { failed: true, error: err.message });
  }
  if (isDead) {
    await markWebhookEventFailed(dbJob, err.message);
  }
}

function attachJobLifecycle(worker: Worker) {
  worker.on("active", (job) => void handleActive(job));
  worker.on("completed", (job) => void handleCompleted(job));
  worker.on("failed", (job, err) => void handleFailed(job, err));
  worker.on("error", (err) => log.error({ err }, "worker runtime error"));
}

export function createTrackedWorker(
  queueName: string,
  processor: (job: BullJob) => Promise<unknown>,
  opts: { concurrency: number; backoffStrategy?: (attemptsMade: number, type?: string, err?: Error) => number },
): Worker {
  const worker = new Worker(queueName, processor, {
    connection: connectionOptions,
    concurrency: opts.concurrency,
    settings: opts.backoffStrategy ? { backoffStrategy: opts.backoffStrategy } : undefined,
  });
  attachJobLifecycle(worker);
  return worker;
}

export const eligibilityBackoffStrategy = (attemptsMade: number, _type?: string, err?: Error): number => {
  if (err instanceof RetryAfterError) return err.retryAfterMs;
  return Math.min(2000 * 2 ** (attemptsMade - 1), 32000);
};

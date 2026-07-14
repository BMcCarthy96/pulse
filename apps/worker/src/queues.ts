import { Queue, Worker, type Job as BullJob, type JobsOptions } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import { QUEUE_NAMES, DEFAULT_JOB_OPTS } from "@pulse/shared";
import { log } from "./log.js";
import { RetryAfterError } from "./processors/eligibility.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisUrl = new URL(REDIS_URL);

// Plain connection options (not a shared ioredis instance) — each Queue/Worker creates its
// own client internally, matching BullMQ's bundled ioredis version and avoiding cross-version
// type friction with a directly-constructed ioredis.Redis instance.
export const connectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
};

export const syncQueue = new Queue(QUEUE_NAMES.sync, { connection: connectionOptions });
export const webhookProcessingQueue = new Queue(QUEUE_NAMES.webhookProcessing, { connection: connectionOptions });
export const claimsSubmitQueue = new Queue(QUEUE_NAMES.claimsSubmit, { connection: connectionOptions });
export const eligibilityQueue = new Queue(QUEUE_NAMES.eligibility, { connection: connectionOptions });

interface TrackedJobParams {
  queue: Queue;
  queueName: string;
  type: string;
  connectorId: string;
  orgId: string;
  payload: Record<string, unknown>;
  syncRunId?: string;
  opts?: JobsOptions;
}

/**
 * Creates the DB Job row first (durable, queryable history), then enqueues the BullMQ job
 * with `{dbJobId}` merged into its data so lifecycle events can find the mirrored row.
 */
export async function createTrackedJob(params: TrackedJobParams) {
  const dbJob = await prisma.job.create({
    data: {
      orgId: params.orgId,
      connectorId: params.connectorId,
      syncRunId: params.syncRunId,
      queue: params.queueName,
      type: params.type,
      status: "QUEUED",
      maxAttempts: (params.opts ?? DEFAULT_JOB_OPTS).attempts ?? 5,
      payload: params.payload as Prisma.InputJsonValue,
    },
  });

  const bullJob = await params.queue.add(
    params.type,
    { ...params.payload, dbJobId: dbJob.id },
    params.opts ?? DEFAULT_JOB_OPTS,
  );

  await prisma.job.update({ where: { id: dbJob.id }, data: { bullJobId: String(bullJob.id) } });
  return { dbJobId: dbJob.id, bullJobId: bullJob.id };
}

/** Manual retry: reset the DB Job row to QUEUED (keeping errorHistory) and enqueue a fresh BullMQ job with the same payload. */
export async function retryTrackedJob(dbJobId: string) {
  const dbJob = await prisma.job.findUniqueOrThrow({ where: { id: dbJobId } });
  const queueByName: Record<string, Queue> = {
    [QUEUE_NAMES.sync]: syncQueue,
    [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
    [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
    [QUEUE_NAMES.eligibility]: eligibilityQueue,
  };
  const queue = queueByName[dbJob.queue];
  if (!queue) throw new Error(`unknown queue for retry: ${dbJob.queue}`);

  const bullJob = await queue.add(dbJob.type, { ...(dbJob.payload as object), dbJobId: dbJob.id }, DEFAULT_JOB_OPTS);

  await prisma.job.update({
    where: { id: dbJobId },
    data: { status: "QUEUED", bullJobId: String(bullJob.id), lastError: null },
  });
  return { dbJobId, bullJobId: bullJob.id };
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

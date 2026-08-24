import { Queue, UnrecoverableError, Worker, type Job as BullJob } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import {
  QUEUE_NAMES,
  INCIDENT_SUMMARY_JOB_OPTS,
  INCIDENT_SUMMARY_PROMPT_VERSION,
  exponentialBackoffMs,
  getRedisConnectionOptions,
  DEFAULT_JOB_OPTS,
  createTrackedJob as sharedCreateTrackedJob,
  retryTrackedJob as sharedRetryTrackedJob,
  extractTrace,
  injectTrace,
  withSpan,
  currentTraceId,
  type TrackedJobParams,
} from "@pulse/shared";
import { log } from "./log.js";
import { AiRetryableError, RetryAfterError } from "./queue-errors.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const connectionOptions = getRedisConnectionOptions(REDIS_URL);

export const syncQueue = new Queue(QUEUE_NAMES.sync, { connection: connectionOptions });
export const webhookProcessingQueue = new Queue(QUEUE_NAMES.webhookProcessing, {
  connection: connectionOptions,
});
export const claimsSubmitQueue = new Queue(QUEUE_NAMES.claimsSubmit, {
  connection: connectionOptions,
});
export const eligibilityQueue = new Queue(QUEUE_NAMES.eligibility, {
  connection: connectionOptions,
});
export const incidentSummaryQueue = new Queue(QUEUE_NAMES.incidentSummary, {
  connection: connectionOptions,
});
export const healthTickQueue = new Queue(QUEUE_NAMES.healthTick, { connection: connectionOptions });
export const retentionQueue = new Queue(QUEUE_NAMES.retention, { connection: connectionOptions });
export const demoResetQueue = new Queue(QUEUE_NAMES.demoReset, { connection: connectionOptions });
export const demoCleanupQueue = new Queue(QUEUE_NAMES.demoCleanup, {
  connection: connectionOptions,
});

/**
 * Not a tracked job: incident summaries are internal work, not a connector call, so they stay
 * out of the failed-job queue the ops team triages.
 */
export async function enqueueIncidentSummary(
  incidentId: string,
  opts: { reason?: "opened" | "resolution" } = {},
) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { orgId: true },
  });
  if (!incident) throw new Error(`incident "${incidentId}" not found`);

  const run = await prisma.aiRun.create({
    data: {
      orgId: incident.orgId,
      incidentId,
      kind: "SUMMARY",
      status: "QUEUED",
      model:
        process.env.ANTHROPIC_SUMMARY_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
      promptVersion: INCIDENT_SUMMARY_PROMPT_VERSION,
      traceId: currentTraceId(),
    },
  });

  try {
    const job = await incidentSummaryQueue.add(
      "incident.summary",
      { incidentId, runId: run.id, reason: opts.reason ?? "opened", ...injectTrace() },
      INCIDENT_SUMMARY_JOB_OPTS,
    );
    return { runId: run.id, bullJobId: job.id };
  } catch (error) {
    await prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: "QUEUE_ENQUEUE_FAILED",
        errorMessage: "summary queue unavailable",
        completedAt: new Date(),
      },
    });
    await prisma.incident
      .update({
        where: { id: incidentId },
        data: {
          aiSummaryStatus: "failed",
          aiSummary: {
            error: "summary queue unavailable",
            errorCode: "QUEUE_ENQUEUE_FAILED",
            failedAt: new Date().toISOString(),
            aiRunId: run.id,
          },
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

const queueByName: Record<string, Queue> = {
  [QUEUE_NAMES.sync]: syncQueue,
  [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
  [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
  [QUEUE_NAMES.eligibility]: eligibilityQueue,
};

/**
 * Reconcile durable queued jobs after a worker or producer restart.
 *
 * The database row is written before the Redis dispatch so a process crash cannot lose the
 * work forever. On the next worker boot, look up the deterministic BullMQ id and recreate only
 * the missing queue entry. BullMQ's job id uniqueness makes this safe if two workers race.
 */
export async function reconcileQueuedJobs() {
  const pending = await prisma.job.findMany({
    where: {
      status: "QUEUED",
      bullJobId: { not: null },
      queue: { in: Object.keys(queueByName) },
    },
    orderBy: { updatedAt: "desc" },
    // Bound each pass so a large outage cannot monopolize the worker event loop. The periodic
    // reconciler will continue with the remaining rows after earlier jobs leave QUEUED.
    take: 500,
    select: { id: true, queue: true, type: true, payload: true, bullJobId: true },
  });

  let restored = 0;
  for (const dbJob of pending) {
    const queue = queueByName[dbJob.queue];
    const bullJobId = dbJob.bullJobId;
    if (!queue || !bullJobId) continue;

    try {
      if (await queue.getJob(bullJobId)) continue;

      const payload =
        dbJob.payload && typeof dbJob.payload === "object" && !Array.isArray(dbJob.payload)
          ? (dbJob.payload as Record<string, unknown>)
          : {};
      await queue.add(
        dbJob.type,
        { ...payload, dbJobId: dbJob.id, ...injectTrace() },
        { ...DEFAULT_JOB_OPTS, jobId: bullJobId },
      );
      restored += 1;
      log.warn({ dbJobId: dbJob.id, queue: dbJob.queue, bullJobId }, "reconciled queued job");
    } catch (err) {
      log.error({ err, dbJobId: dbJob.id, queue: dbJob.queue }, "queued job reconciliation failed");
    }
  }

  return { inspected: pending.length, restored };
}

export function createTrackedJob(params: TrackedJobParams) {
  return sharedCreateTrackedJob(prisma, params);
}

export function retryTrackedJob(dbJobId: string) {
  return sharedRetryTrackedJob(prisma, queueByName, dbJobId);
}

async function markWebhookEventFailed(
  dbJob: { queue: string; payload: Prisma.JsonValue },
  error: string,
) {
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
  await prisma.job.updateMany({
    where: { id: dbJobId },
    data: { status: "ACTIVE", startedAt: new Date(), attempts: job.attemptsMade + 1 },
  });
}

async function handleCompleted(job: BullJob) {
  const dbJobId = job.data.dbJobId as string | undefined;
  if (!dbJobId) return;
  await prisma.job.updateMany({
    where: { id: dbJobId },
    data: { status: "SUCCEEDED", finishedAt: new Date(), attempts: job.attemptsMade },
  });
}

async function handleFailed(job: BullJob | undefined, err: Error) {
  if (!job) return;
  const dbJobId = job.data.dbJobId as string | undefined;
  if (!dbJobId) return;

  const dbJob = await prisma.job.findUnique({ where: { id: dbJobId } });
  if (!dbJob) return;

  const attemptsMade = job.attemptsMade;
  const isDead = err instanceof UnrecoverableError || attemptsMade >= (job.opts.attempts ?? 1);
  const priorHistory = Array.isArray(dbJob.errorHistory)
    ? (dbJob.errorHistory as Record<string, unknown>[])
    : [];
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
  worker.on(
    "active",
    (job) =>
      void handleActive(job).catch((err) =>
        log.error({ err, jobId: job.id }, "job active mirror failed"),
      ),
  );
  worker.on(
    "completed",
    (job) =>
      void handleCompleted(job).catch((err) =>
        log.error({ err, jobId: job.id }, "job completion mirror failed"),
      ),
  );
  worker.on(
    "failed",
    (job, err) =>
      void handleFailed(job, err).catch((mirrorError) =>
        log.error({ err: mirrorError, jobId: job?.id }, "job failure mirror failed"),
      ),
  );
  worker.on("error", (err) => log.error({ err }, "worker runtime error"));
}

export function createTrackedWorker(
  queueName: string,
  processor: (job: BullJob) => Promise<unknown>,
  opts: {
    concurrency: number;
    backoffStrategy?: (attemptsMade: number, type?: string, err?: Error) => number;
  },
): Worker {
  const tracedProcessor = (job: BullJob) =>
    withSpan(
      `queue:${queueName}`,
      { "messaging.system": "bullmq", "messaging.destination": queueName },
      () => processor(job),
      extractTrace({
        traceparent: typeof job.data?.traceparent === "string" ? job.data.traceparent : undefined,
        tracestate: typeof job.data?.tracestate === "string" ? job.data.tracestate : undefined,
      }),
    );
  const worker = new Worker(queueName, tracedProcessor, {
    connection: connectionOptions,
    concurrency: opts.concurrency,
    settings: opts.backoffStrategy ? { backoffStrategy: opts.backoffStrategy } : undefined,
  });
  attachJobLifecycle(worker);
  return worker;
}

/**
 * A 429 tells us exactly how long to wait; exponential backoff would be guessing over the top of
 * an authoritative answer. Everything else falls back to the standard schedule.
 */
export const eligibilityBackoffStrategy = (
  attemptsMade: number,
  _type?: string,
  err?: Error,
): number => {
  if (err instanceof RetryAfterError) return err.retryAfterMs;
  return exponentialBackoffMs(attemptsMade);
};

export const incidentSummaryBackoffStrategy = (
  attemptsMade: number,
  _type?: string,
  err?: Error,
): number => {
  if (err instanceof RetryAfterError) return err.retryAfterMs;
  if (err instanceof AiRetryableError && err.retryAfterMs !== undefined) return err.retryAfterMs;
  return exponentialBackoffMs(attemptsMade);
};

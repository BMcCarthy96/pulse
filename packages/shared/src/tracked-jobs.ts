import type { PrismaClient, Prisma } from "@prisma/client";
import type { Queue, JobsOptions } from "bullmq";
import { DEFAULT_JOB_OPTS } from "./queue-config.js";
import { injectTrace } from "./telemetry.js";
import { ApiError } from "./api-errors.js";

export interface TrackedJobParams {
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
 * Shared between apps/web (webhook route producer) and apps/worker (all processors) so both
 * sides of the pipeline mirror jobs identically.
 */
export async function createTrackedJob(prisma: PrismaClient, params: TrackedJobParams) {
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

  let bullJob;
  try {
    bullJob = await params.queue.add(
      params.type,
      { ...params.payload, dbJobId: dbJob.id, ...injectTrace() },
      { ...(params.opts ?? DEFAULT_JOB_OPTS), jobId: dbJob.id },
    );
  } catch (error) {
    // Keep the durable row visible for reconciliation instead of leaving an apparently queued
    // job that was never accepted by Redis.
    await prisma.job
      .update({
        where: { id: dbJob.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message.slice(0, 500) : "queue dispatch failed",
        },
      })
      .catch(() => undefined);
    throw error;
  }

  await prisma.job.update({ where: { id: dbJob.id }, data: { bullJobId: String(bullJob.id) } });
  return { dbJobId: dbJob.id, bullJobId: bullJob.id };
}

/**
 * Manual retry: reset the DB Job row to QUEUED (keeping errorHistory) and enqueue a fresh
 * BullMQ job with the same payload. `queueByName` maps DB `Job.queue` values to live Queue
 * instances for the calling process.
 */
export async function retryTrackedJob(
  prisma: PrismaClient,
  queueByName: Record<string, Queue>,
  dbJobId: string,
) {
  const dbJob = await prisma.job.findUniqueOrThrow({ where: { id: dbJobId } });
  const queue = queueByName[dbJob.queue];
  if (!queue) throw new Error(`unknown queue for retry: ${dbJob.queue}`);

  const claimed = await prisma.job.updateMany({
    where: { id: dbJobId, status: { in: ["FAILED", "DEAD"] } },
    data: { status: "QUEUED", bullJobId: null, lastError: null },
  });
  if (claimed.count !== 1) {
    throw ApiError.conflict("job is already queued or no longer retryable");
  }

  let bullJob;
  try {
    bullJob = await queue.add(
      dbJob.type,
      { ...(dbJob.payload as object), dbJobId: dbJob.id, ...injectTrace() },
      // BullMQ reserves ':' as an internal key separator and rejects it in custom job IDs.
      { ...DEFAULT_JOB_OPTS, jobId: `retry-${dbJob.id}-${Date.now().toString(36)}` },
    );
  } catch (error) {
    await prisma.job
      .update({
        where: { id: dbJobId },
        data: {
          status: dbJob.status,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "queue dispatch failed",
        },
      })
      .catch(() => undefined);
    throw error;
  }

  await prisma.job.update({
    where: { id: dbJobId },
    data: { bullJobId: String(bullJob.id) },
  });
  return { dbJobId, bullJobId: bullJob.id };
}

import type { PrismaClient, Prisma } from "@prisma/client";
import type { Queue, JobsOptions } from "bullmq";
import { DEFAULT_JOB_OPTS } from "./queue-config.js";

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

  const bullJob = await params.queue.add(
    params.type,
    { ...params.payload, dbJobId: dbJob.id },
    params.opts ?? DEFAULT_JOB_OPTS,
  );

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

  const bullJob = await queue.add(
    dbJob.type,
    { ...(dbJob.payload as object), dbJobId: dbJob.id },
    DEFAULT_JOB_OPTS,
  );

  await prisma.job.update({
    where: { id: dbJobId },
    data: { status: "QUEUED", bullJobId: String(bullJob.id), lastError: null },
  });
  return { dbJobId, bullJobId: bullJob.id };
}

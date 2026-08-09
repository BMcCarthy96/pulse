import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionOptions } from "@pulse/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const connectionOptions = getRedisConnectionOptions(REDIS_URL);

// Web only ever produces jobs — BullMQ Workers run exclusively in apps/worker.
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

export const queueByName: Record<string, Queue> = {
  [QUEUE_NAMES.sync]: syncQueue,
  [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
  [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
  [QUEUE_NAMES.eligibility]: eligibilityQueue,
};

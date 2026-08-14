import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionOptions } from "@pulse/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const connectionOptions = getRedisConnectionOptions(REDIS_URL);

/**
 * Web only produces jobs; workers live in apps/worker. Next evaluates route modules while
 * collecting build metadata, so constructing queues at module load makes a production build
 * depend on Redis. This proxy creates and connects each producer on its first real operation.
 */
function lazyQueue(name: string) {
  let queue: Queue | undefined;
  return new Proxy({} as Queue, {
    get(_target, property) {
      queue ??= new Queue(name, { connection: connectionOptions });
      const value = Reflect.get(queue, property, queue) as unknown;
      return typeof value === "function" ? value.bind(queue) : value;
    },
  });
}

export const syncQueue = lazyQueue(QUEUE_NAMES.sync);
export const webhookProcessingQueue = lazyQueue(QUEUE_NAMES.webhookProcessing);
export const claimsSubmitQueue = lazyQueue(QUEUE_NAMES.claimsSubmit);
export const eligibilityQueue = lazyQueue(QUEUE_NAMES.eligibility);
export const incidentSummaryQueue = lazyQueue(QUEUE_NAMES.incidentSummary);
export const demoResetQueue = lazyQueue(QUEUE_NAMES.demoReset);

export const queueByName: Record<string, Queue> = {
  [QUEUE_NAMES.sync]: syncQueue,
  [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
  [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
  [QUEUE_NAMES.eligibility]: eligibilityQueue,
};

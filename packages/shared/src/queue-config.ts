export const QUEUE_NAMES = {
  sync: "sync",
  webhookProcessing: "webhook-processing",
  claimsSubmit: "claims-submit",
  eligibility: "eligibility",
  incidentSummary: "incident-summary",
  healthTick: "health-tick",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2_000 }, // 2s, 4s, 8s, 16s, 32s
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

// backoff type "custom" so the worker's backoffStrategy can honor a 429 Retry-After header
// instead of falling back to exponential delay.
export const ELIGIBILITY_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "custom" as const },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

export const INCIDENT_SUMMARY_JOB_OPTS = {
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

export const SIMULATOR_HTTP_TIMEOUT_MS = 10_000;

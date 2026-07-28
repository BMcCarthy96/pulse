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

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 32_000;

/** Default wait when a 429 arrives with no usable `Retry-After`. */
export const RETRY_AFTER_FALLBACK_MS = 15_000;

/** Upper bound on an upstream-supplied `Retry-After`, so a hostile or buggy header cannot park
 *  a job for hours. 5 minutes is well past any real payer throttle window. */
export const RETRY_AFTER_MAX_MS = 300_000;

/**
 * `2s, 4s, 8s, 16s, 32s` — attempt 1 waits `baseMs`. Kept as a function (rather than only as
 * BullMQ's `backoff: { type: "exponential" }` config) so the schedule the docs promise is
 * testable without a queue.
 */
export function exponentialBackoffMs(attemptsMade: number, baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS): number {
  const exponent = Math.max(0, attemptsMade - 1);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

/**
 * Parses an HTTP `Retry-After` header into milliseconds (RFC 7231 §7.1.3: either delta-seconds
 * or an HTTP-date).
 *
 * Everything unusable — absent, non-numeric, negative, NaN — collapses to the fallback rather
 * than propagating. `Number("soon")` is `NaN`, and a `NaN` delay silently disables the backoff
 * in BullMQ, which is a far worse failure than waiting 15 seconds.
 */
export function parseRetryAfterMs(header: string | null | undefined, now: Date = new Date()): number {
  if (header == null) return RETRY_AFTER_FALLBACK_MS;

  const trimmed = header.trim();
  if (trimmed === "") return RETRY_AFTER_FALLBACK_MS;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) return RETRY_AFTER_FALLBACK_MS;
    return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
  }

  // Matched strictly against RFC 7231's IMF-fixdate rather than handed to `Date.parse`, whose
  // lenient fallback parser accepts nonsense — `Date.parse("Someday, 32 Jul")` returns a valid
  // far-future timestamp, which would have been clamped to the ceiling and read as a genuine
  // five-minute throttle instead of a malformed header.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
    return RETRY_AFTER_FALLBACK_MS;
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return RETRY_AFTER_FALLBACK_MS;
  const deltaMs = date - now.getTime();
  if (deltaMs <= 0) return RETRY_AFTER_FALLBACK_MS;
  return Math.min(deltaMs, RETRY_AFTER_MAX_MS);
}

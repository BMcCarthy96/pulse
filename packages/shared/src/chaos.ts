export const CHAOS_DEFAULTS = {
  degradedFailureRate: 0.4,
  degradedLatencyMinMs: 2000,
  degradedLatencyMaxMs: 8000,
  healthyLatencyMinMs: 50,
  healthyLatencyMaxMs: 300,
  timeoutSleepMs: 30_000,
  rateLimitRetryAfterSec: 15,
} as const;

export interface ChaosConfig {
  failureRate?: number;
  latencyMs?: number;
}

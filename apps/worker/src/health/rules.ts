import { HEALTH_RULES, type ConnectorStatusValue } from "@pulse/shared";

export interface HealthWindow {
  totalCalls: number;
  failedCalls: number;
  consecutiveFailures: number;
  p95LatencyMs: number | null;
}

/** A job or event reduced to what the window cares about. Input order does not matter. */
export interface HealthCall {
  at: Date;
  failed: boolean;
  durationMs: number | null;
}

/**
 * Explicitly `number`, not `Pick<typeof HEALTH_RULES, ...>`. `HEALTH_RULES` is declared `as
 * const`, so picking from it yields literal types (`5`, `0.5`, `4`…) and the `rules` parameter
 * below would only accept the exact default values — an injection seam that cannot inject
 * anything. Widening restores the point of the parameter.
 */
export interface StatusRules {
  downConsecutiveFailures: number;
  downErrorRate: number;
  downMinCalls: number;
  degradedErrorRate: number;
  degradedP95Ms: number;
}

/**
 * doc 03 §4, implemented exactly:
 *   DOWN     if consecutiveFailures >= 5, or errorRate >= 0.5 with totalCalls >= 4
 *   DEGRADED if errorRate >= 0.1, or p95LatencyMs >= 5000
 *   HEALTHY  otherwise
 *   PAUSED   short-circuits
 *   no activity in window -> carry the previous status forward. A silent connector is not
 *   "healthy"; the UI surfaces "no recent activity" separately.
 *
 * Pure: no I/O, no clock. Everything it needs arrives in the arguments.
 */
export function computeStatus(
  window: HealthWindow,
  opts: { paused?: boolean; previousStatus?: ConnectorStatusValue } = {},
  rules: StatusRules = HEALTH_RULES,
): ConnectorStatusValue {
  if (opts.paused) return "PAUSED";
  if (window.totalCalls === 0) return opts.previousStatus ?? "HEALTHY";

  const errorRate = window.failedCalls / window.totalCalls;

  if (window.consecutiveFailures >= rules.downConsecutiveFailures) return "DOWN";
  if (errorRate >= rules.downErrorRate && window.totalCalls >= rules.downMinCalls) return "DOWN";
  if (errorRate >= rules.degradedErrorRate) return "DEGRADED";
  if (window.p95LatencyMs !== null && window.p95LatencyMs >= rules.degradedP95Ms) return "DEGRADED";
  return "HEALTHY";
}

/**
 * Derives the window from raw calls. `consecutiveFailures` counts back from the most recent
 * call, so a single success resets the streak. p95 is nearest-rank over the calls that
 * reported a duration; calls without one (still running, never started) are excluded rather
 * than counted as zero.
 */
export function buildWindow(
  calls: HealthCall[],
  now: Date,
  windowMinutes: number = HEALTH_RULES.windowMinutes,
): HealthWindow {
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const inWindow = calls
    .filter((c) => c.at > cutoff && c.at <= now)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let consecutiveFailures = 0;
  for (let i = inWindow.length - 1; i >= 0; i--) {
    if (!inWindow[i].failed) break;
    consecutiveFailures++;
  }

  const durations = inWindow
    .map((c) => c.durationMs)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b);

  const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);

  return {
    totalCalls: inWindow.length,
    failedCalls: inWindow.filter((c) => c.failed).length,
    consecutiveFailures,
    p95LatencyMs: durations.length === 0 ? null : durations[Math.max(0, p95Index)],
  };
}

export function errorRateOf(window: Pick<HealthWindow, "totalCalls" | "failedCalls">): number {
  return window.totalCalls === 0 ? 0 : window.failedCalls / window.totalCalls;
}

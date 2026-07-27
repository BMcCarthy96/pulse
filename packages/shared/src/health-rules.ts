export const HEALTH_RULES = {
  windowMinutes: 15,
  downConsecutiveFailures: 5,
  downErrorRate: 0.5,
  downMinCalls: 4,
  degradedErrorRate: 0.1,
  degradedP95Ms: 5000,
  degradedSustainedMinutes: 10,
  monitoringStabilityMinutes: 10,
  tickIntervalSec: 60,
} as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The same rules with the two knobs the e2e suite shrinks (phase 9) resolved from env.
 * Read this — not HEALTH_RULES — anywhere timing matters, so a test run can compress a
 * 10-minute stability window into seconds without touching the rules themselves.
 */
export function getHealthConfig() {
  const stabilityMinutes = envInt("INCIDENT_STABILITY_MIN", HEALTH_RULES.monitoringStabilityMinutes);
  return {
    ...HEALTH_RULES,
    tickIntervalSec: envInt("HEALTH_TICK_SEC", HEALTH_RULES.tickIntervalSec),
    // doc 05's e2e flow allows a "shortened window config": recovery is only visible once the
    // failures roll out of the window, so a 15-minute window makes the resolve leg of the demo
    // take 15 real minutes. Production stays at 15.
    windowMinutes: envInt("HEALTH_WINDOW_MIN", HEALTH_RULES.windowMinutes),
    // Both windows are "how long must this hold before I act"; one knob keeps them in step.
    degradedSustainedMinutes: stabilityMinutes,
    monitoringStabilityMinutes: stabilityMinutes,
  };
}

export type ConnectorStatusValue = "HEALTHY" | "DEGRADED" | "DOWN" | "PAUSED";
export type HealthConfig = ReturnType<typeof getHealthConfig>;

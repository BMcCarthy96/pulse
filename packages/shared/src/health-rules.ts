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

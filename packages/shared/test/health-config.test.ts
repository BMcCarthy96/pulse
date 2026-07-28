import { afterEach, describe, expect, it } from "vitest";
import { getHealthConfig, HEALTH_RULES } from "../src/health-rules.js";

const KEYS = ["INCIDENT_STABILITY_MIN", "HEALTH_TICK_SEC", "HEALTH_WINDOW_MIN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return getHealthConfig();
}

describe("getHealthConfig — defaults", () => {
  it("falls back to the production rules when nothing is set", () => {
    const cfg = withEnv({});
    expect(cfg.windowMinutes).toBe(15);
    expect(cfg.tickIntervalSec).toBe(60);
    expect(cfg.monitoringStabilityMinutes).toBe(10);
  });

  it("never mutates the underlying rule thresholds", () => {
    withEnv({ INCIDENT_STABILITY_MIN: "0", HEALTH_WINDOW_MIN: "2" });
    expect(HEALTH_RULES.windowMinutes).toBe(15);
    expect(HEALTH_RULES.monitoringStabilityMinutes).toBe(10);
    // Only the timing knobs are configurable — the detection thresholds are not.
    const cfg = getHealthConfig();
    expect(cfg.downConsecutiveFailures).toBe(5);
    expect(cfg.downErrorRate).toBe(0.5);
    expect(cfg.degradedErrorRate).toBe(0.1);
  });
});

describe("getHealthConfig — INCIDENT_STABILITY_MIN=0", () => {
  it("is honoured rather than treated as unset", () => {
    // The bug this pins: `n > 0 ? n : fallback` silently replaced an explicit 0 with the
    // 10-minute production default, so the e2e configuration documented in .env.example and
    // phase 9 could never actually resolve an incident.
    const cfg = withEnv({ INCIDENT_STABILITY_MIN: "0" });
    expect(cfg.monitoringStabilityMinutes).toBe(0);
    expect(cfg.degradedSustainedMinutes).toBe(0);
  });

  it("keeps the two stability windows in step", () => {
    const cfg = withEnv({ INCIDENT_STABILITY_MIN: "3" });
    expect(cfg.monitoringStabilityMinutes).toBe(3);
    expect(cfg.degradedSustainedMinutes).toBe(3);
  });
});

describe("getHealthConfig — bad input falls back", () => {
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["non-numeric", "ten"],
    ["negative", "-5"],
  ])("%s INCIDENT_STABILITY_MIN → default", (_label, value) => {
    expect(withEnv({ INCIDENT_STABILITY_MIN: value }).monitoringStabilityMinutes).toBe(10);
  });

  it("rejects zero for the tick interval, which would mean a busy loop", () => {
    expect(withEnv({ HEALTH_TICK_SEC: "0" }).tickIntervalSec).toBe(60);
  });

  it("rejects a zero-length health window, which would make every window empty", () => {
    expect(withEnv({ HEALTH_WINDOW_MIN: "0" }).windowMinutes).toBe(15);
  });

  it("accepts the shrunk values the e2e suite uses", () => {
    const cfg = withEnv({ HEALTH_TICK_SEC: "5", HEALTH_WINDOW_MIN: "2", INCIDENT_STABILITY_MIN: "0" });
    expect(cfg).toMatchObject({ tickIntervalSec: 5, windowMinutes: 2, monitoringStabilityMinutes: 0 });
  });
});

import { describe, expect, it } from "vitest";
import {
  buildWindow,
  computeStatus,
  errorRateOf,
  type HealthWindow,
} from "../../src/health/rules.js";

const base: HealthWindow = {
  totalCalls: 100,
  failedCalls: 0,
  consecutiveFailures: 0,
  p95LatencyMs: 100,
};
const w = (over: Partial<HealthWindow>): HealthWindow => ({ ...base, ...over });

describe("computeStatus — doc 03 §4", () => {
  describe("PAUSED short-circuits everything", () => {
    it.each([
      [
        "a catastrophic window",
        w({ failedCalls: 100, consecutiveFailures: 99, p95LatencyMs: 30_000 }),
      ],
      ["a healthy window", w({})],
      ["an empty window", w({ totalCalls: 0, p95LatencyMs: null })],
    ])("%s", (_label, window) => {
      expect(computeStatus(window, { paused: true, previousStatus: "DOWN" })).toBe("PAUSED");
    });
  });

  describe("empty window carries the previous status forward", () => {
    const empty = w({ totalCalls: 0, failedCalls: 0, consecutiveFailures: 0, p95LatencyMs: null });

    it.each(["HEALTHY", "DEGRADED", "DOWN", "PAUSED"] as const)(
      "previous %s is preserved",
      (previousStatus) => {
        expect(computeStatus(empty, { previousStatus })).toBe(previousStatus);
      },
    );

    it("defaults to HEALTHY when there is no previous status", () => {
      expect(computeStatus(empty)).toBe("HEALTHY");
    });

    it("does not treat silence as recovery", () => {
      // The whole point of carry-forward: a connector that stops responding entirely must not
      // look like it healed.
      expect(computeStatus(empty, { previousStatus: "DOWN" })).not.toBe("HEALTHY");
    });
  });

  describe("DOWN on consecutive failures (>= 5)", () => {
    it.each([
      [4, "HEALTHY"],
      [5, "DOWN"],
      [6, "DOWN"],
    ])("%i consecutive failures → %s", (consecutiveFailures, expected) => {
      // failedCalls kept low so the error-rate rules cannot be what fires.
      expect(
        computeStatus(
          w({ totalCalls: 1000, failedCalls: consecutiveFailures, consecutiveFailures }),
        ),
      ).toBe(expected);
    });
  });

  describe("DOWN on error rate (>= 0.5 with >= 4 calls)", () => {
    it.each([
      [4, 2, "DOWN", "exactly 0.5 at exactly the min-calls floor"],
      [4, 3, "DOWN", "above 0.5"],
      [3, 2, "DEGRADED", "0.66 but below the min-calls floor → falls through to DEGRADED"],
      [100, 49, "DEGRADED", "0.49 is under the DOWN bar"],
      [100, 50, "DOWN", "exactly 0.5"],
    ])("%i calls / %i failed → %s (%s)", (totalCalls, failedCalls, expected) => {
      expect(computeStatus(w({ totalCalls, failedCalls, consecutiveFailures: 1 }))).toBe(expected);
    });
  });

  describe("DEGRADED on error rate (>= 0.1)", () => {
    it.each([
      [100, 9, "HEALTHY"],
      [100, 10, "DEGRADED"],
      [100, 12, "DEGRADED"],
    ])("%i calls / %i failed → %s", (totalCalls, failedCalls, expected) => {
      expect(computeStatus(w({ totalCalls, failedCalls, consecutiveFailures: 1 }))).toBe(expected);
    });
  });

  describe("DEGRADED on latency (p95 >= 5000ms)", () => {
    it.each([
      [4999, "HEALTHY"],
      [5000, "DEGRADED"],
      [12_000, "DEGRADED"],
    ])("p95 %ims → %s", (p95LatencyMs, expected) => {
      expect(computeStatus(w({ p95LatencyMs }))).toBe(expected);
    });

    it("a null p95 never triggers DEGRADED", () => {
      expect(computeStatus(w({ p95LatencyMs: null }))).toBe("HEALTHY");
    });
  });

  describe("rule precedence", () => {
    it("consecutive failures beat a healthy error rate", () => {
      expect(computeStatus(w({ totalCalls: 1000, failedCalls: 5, consecutiveFailures: 5 }))).toBe(
        "DOWN",
      );
    });

    it("DOWN beats DEGRADED when both would apply", () => {
      expect(
        computeStatus(
          w({ totalCalls: 10, failedCalls: 8, consecutiveFailures: 1, p95LatencyMs: 9000 }),
        ),
      ).toBe("DOWN");
    });

    it("accepts overridden thresholds", () => {
      const window = w({ totalCalls: 10, failedCalls: 1, consecutiveFailures: 2 });
      expect(computeStatus(window, {}, { ...RULES_OVERRIDE, downConsecutiveFailures: 2 })).toBe(
        "DOWN",
      );
    });
  });
});

const RULES_OVERRIDE = {
  downConsecutiveFailures: 5,
  downErrorRate: 0.5,
  downMinCalls: 4,
  degradedErrorRate: 0.1,
  degradedP95Ms: 5000,
};

describe("buildWindow", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

  it("keeps only calls inside the window", () => {
    const window = buildWindow(
      [
        { at: at(16), failed: true, durationMs: 10 },
        { at: at(15.5), failed: true, durationMs: 10 },
        { at: at(14), failed: false, durationMs: 10 },
        { at: at(1), failed: false, durationMs: 10 },
      ],
      now,
    );
    expect(window.totalCalls).toBe(2);
    expect(window.failedCalls).toBe(0);
  });

  it("excludes calls in the future", () => {
    const window = buildWindow(
      [{ at: new Date(now.getTime() + 1000), failed: true, durationMs: 5 }],
      now,
    );
    expect(window.totalCalls).toBe(0);
  });

  it("respects a custom window length", () => {
    const calls = [
      { at: at(10), failed: false, durationMs: 5 },
      { at: at(1), failed: false, durationMs: 5 },
    ];
    expect(buildWindow(calls, now, 15).totalCalls).toBe(2);
    expect(buildWindow(calls, now, 5).totalCalls).toBe(1);
  });

  it("counts the failure streak back from the newest call", () => {
    const window = buildWindow(
      [
        { at: at(5), failed: true, durationMs: null },
        { at: at(4), failed: false, durationMs: null },
        { at: at(3), failed: true, durationMs: null },
        { at: at(2), failed: true, durationMs: null },
      ],
      now,
    );
    expect(window.consecutiveFailures).toBe(2);
  });

  it("resets the streak on a trailing success", () => {
    const window = buildWindow(
      [
        { at: at(5), failed: true, durationMs: null },
        { at: at(4), failed: true, durationMs: null },
        { at: at(1), failed: false, durationMs: null },
      ],
      now,
    );
    expect(window.consecutiveFailures).toBe(0);
  });

  it("counts every call as a failure when all failed", () => {
    const window = buildWindow(
      Array.from({ length: 5 }, (_, i) => ({ at: at(5 - i), failed: true, durationMs: null })),
      now,
    );
    expect(window.consecutiveFailures).toBe(5);
    expect(window.failedCalls).toBe(5);
  });

  it("sorts unordered input before computing the streak", () => {
    const window = buildWindow(
      [
        { at: at(1), failed: true, durationMs: null },
        { at: at(9), failed: false, durationMs: null },
        { at: at(5), failed: true, durationMs: null },
      ],
      now,
    );
    expect(window.consecutiveFailures).toBe(2);
  });

  it("computes p95 by nearest rank and ignores calls with no duration", () => {
    const durations = [100, 200, 300, 8000];
    const window = buildWindow(
      [
        ...durations.map((durationMs, i) => ({ at: at(10 - i), failed: false, durationMs })),
        { at: at(2), failed: false, durationMs: null },
      ],
      now,
    );
    expect(window.totalCalls).toBe(5);
    expect(window.p95LatencyMs).toBe(8000);
  });

  it("returns a null p95 when nothing reported a duration", () => {
    const window = buildWindow([{ at: at(1), failed: false, durationMs: null }], now);
    expect(window.p95LatencyMs).toBeNull();
  });

  it("ignores negative durations", () => {
    const window = buildWindow([{ at: at(1), failed: false, durationMs: -5 }], now);
    expect(window.p95LatencyMs).toBeNull();
  });

  it("handles a single-call window", () => {
    const window = buildWindow([{ at: at(1), failed: false, durationMs: 42 }], now);
    expect(window.p95LatencyMs).toBe(42);
  });

  it("returns an empty window for no calls", () => {
    expect(buildWindow([], now)).toEqual({
      totalCalls: 0,
      failedCalls: 0,
      consecutiveFailures: 0,
      p95LatencyMs: null,
    });
  });
});

describe("errorRateOf", () => {
  it("is 0 for an empty window rather than NaN", () => {
    expect(errorRateOf({ totalCalls: 0, failedCalls: 0 })).toBe(0);
  });

  it("divides failures by total", () => {
    expect(errorRateOf({ totalCalls: 8, failedCalls: 2 })).toBe(0.25);
  });
});

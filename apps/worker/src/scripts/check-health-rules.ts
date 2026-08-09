/**
 * Spot-checks for the doc 03 §4 rules (phase 7 acceptance). Phase 9 replaces this with a real
 * vitest suite; until then this is runnable proof the pure core behaves as specified.
 *   pnpm --filter @pulse/worker exec tsx src/scripts/check-health-rules.ts
 */
import { buildWindow, computeStatus } from "../health/rules.js";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name} — got ${String(actual)}, expected ${String(expected)}`,
  );
}

// doc 03 §4: DOWN if consecutiveFailures >= 5
check(
  "5 consecutive failures → DOWN",
  computeStatus({ totalCalls: 40, failedCalls: 5, consecutiveFailures: 5, p95LatencyMs: 200 }),
  "DOWN",
);
check(
  "4 consecutive failures (low error rate) → HEALTHY",
  computeStatus({ totalCalls: 100, failedCalls: 4, consecutiveFailures: 4, p95LatencyMs: 200 }),
  "HEALTHY",
);

// doc 03 §4: DOWN if errorRate >= 0.5 with totalCalls >= 4
check(
  "errorRate 0.5 with 4 calls → DOWN",
  computeStatus({ totalCalls: 4, failedCalls: 2, consecutiveFailures: 1, p95LatencyMs: 100 }),
  "DOWN",
);
check(
  "errorRate 0.5 with only 2 calls → DEGRADED (below the min-calls floor)",
  computeStatus({ totalCalls: 2, failedCalls: 1, consecutiveFailures: 1, p95LatencyMs: 100 }),
  "DEGRADED",
);

// doc 03 §4: DEGRADED if errorRate >= 0.1
check(
  "errorRate 0.12 → DEGRADED",
  computeStatus({ totalCalls: 100, failedCalls: 12, consecutiveFailures: 1, p95LatencyMs: 100 }),
  "DEGRADED",
);
check(
  "errorRate 0.09 → HEALTHY",
  computeStatus({ totalCalls: 100, failedCalls: 9, consecutiveFailures: 1, p95LatencyMs: 100 }),
  "HEALTHY",
);

// doc 03 §4: DEGRADED if p95LatencyMs >= 5000
check(
  "p95 5000ms → DEGRADED",
  computeStatus({ totalCalls: 50, failedCalls: 0, consecutiveFailures: 0, p95LatencyMs: 5000 }),
  "DEGRADED",
);

// doc 03 §4: PAUSED short-circuits; empty window carries the previous status
check(
  "paused short-circuits a failing window",
  computeStatus(
    { totalCalls: 10, failedCalls: 10, consecutiveFailures: 10, p95LatencyMs: 9000 },
    { paused: true },
  ),
  "PAUSED",
);
check(
  "empty window carries previous DOWN",
  computeStatus(
    { totalCalls: 0, failedCalls: 0, consecutiveFailures: 0, p95LatencyMs: null },
    { previousStatus: "DOWN" },
  ),
  "DOWN",
);
check(
  "empty window with no history → HEALTHY",
  computeStatus({ totalCalls: 0, failedCalls: 0, consecutiveFailures: 0, p95LatencyMs: null }),
  "HEALTHY",
);

// buildWindow: streak counts back from the newest call and a success resets it
const now = new Date("2026-07-27T12:00:00Z");
const at = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000);
const window = buildWindow(
  [
    { at: at(20), failed: true, durationMs: 100 }, // outside the 15m window
    { at: at(10), failed: false, durationMs: 100 },
    { at: at(5), failed: true, durationMs: 300 },
    { at: at(4), failed: true, durationMs: 8000 },
  ],
  now,
);
check("buildWindow drops calls outside the window", window.totalCalls, 3);
check("buildWindow counts failures in-window", window.failedCalls, 2);
check("buildWindow streak counts back from newest", window.consecutiveFailures, 2);
check("buildWindow p95 is nearest-rank", window.p95LatencyMs, 8000);

const reset = buildWindow(
  [
    { at: at(6), failed: true, durationMs: null },
    { at: at(5), failed: true, durationMs: null },
    { at: at(1), failed: false, durationMs: null },
  ],
  now,
);
check("a success resets the streak", reset.consecutiveFailures, 0);
check("p95 is null when no call reported a duration", reset.p95LatencyMs, null);

console.log(
  failures === 0 ? "\nAll health-rule spot-checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);

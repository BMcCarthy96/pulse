import { describe, expect, it } from "vitest";
import {
  BACKOFF_MAX_MS,
  DEFAULT_JOB_OPTS,
  ELIGIBILITY_JOB_OPTS,
  RETRY_AFTER_FALLBACK_MS,
  RETRY_AFTER_MAX_MS,
  exponentialBackoffMs,
  parseRetryAfterMs,
} from "../src/queue-config.js";

describe("exponentialBackoffMs", () => {
  it("produces the 2s/4s/8s/16s/32s schedule the docs promise", () => {
    expect([1, 2, 3, 4, 5].map((n) => exponentialBackoffMs(n))).toEqual([
      2000, 4000, 8000, 16_000, 32_000,
    ]);
  });

  it("caps at the ceiling instead of growing without bound", () => {
    expect(exponentialBackoffMs(6)).toBe(BACKOFF_MAX_MS);
    expect(exponentialBackoffMs(50)).toBe(BACKOFF_MAX_MS);
  });

  it("treats attempt 0 like attempt 1 rather than halving the base", () => {
    expect(exponentialBackoffMs(0)).toBe(2000);
  });

  it("honours custom base and ceiling", () => {
    expect(exponentialBackoffMs(3, 500, 100_000)).toBe(2000);
    expect(exponentialBackoffMs(3, 500, 1000)).toBe(1000);
  });

  it("never exceeds the retry budget in total wait", () => {
    // 5 attempts at the documented schedule = 62s of backoff. If someone raises `attempts`
    // without thinking about the ceiling, this is the line that should make them look.
    const total = Array.from({ length: DEFAULT_JOB_OPTS.attempts }, (_, i) =>
      exponentialBackoffMs(i + 1),
    ).reduce((a, b) => a + b, 0);
    expect(total).toBe(62_000);
  });
});

describe("parseRetryAfterMs — delta-seconds", () => {
  it("honours the upstream's number", () => {
    expect(parseRetryAfterMs("15")).toBe(15_000);
    expect(parseRetryAfterMs("1")).toBe(1000);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRetryAfterMs("  20  ")).toBe(20_000);
  });

  it("accepts a fractional value", () => {
    expect(parseRetryAfterMs("2.5")).toBe(2500);
  });

  it("clamps an absurd value to the ceiling", () => {
    // A buggy or hostile upstream must not be able to park a job for hours.
    expect(parseRetryAfterMs("86400")).toBe(RETRY_AFTER_MAX_MS);
  });

  it("reads an all-digit header as seconds, never as a year", () => {
    // "2026" is a legal delta-seconds value and is indistinguishable from a year. RFC 7231
    // resolves the ambiguity in favour of seconds, so it must not reach the date branch.
    expect(parseRetryAfterMs("2026")).toBe(RETRY_AFTER_MAX_MS);
    expect(parseRetryAfterMs("60")).toBe(60_000);
  });
});

describe("parseRetryAfterMs — unusable headers fall back", () => {
  it.each([
    ["absent", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["non-numeric", "soon"],
    ["zero", "0"],
    ["negative", "-30"],
  ])("%s → fallback", (_label, header) => {
    expect(parseRetryAfterMs(header)).toBe(RETRY_AFTER_FALLBACK_MS);
  });

  it("never returns NaN", () => {
    // The bug this guards: `Number("soon") * 1000` is NaN, and a NaN delay makes BullMQ retry
    // immediately — turning a rate-limit response into a tight retry loop against the upstream.
    for (const header of ["soon", "", "NaN", "1e", null]) {
      expect(Number.isFinite(parseRetryAfterMs(header))).toBe(true);
    }
  });
});

describe("parseRetryAfterMs — HTTP-date form", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("computes the delta from an absolute date", () => {
    expect(parseRetryAfterMs("Mon, 27 Jul 2026 12:00:30 GMT", now)).toBe(30_000);
  });

  it("falls back for a date already in the past", () => {
    expect(parseRetryAfterMs("Mon, 27 Jul 2026 11:59:00 GMT", now)).toBe(RETRY_AFTER_FALLBACK_MS);
  });

  it("clamps a far-future date", () => {
    expect(parseRetryAfterMs("Tue, 28 Jul 2026 12:00:00 GMT", now)).toBe(RETRY_AFTER_MAX_MS);
  });

  it.each([
    ["outright nonsense", "Someday, 32 Jul"],
    ["an ISO timestamp (not the RFC form)", "2026-07-27T12:00:30Z"],
    ["a plausible-looking but malformed date", "Mon 27 Jul 2026 12:00:30 GMT"],
  ])("falls back for %s", (_label, header) => {
    // V8's lenient date parser accepts several of these and returns a real timestamp. Anything
    // that is not an RFC 7231 IMF-fixdate has to reach the fallback, not the clamp.
    expect(parseRetryAfterMs(header, now)).toBe(RETRY_AFTER_FALLBACK_MS);
  });
});

describe("job option contracts", () => {
  it("keeps eligibility on custom backoff so Retry-After can be honoured", () => {
    // If this flips back to "exponential", the 429 handling silently stops taking effect.
    expect(ELIGIBILITY_JOB_OPTS.backoff.type).toBe("custom");
    expect(ELIGIBILITY_JOB_OPTS.attempts).toBe(3);
  });

  it("keeps failed jobs so the ops queue is not silently drained", () => {
    expect(DEFAULT_JOB_OPTS.removeOnFail).toBe(false);
    expect(ELIGIBILITY_JOB_OPTS.removeOnFail).toBe(false);
  });
});

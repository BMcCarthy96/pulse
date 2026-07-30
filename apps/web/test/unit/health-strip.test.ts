import { describe, expect, it } from "vitest";
import { bucketed, HEALTH_STRIP_MAX_SEGMENTS } from "@/lib/health-strip-buckets";

const snap = (statuses: string[]) => statuses.map((status) => ({ status }));

describe("HealthStrip bucketing", () => {
  it("passes short inputs through untouched", () => {
    const input = ["HEALTHY", "DEGRADED", "DOWN"];
    expect(bucketed(snap(input), HEALTH_STRIP_MAX_SEGMENTS)).toEqual(input);
  });

  it("passes through at exactly the segment cap", () => {
    const input = Array<string>(HEALTH_STRIP_MAX_SEGMENTS).fill("HEALTHY");
    expect(bucketed(snap(input), HEALTH_STRIP_MAX_SEGMENTS)).toHaveLength(HEALTH_STRIP_MAX_SEGMENTS);
  });

  /**
   * The regression this file exists for. Snapshot count scales with `HEALTH_TICK_SEC`: 1,440 a
   * day at the documented 60s tick, 5,756 at the 15s tick used for local demos. Rendering one
   * segment each made the strip's min-content width grow by 1px per segment (`gap-px`), which
   * stretched every ancestor and pushed the connector page to ~6,000px wide — a horizontal
   * scrollbar across the dashboard, with the chaos panel's radios 3,161px off-screen.
   */
  it("caps output length no matter how many snapshots arrive", () => {
    for (const n of [500, 1_440, 5_756, 20_000]) {
      const out = bucketed(snap(Array<string>(n).fill("HEALTHY")), HEALTH_STRIP_MAX_SEGMENTS);
      expect(out).toHaveLength(HEALTH_STRIP_MAX_SEGMENTS);
    }
  });

  it("lets a single DOWN win its bucket instead of averaging away", () => {
    // 960 snapshots into 96 buckets = 10 per bucket. One DOWN in the first bucket only.
    const input = Array<string>(960).fill("HEALTHY");
    input[3] = "DOWN";
    const out = bucketed(snap(input), HEALTH_STRIP_MAX_SEGMENTS);

    expect(out[0]).toBe("DOWN");
    expect(out.slice(1).every((s) => s === "HEALTHY")).toBe(true);
  });

  it("ranks DOWN over DEGRADED over PAUSED over HEALTHY within a bucket", () => {
    const input = ["HEALTHY", "PAUSED", "DEGRADED", "DOWN"];
    expect(bucketed(snap(input), 1)).toEqual(["DOWN"]);
    expect(bucketed(snap(["HEALTHY", "PAUSED", "DEGRADED"]), 1)).toEqual(["DEGRADED"]);
    expect(bucketed(snap(["HEALTHY", "PAUSED"]), 1)).toEqual(["PAUSED"]);
    expect(bucketed(snap(["HEALTHY", "HEALTHY"]), 1)).toEqual(["HEALTHY"]);
  });

  it("keeps an unrecognised status rather than dropping the bucket", () => {
    // Unknown ranks below HEALTHY, so a known status wins — but an all-unknown bucket still
    // renders something (the component falls back to a neutral colour) instead of undefined.
    expect(bucketed(snap(["WEIRD", "HEALTHY"]), 1)).toEqual(["HEALTHY"]);
    expect(bucketed(snap(["WEIRD", "WEIRD"]), 1)).toEqual(["WEIRD"]);
  });

  it("covers every snapshot — no tail is dropped when the length does not divide evenly", () => {
    // 97 into 96: the uneven split must not lose the last snapshot.
    const input = Array<string>(97).fill("HEALTHY");
    input[96] = "DOWN";
    expect(bucketed(snap(input), 96)).toContain("DOWN");

    // And a DOWN at the very start survives too.
    const head = Array<string>(1_001).fill("HEALTHY");
    head[0] = "DOWN";
    expect(bucketed(snap(head), 96)[0]).toBe("DOWN");
  });
});

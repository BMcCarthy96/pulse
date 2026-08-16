import { describe, expect, it } from "vitest";
import {
  WALKTHROUGH_STEPS,
  calculateWalkthroughPosition,
  createWalkthroughState,
  reduceWalkthroughState,
  walkthroughScrollBehavior,
} from "@/lib/guided-walkthrough";

describe("guided walkthrough state", () => {
  it("starts the first step for the current demo session", () => {
    expect(createWalkthroughState("demo-a")).toEqual({
      version: 3,
      demoSessionId: "demo-a",
      stepIndex: 0,
      status: "active",
    });
  });

  it("ignores duplicate and out-of-order completion events", () => {
    const initial = createWalkthroughState("demo-a");
    const outOfOrder = reduceWalkthroughState(initial, {
      type: "complete-step",
      step: "run-investigation",
    });
    expect(outOfOrder).toBe(initial);

    const advanced = reduceWalkthroughState(initial, {
      type: "complete-step",
      step: "open-incident",
    });
    const duplicate = reduceWalkthroughState(advanced, {
      type: "complete-step",
      step: "open-incident",
    });
    expect(advanced.stepIndex).toBe(1);
    expect(duplicate).toBe(advanced);
  });

  it("keeps completed work when the walkthrough is paused", () => {
    const paused = reduceWalkthroughState(createWalkthroughState("demo-a"), { type: "pause" });
    const advanced = reduceWalkthroughState(paused, {
      type: "complete-step",
      step: "open-incident",
    });
    expect(advanced).toMatchObject({ stepIndex: 1, status: "paused" });
    expect(reduceWalkthroughState(advanced, { type: "resume" }).status).toBe("active");
  });

  it("finishes only from the audit step", () => {
    const initial = createWalkthroughState("demo-a");
    expect(reduceWalkthroughState(initial, { type: "finish" })).toBe(initial);

    const audit = { ...initial, stepIndex: WALKTHROUGH_STEPS.length - 1 };
    expect(reduceWalkthroughState(audit, { type: "finish" }).status).toBe("complete");
  });

  it("uses immediate scrolling when reduced motion is requested", () => {
    expect(walkthroughScrollBehavior(true)).toBe("auto");
    expect(walkthroughScrollBehavior(false)).toBe("smooth");
  });
});

describe("guided walkthrough placement", () => {
  const target = { top: 200, right: 340, bottom: 240, left: 240, width: 100, height: 40 };

  it("uses the requested side when there is room", () => {
    expect(
      calculateWalkthroughPosition({
        target,
        callout: { width: 300, height: 180 },
        viewport: { width: 1200, height: 800 },
        preferred: "right",
      }),
    ).toMatchObject({ placement: "right", left: 358 });
  });

  it("keeps desktop and phone callouts inside the viewport", () => {
    const desktop = calculateWalkthroughPosition({
      target: { top: 4, right: 1196, bottom: 44, left: 1096, width: 100, height: 40 },
      callout: { width: 340, height: 220 },
      viewport: { width: 1200, height: 800 },
      preferred: "top",
    });
    expect(desktop.left).toBeGreaterThanOrEqual(16);
    expect(desktop.left + 340).toBeLessThanOrEqual(1184);
    expect(desktop.top).toBeGreaterThanOrEqual(16);

    expect(
      calculateWalkthroughPosition({
        target,
        callout: { width: 358, height: 220 },
        viewport: { width: 390, height: 844 },
        preferred: "left",
      }),
    ).toEqual({ left: 16, top: 608, placement: "bottom" });
  });
});

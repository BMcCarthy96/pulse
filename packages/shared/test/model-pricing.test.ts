import { describe, expect, it } from "vitest";
import { MODEL_PRICING_VERSION, costOf, pricingFor } from "../src/model-pricing.js";

describe("model pricing", () => {
  it("has a versioned pricing table", () => {
    expect(MODEL_PRICING_VERSION).toMatch(/^anthropic-\d{4}-\d{2}$/);
    expect(pricingFor("claude-opus-4-8")).toEqual({
      inputPerMillionUsd: 5,
      outputPerMillionUsd: 25,
      cacheWritePerMillionUsd: 6.25,
      cacheReadPerMillionUsd: 0.5,
    });
  });

  it("prices standard and cache token categories", () => {
    expect(
      costOf(
        {
          inputTokens: 1_000_000,
          outputTokens: 2_000_000,
          cacheCreationInputTokens: 100_000,
          cacheReadInputTokens: 100_000,
        },
        "claude-opus-4-8",
      ),
    ).toBe(55.675);
  });

  it("treats omitted cache usage as zero", () => {
    expect(costOf({ inputTokens: 1000, outputTokens: 500 }, "claude-haiku-4-5")).toBe(0.0035);
  });

  it("rounds to six decimal places", () => {
    expect(costOf({ inputTokens: 1, outputTokens: 1 }, "claude-haiku-4-5")).toBe(0.000006);
  });

  it("returns null for unknown models", () => {
    expect(pricingFor("not-a-real-model")).toBeNull();
    expect(costOf({ inputTokens: 1, outputTokens: 1 }, "not-a-real-model")).toBeNull();
  });
});

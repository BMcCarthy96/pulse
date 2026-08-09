import { describe, expect, it, vi } from "vitest";
import {
  summarizePreparedContext,
  AiSchemaError,
  RedactionLeakError,
  AiUnpricedModelError,
} from "../../src/ai/summarize.js";

const valid = {
  summary: "The connector is returning 503 responses.",
  probableCause: "An upstream outage is likely.",
  impact: "Sync work is delayed.",
  suggestedSteps: ["Check upstream status"],
  confidence: "medium" as const,
};

describe("summarizePreparedContext", () => {
  it("uses the injected provider and records usage and pricing", async () => {
    const provider = vi.fn().mockResolvedValue({
      parsedOutput: valid,
      usage: {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
      },
      requestId: "req_test",
    });
    const result = await summarizePreparedContext(
      { markdown: "redacted context", truncated: false },
      { model: "claude-haiku-4-5", provider },
    );
    expect(provider).toHaveBeenCalledOnce();
    expect(result.summary).toEqual(valid);
    expect(result.requestId).toBe("req_test");
    expect(result.costUsd).toBeCloseTo(0.003515, 8);
    expect(result.pricingVersion).toBe("anthropic-2026-08");
  });

  it("refuses a context that still contains a protected identifier before calling the provider", async () => {
    const provider = vi.fn();
    await expect(
      summarizePreparedContext({ markdown: "failed for PAT-42", truncated: false }, { provider }),
    ).rejects.toBeInstanceOf(RedactionLeakError);
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects a provider response that has no structured output", async () => {
    await expect(
      summarizePreparedContext(
        { markdown: "redacted context", truncated: false },
        {
          provider: vi
            .fn()
            .mockResolvedValue({ parsedOutput: null, usage: { inputTokens: 1, outputTokens: 1 } }),
        },
      ),
    ).rejects.toBeInstanceOf(AiSchemaError);
  });

  it("refuses unknown model pricing in production before dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const provider = vi.fn();
    await expect(
      summarizePreparedContext(
        { markdown: "redacted context", truncated: false },
        { model: "claude-unknown-eval", provider },
      ),
    ).rejects.toBeInstanceOf(AiUnpricedModelError);
    expect(provider).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

export const MODEL_PRICING_VERSION = "anthropic-2026-08";

export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheWritePerMillionUsd: number;
  cacheReadPerMillionUsd: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// Prices are USD per million tokens. Keep this table versioned: costUsd is stored on AiCall so
// historical records remain stable when the provider changes its public price sheet.
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-opus-4-8": {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    cacheWritePerMillionUsd: 6.25,
    cacheReadPerMillionUsd: 0.5,
  },
  "claude-opus-4-7": {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    cacheWritePerMillionUsd: 6.25,
    cacheReadPerMillionUsd: 0.5,
  },
  "claude-opus-4-6": {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    cacheWritePerMillionUsd: 6.25,
    cacheReadPerMillionUsd: 0.5,
  },
  "claude-sonnet-4-6": {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    cacheWritePerMillionUsd: 3.75,
    cacheReadPerMillionUsd: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
    cacheWritePerMillionUsd: 1.25,
    cacheReadPerMillionUsd: 0.1,
  },
};

export function pricingFor(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

function tokenCost(tokens: number, perMillionUsd: number) {
  return (tokens / 1_000_000) * perMillionUsd;
}

/** Returns a six-decimal USD estimate, or null when the model is not in the reviewed table. */
export function costOf(usage: TokenUsage, model: string): number | null {
  const pricing = pricingFor(model);
  if (!pricing) return null;

  const total =
    tokenCost(usage.inputTokens, pricing.inputPerMillionUsd) +
    tokenCost(usage.outputTokens, pricing.outputPerMillionUsd) +
    tokenCost(usage.cacheCreationInputTokens ?? 0, pricing.cacheWritePerMillionUsd) +
    tokenCost(usage.cacheReadInputTokens ?? 0, pricing.cacheReadPerMillionUsd);

  return Math.round(total * 1_000_000) / 1_000_000;
}

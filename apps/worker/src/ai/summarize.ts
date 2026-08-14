import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  IncidentSummaryAiSchema,
  INCIDENT_SUMMARY_PROMPT_V2,
  INCIDENT_SUMMARY_PROMPT_VERSION,
  costOf,
  findLeakedIdentifiers,
  MODEL_PRICING_VERSION,
  parseRetryAfterMs,
  type IncidentSummary,
  type TokenUsage,
  withSpan,
} from "@pulse/shared";
import { buildIncidentContext } from "./context.js";
import { AiRetryableError } from "../queue-errors.js";
import { log } from "../log.js";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1500;
const REQUEST_TIMEOUT_MS = 60_000;

export class AiPermanentError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string | null;

  constructor(message: string, opts: { code: string; status?: number; requestId?: string | null }) {
    super(message);
    this.name = "AiPermanentError";
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
  }
}

export class AiNotConfiguredError extends AiPermanentError {
  constructor() {
    super("AI not configured", { code: "AI_NOT_CONFIGURED" });
    this.name = "AiNotConfiguredError";
  }
}

export class RedactionLeakError extends AiPermanentError {
  readonly tokens: string[];

  constructor(tokens: string[]) {
    super(`refusing to send context: unredacted identifiers present (${tokens.join(", ")})`, {
      code: "REDACTION_LEAK",
    });
    this.name = "RedactionLeakError";
    this.tokens = tokens;
  }
}

export class AiSchemaError extends AiPermanentError {
  constructor(message = "model response did not parse into the incident summary schema") {
    super(message, { code: "SCHEMA_INVALID" });
    this.name = "AiSchemaError";
  }
}

export class AiUnpricedModelError extends AiPermanentError {
  constructor(model: string) {
    super(`no pricing entry for model "${model}"`, { code: "UNKNOWN_MODEL_PRICING" });
    this.name = "AiUnpricedModelError";
  }
}

export class AiBudgetExceededError extends AiPermanentError {
  constructor() {
    super("AI daily budget exceeded", { code: "AI_BUDGET_EXCEEDED" });
    this.name = "AiBudgetExceededError";
  }
}

export interface ProviderRequest {
  model: string;
  system: string;
  context: string;
  maxTokens: number;
}

export interface ProviderResponse {
  parsedOutput: IncidentSummary | null;
  usage: TokenUsage;
  requestId?: string | null;
}

export type SummaryProvider = (request: ProviderRequest) => Promise<ProviderResponse>;

export interface SummaryResult {
  summary: IncidentSummary;
  model: string;
  promptVersion: string;
  generatedAt: string;
  contextChars: number;
  contextTruncated: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number | null;
  pricingVersion: string | null;
  latencyMs: number;
  requestId: string | null;
}

function requestIdOf(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as { _request_id?: unknown })._request_id;
  return typeof value === "string" ? value : null;
}

const sdkProvider: SummaryProvider = async ({ model, system, context, maxTokens }) => {
  const client = new Anthropic({ maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
  const response = await withSpan(
    "ai.summary.model",
    { "ai.model": model, "ai.prompt_version": INCIDENT_SUMMARY_PROMPT_VERSION },
    async (span) => {
      const parsed = await client.messages.parse({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: context }],
        output_config: { format: zodOutputFormat(IncidentSummaryAiSchema) },
      });
      span.setAttributes({
        "ai.input_tokens": parsed.usage.input_tokens,
        "ai.output_tokens": parsed.usage.output_tokens,
        "ai.cache_creation_input_tokens": parsed.usage.cache_creation_input_tokens ?? 0,
        "ai.cache_read_input_tokens": parsed.usage.cache_read_input_tokens ?? 0,
        "ai.provider_request_id": requestIdOf(parsed) ?? "",
        "ai.cost_usd":
          costOf(
            {
              inputTokens: parsed.usage.input_tokens,
              outputTokens: parsed.usage.output_tokens,
              cacheCreationInputTokens: parsed.usage.cache_creation_input_tokens ?? 0,
              cacheReadInputTokens: parsed.usage.cache_read_input_tokens ?? 0,
            },
            model,
          ) ?? "unknown",
        "ai.outcome": "ok",
      });
      return parsed;
    },
  );

  return {
    parsedOutput: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
    requestId: requestIdOf(response),
  };
};

function providerError(error: unknown): Error {
  if (!(error instanceof Anthropic.APIError))
    return error instanceof Error ? error : new Error(String(error));

  const status = error.status;
  const requestId = error.requestID;
  if (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  ) {
    if (status === 429) {
      return new AiRetryableError(error.message, {
        status,
        requestId,
        retryAfterMs: parseRetryAfterMs(error.headers?.get("retry-after")),
      });
    }
    return new AiRetryableError(error.message, { status, requestId });
  }

  return new AiPermanentError(error.message, {
    code: status ? `HTTP_${status}` : "AI_PROVIDER_ERROR",
    status,
    requestId,
  });
}

/** Generates from already-prepared context; the provider seam is used by evals and tests. */
export async function summarizePreparedContext(
  context: { markdown: string; truncated: boolean },
  opts: { incidentId?: string; model?: string; provider?: SummaryProvider } = {},
): Promise<SummaryResult> {
  const model =
    opts.model ??
    process.env.ANTHROPIC_SUMMARY_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    DEFAULT_MODEL;
  const provider = opts.provider ?? sdkProvider;

  if (
    process.env.NODE_ENV === "production" &&
    process.env.AI_ALLOW_UNPRICED !== "true" &&
    costOf({ inputTokens: 1, outputTokens: 1 }, model) === null
  ) {
    throw new AiUnpricedModelError(model);
  }

  const leaks = findLeakedIdentifiers(context.markdown);
  if (leaks.length > 0) throw new RedactionLeakError(leaks);

  log.debug(
    {
      incidentId: opts.incidentId,
      contextHash: createHash("sha256").update(context.markdown).digest("hex").slice(0, 16),
      contextChars: context.markdown.length,
      truncated: context.truncated,
    },
    "incident summary context prepared",
  );

  const startedAt = Date.now();
  let response: ProviderResponse;
  try {
    response = await provider({
      model,
      system: INCIDENT_SUMMARY_PROMPT_V2,
      context: context.markdown,
      maxTokens: MAX_TOKENS,
    });
  } catch (error) {
    throw providerError(error);
  }

  if (!response.parsedOutput) throw new AiSchemaError();

  const usage = response.usage;
  const costUsd = costOf(usage, model);
  const knownPricing = costUsd !== null;
  return {
    summary: response.parsedOutput,
    model,
    promptVersion: INCIDENT_SUMMARY_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    contextChars: context.markdown.length,
    contextTruncated: context.truncated,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
    costUsd,
    pricingVersion: knownPricing ? MODEL_PRICING_VERSION : null,
    latencyMs: Date.now() - startedAt,
    requestId: response.requestId ?? null,
  };
}

/** Builds the redacted context, checks it, and asks Claude for a structured summary. */
export async function summarizeIncident(incidentId: string): Promise<SummaryResult> {
  if (process.env.AI_ENABLED !== "true" || !process.env.ANTHROPIC_API_KEY) {
    throw new AiNotConfiguredError();
  }
  const context = await buildIncidentContext(incidentId);
  return summarizePreparedContext(context, { incidentId });
}

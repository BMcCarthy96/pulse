import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  IncidentSummaryAiSchema,
  INCIDENT_SUMMARY_PROMPT_V1,
  INCIDENT_SUMMARY_PROMPT_VERSION,
  type IncidentSummary,
} from "@pulse/shared";
import { buildIncidentContext } from "./context.js";
import { findLeakedIdentifiers } from "./redact.js";
import { log } from "../log.js";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1500;

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI not configured");
    this.name = "AiNotConfiguredError";
  }
}

export class RedactionLeakError extends Error {
  constructor(tokens: string[]) {
    super(`refusing to send context: unredacted identifiers present (${tokens.join(", ")})`);
    this.name = "RedactionLeakError";
  }
}

export interface SummaryResult {
  summary: IncidentSummary;
  model: string;
  promptVersion: string;
  generatedAt: string;
  contextChars: number;
  contextTruncated: boolean;
}

/**
 * doc 03 §6.3–6.5. Builds the redacted context, checks it, and asks Claude for a structured
 * summary. Throws `AiNotConfiguredError` when there is no API key so the caller can mark the
 * incident `failed` with an honest message rather than pretending to have tried.
 */
export async function summarizeIncident(incidentId: string): Promise<SummaryResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();

  const { markdown, truncated } = await buildIncidentContext(incidentId);

  // Last line of defence before the payload leaves the process. `redact` already ran inside
  // the context builder; if anything still matches, that is a redaction bug and the right
  // response is to fail the job, not to ship the identifiers.
  const leaks = findLeakedIdentifiers(markdown);
  if (leaks.length > 0) throw new RedactionLeakError(leaks);

  // The full outgoing payload at DEBUG so the phase-8 acceptance grep has something to read.
  log.debug({ incidentId, context: markdown }, "incident summary context (redacted, as sent)");

  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const client = new Anthropic();

  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    system: INCIDENT_SUMMARY_PROMPT_V1,
    messages: [{ role: "user", content: markdown }],
    output_config: { format: zodOutputFormat(IncidentSummaryAiSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("model response did not parse into the incident summary schema");

  return {
    summary: parsed,
    model,
    promptVersion: INCIDENT_SUMMARY_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    contextChars: markdown.length,
    contextTruncated: truncated,
  };
}

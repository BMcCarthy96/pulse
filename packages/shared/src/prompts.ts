import { z } from "zod";
import * as z4 from "zod/v4";

export const IncidentSummarySchema = z.object({
  summary: z.string(),
  probableCause: z.string(),
  impact: z.string(),
  suggestedSteps: z.array(z.string()).max(5),
  confidence: z.enum(["low", "medium", "high"]),
});

export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

/**
 * Same shape, declared with `zod/v4` because `zodOutputFormat()` from the Anthropic SDK only
 * accepts v4 schemas. The repo is otherwise on zod 3's classic API, and zod 3.25 ships both
 * under one install — so this is a second view of one contract, not a second contract. The
 * `.describe()` calls are here rather than on the v3 schema because they are prompt surface:
 * they travel to the model as the JSON-schema field descriptions.
 */
export const IncidentSummaryAiSchema = z4.object({
  summary: z4.string().describe("2-3 sentences in plain operations language: what is happening and since when."),
  probableCause: z4.string().describe("The most likely cause supported by the evidence given. Say so if ambiguous."),
  impact: z4.string().describe("Which downstream clinical or billing workflow is affected, and how badly."),
  suggestedSteps: z4
    .array(z4.string())
    .max(5)
    .describe("Up to 5 concrete next actions for the on-call engineer, most useful first."),
  confidence: z4
    .enum(["low", "medium", "high"])
    .describe("How well the evidence supports the probable cause."),
});

export const INCIDENT_SUMMARY_PROMPT_VERSION = "v1";

export const INCIDENT_SUMMARY_PROMPT_V1 = `You are an on-call operations assistant for Pulse, a healthcare integration monitoring
console. You are given structured, redacted context about an incident on one integration
connector: recent structured logs, recent failed job errors, and recent inbound/outbound
events. Patient-identifying tokens have already been redacted — never attempt to reconstruct
them or comment on their absence.

Write a concise incident summary for an operations engineer who has not yet looked at the
data. Be specific about symptoms (error types, timing, affected record counts) but do not
speculate about upstream causes you cannot support from the given context — if the evidence
is ambiguous, say so and reflect that in "confidence".

Respond only with the structured fields requested: a 2-3 sentence summary in plain
operations language, a probable cause, the operational impact (what downstream workflow is
affected), up to 5 concrete suggested next steps, and a confidence level.`;

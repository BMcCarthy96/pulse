import { describe, expect, it } from "vitest";
import {
  INCIDENT_SUMMARY_PROMPT_V1,
  INCIDENT_SUMMARY_PROMPT_V2,
  INCIDENT_SUMMARY_PROMPT_VERSION,
  IncidentSummaryAiSchema,
  IncidentSummarySchema,
} from "../src/prompts.js";

/**
 * Prompt drift breaks CI on purpose (phase 9 task 2).
 *
 * The prompt is a versioned artifact: every stored `aiSummary` records the version that produced
 * it, so silently editing the text under a stale version makes those records lie about their own
 * provenance. If this snapshot fails, that is the signal to bump
 * `INCIDENT_SUMMARY_PROMPT_VERSION` and update the snapshot in the same commit — not to
 * regenerate the snapshot on its own.
 */
describe("incident summary prompt", () => {
  it("matches the committed snapshot for its version", () => {
    expect({
      version: "v1",
      prompt: INCIDENT_SUMMARY_PROMPT_V1,
    }).toMatchSnapshot();
  });

  it("uses v2 for new generations", () => {
    expect(INCIDENT_SUMMARY_PROMPT_VERSION).toBe("v2");
  });

  it("still carries the instructions the design depends on", () => {
    // Coarser than the snapshot and survives harmless rewording — these are the three
    // behaviours the AI card's copy and the redaction boundary both assume.
    expect(INCIDENT_SUMMARY_PROMPT_V1).toMatch(/redacted/i);
    expect(INCIDENT_SUMMARY_PROMPT_V1).toMatch(/do not\s+speculate/i);
    expect(INCIDENT_SUMMARY_PROMPT_V1).toMatch(/confidence/i);
  });

  it("never names the chaos mode as an available signal", () => {
    // The context builder deliberately withholds chaos mode; a prompt that told the model to
    // look for it would produce confident nonsense about a field that is never present.
    expect(INCIDENT_SUMMARY_PROMPT_V1).not.toMatch(/chaos/i);
  });
});

describe("incident summary schema", () => {
  const valid = {
    summary: "The EHR connector has been failing since 14:39Z.",
    probableCause: "Upstream returned 503 on every sync attempt.",
    impact: "Appointment sync is stalled; clinical schedules are stale.",
    suggestedSteps: ["Check upstream status", "Retry dead jobs"],
    confidence: "high" as const,
  };

  it("accepts a well-formed summary", () => {
    expect(IncidentSummarySchema.parse(valid)).toEqual(valid);
    expect(IncidentSummaryAiSchema.parse(valid)).toEqual(valid);
  });

  it("caps suggested steps at 5 in both views of the contract", () => {
    const tooMany = { ...valid, suggestedSteps: ["1", "2", "3", "4", "5", "6"] };
    expect(IncidentSummarySchema.safeParse(tooMany).success).toBe(false);
    expect(IncidentSummaryAiSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects a confidence value outside the enum", () => {
    const bad = { ...valid, confidence: "very high" };
    expect(IncidentSummarySchema.safeParse(bad).success).toBe(false);
    expect(IncidentSummaryAiSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps the v3 and v4 views in agreement on required fields", () => {
    // The two schemas are one contract expressed twice; if a field is added to one and not the
    // other, stored summaries and model output stop matching.
    for (const field of Object.keys(valid)) {
      const partial = { ...valid } as Record<string, unknown>;
      delete partial[field];
      expect(IncidentSummarySchema.safeParse(partial).success, `v3 accepted missing ${field}`).toBe(
        false,
      );
      expect(
        IncidentSummaryAiSchema.safeParse(partial).success,
        `v4 accepted missing ${field}`,
      ).toBe(false);
    }
  });
});

describe("incident summary prompt v2", () => {
  it("keeps evidence untrusted and conclusions bounded", () => {
    expect(INCIDENT_SUMMARY_PROMPT_V2).toMatch(/untrusted data/i);
    expect(INCIDENT_SUMMARY_PROMPT_V2).toMatch(/do not claim a fact/i);
    expect(INCIDENT_SUMMARY_PROMPT_V2).toMatch(/calibrat/i);
    expect(INCIDENT_SUMMARY_PROMPT_V2).toMatch(/patient|identifier/i);
  });
});

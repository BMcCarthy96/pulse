import { describe, expect, it } from "vitest";
import { redactLikelyPersonNames } from "../src/redact.js";

describe("redactLikelyPersonNames", () => {
  it("redacts a person name in a free-form question", () => {
    expect(redactLikelyPersonNames("What happened to Dana Alvarez?")).toBe(
      "What happened to [REDACTED:name]?",
    );
  });

  it("does not redact ordinary question openings", () => {
    expect(redactLikelyPersonNames("What Happened to the EHR sync?")).toBe(
      "What Happened to the EHR sync?",
    );
  });
});

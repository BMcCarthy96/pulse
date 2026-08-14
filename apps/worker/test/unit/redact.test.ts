import { describe, expect, it } from "vitest";
import { redact, redactDeep, findLeakedIdentifiers } from "../../src/ai/redact.js";

describe("redact — identifiers", () => {
  it.each([
    ["PAT-4821", "[REDACTED:patient-ref]"],
    ["PAT-1", "[REDACTED:patient-ref]"],
    ["CLM-483920", "[REDACTED:claim-ref]"],
    ["APT-556677", "[REDACTED:appointment-ref]"],
    ["MEM-90210", "[REDACTED:member-id]"],
    ["W123456789", "[REDACTED:member-id]"],
    ["123-45-6789", "[REDACTED:ssn]"],
  ])("%s → %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("strips the FHIR reference prefix rather than leaving it dangling", () => {
    expect(redact("actor: Patient/PAT-4821")).toBe("actor: [REDACTED:patient-ref]");
  });

  it("redacts every occurrence, not just the first", () => {
    expect(redact("PAT-1 talked to PAT-2")).toBe(
      "[REDACTED:patient-ref] talked to [REDACTED:patient-ref]",
    );
  });

  it("leaves lookalikes that are not identifiers alone", () => {
    expect(redact("PATIENT-CARE and CLMX-1 and PAT_4821")).toBe(
      "PATIENT-CARE and CLMX-1 and PAT_4821",
    );
  });
});

describe("redact — contact details", () => {
  it("redacts emails", () => {
    expect(redact("write to ops.team@lakeviewhealth.example today")).toBe(
      "write to [REDACTED:email] today",
    );
  });

  it.each(["555-867-5309", "(555) 867-5309", "+1 555 867 5309"])(
    "redacts the phone number %s",
    (phone) => {
      expect(redact(`call ${phone}`)).toBe("call [REDACTED:phone]");
    },
  );
});

describe("redact — dates", () => {
  it("treats a bare ISO date as a DOB", () => {
    expect(redact("birthDate 1974-03-02")).toBe("birthDate [REDACTED:dob]");
  });

  it("preserves ISO timestamps, which the summary needs", () => {
    const line = "failed at 2026-07-27T14:39:15.310Z";
    expect(redact(line)).toBe(line);
  });

  it("redacts US-format dates", () => {
    expect(redact("dob 3/2/1974")).toBe("dob [REDACTED:dob]");
  });

  it("ignores dates outside the plausible century range", () => {
    expect(redact("1874-03-02")).toBe("1874-03-02");
  });
});

describe("redact — names", () => {
  it("redacts a name adjacent to patient context", () => {
    expect(redact("patient: Marcus Webb")).toBe("patient: [REDACTED:name]");
  });

  it("redacts a name separated by an already-redacted identifier", () => {
    expect(redact("patient PAT-4821 (Dana Kessler)")).toBe(
      "patient [REDACTED:patient-ref] ([REDACTED:name])",
    );
  });

  it("redacts FHIR name fields", () => {
    expect(redact('{"family":"Kessler","given":["Dana"]}')).toBe(
      '{"family":"[REDACTED:name]","given":"[REDACTED:name]"}',
    );
  });

  it("leaves connector and product names alone", () => {
    const line = "Mercy General EHR (FHIR R4) is DOWN; ClearPath Clearinghouse is HEALTHY";
    expect(redact(line)).toBe(line);
  });

  it("redacts known names with no adjacent context word", () => {
    expect(redact("acknowledged by Marcus Webb", ["Marcus Webb"])).toBe(
      "acknowledged by [REDACTED:name]",
    );
  });

  it("matches known names case-insensitively", () => {
    expect(redact("dana alvarez applied chaos", ["Dana Alvarez"])).toBe(
      "[REDACTED:name] applied chaos",
    );
  });

  it("ignores empty entries in the known-names list", () => {
    expect(redact("nothing to do here", ["", "  "])).toBe("nothing to do here");
  });

  it("escapes regex metacharacters in known names", () => {
    expect(redact("report for A.B (Ops)", ["A.B (Ops)"])).toBe("report for [REDACTED:name]");
  });
});

describe("redact — idempotency", () => {
  const line =
    "2026-07-27T14:39:15Z ERROR sync.page failed: patient PAT-4821 (Dana Kessler, dob 1974-03-02) claim CLM-483920";

  it("redacting twice equals redacting once", () => {
    const once = redact(line);
    expect(redact(once)).toBe(once);
  });

  it("leaves its own replacement tokens untouched", () => {
    const tokens = "[REDACTED:patient-ref] [REDACTED:claim-ref] [REDACTED:name] [REDACTED:dob]";
    expect(redact(tokens)).toBe(tokens);
  });

  it("is stable across three passes with known names", () => {
    const names = ["Dana Kessler"];
    const once = redact(line, names);
    expect(redact(redact(once, names), names)).toBe(once);
  });
});

describe("redact — text with nothing to redact", () => {
  it("returns the input unchanged", () => {
    const line = "sync run completed: 120 fetched, 0 failed in 2s";
    expect(redact(line)).toBe(line);
  });

  it("handles an empty string", () => {
    expect(redact("")).toBe("");
  });
});

describe("redactDeep", () => {
  it("walks nested objects and arrays", () => {
    expect(
      redactDeep({
        entries: [{ resource: { id: "PAT-4821", birthDate: "1974-03-02" } }],
        note: "claim CLM-1 filed",
      }),
    ).toEqual({
      entries: [{ resource: { id: "[REDACTED:patient-ref]", birthDate: "[REDACTED:dob]" } }],
      note: "claim [REDACTED:claim-ref] filed",
    });
  });

  it("redacts keys as well as values", () => {
    expect(redactDeep({ "PAT-9999": { seen: true } })).toEqual({
      "[REDACTED:patient-ref]": { seen: true },
    });
  });

  it("passes primitives through untouched", () => {
    expect(redactDeep({ a: 1, b: null, c: true, d: undefined })).toEqual({
      a: 1,
      b: null,
      c: true,
      d: undefined,
    });
  });

  it("passes Dates through untouched", () => {
    const d = new Date("2026-07-27T00:00:00.000Z");
    expect(redactDeep({ at: d }).at).toBe(d);
  });

  it("handles a bare string, number, null and array at the top level", () => {
    expect(redactDeep("PAT-1")).toBe("[REDACTED:patient-ref]");
    expect(redactDeep(7)).toBe(7);
    expect(redactDeep(null)).toBeNull();
    expect(redactDeep(["PAT-1"])).toEqual(["[REDACTED:patient-ref]"]);
  });

  it("applies known names inside nested structures", () => {
    expect(redactDeep({ actor: "Priya Nair" }, ["Priya Nair"])).toEqual({
      actor: "[REDACTED:name]",
    });
  });

  it("is idempotent", () => {
    const input = { note: "PAT-1 and CLM-2", nested: { dob: "1974-03-02" } };
    const once = redactDeep(input);
    expect(redactDeep(once)).toEqual(once);
  });

  it("returns non-JSON values as-is rather than stringifying them", () => {
    // bigint / symbol / function cannot appear in a Prisma JSON column, but `redactDeep` is
    // generic and also runs over job payloads assembled in memory. The fall-through has to
    // hand these back untouched — coercing a symbol to a string would be a silent data change,
    // and throwing would take down a summary job over a field nobody cares about.
    const sym = Symbol("token");
    const fn = () => "noop";
    expect(redactDeep(10n)).toBe(10n);
    expect(redactDeep(sym)).toBe(sym);
    expect(redactDeep(fn)).toBe(fn);
    expect(redactDeep({ id: 1n, tag: sym })).toEqual({ id: 1n, tag: sym });
  });
});

describe("findLeakedIdentifiers", () => {
  it("reports raw identifiers", () => {
    expect(findLeakedIdentifiers("PAT-1 CLM-2 APT-3 123-45-6789")).toEqual([
      "PAT-1",
      "CLM-2",
      "APT-3",
      "123-45-6789",
    ]);
  });

  it("detects identifier casing variants", () => {
    expect(redact("pat-1 and clm-2")).toBe("[REDACTED:patient-ref] and [REDACTED:claim-ref]");
    expect(findLeakedIdentifiers("conn-42", ["CONN-42"])).toEqual(["CONN-42"]);
  });

  it("deduplicates repeats", () => {
    expect(findLeakedIdentifiers("PAT-1 PAT-1")).toEqual(["PAT-1"]);
  });

  it("is empty for redacted text", () => {
    expect(findLeakedIdentifiers(redact("PAT-1 and CLM-2"))).toEqual([]);
  });

  it("is empty for text that never had identifiers", () => {
    expect(findLeakedIdentifiers("all systems healthy")).toEqual([]);
  });

  it("also detects identifiers supplied by the incident scope", () => {
    expect(findLeakedIdentifiers("connector-42 is healthy", ["connector-42"])).toEqual([
      "connector-42",
    ]);
  });

  it("independently detects every protected category covered by the redactor", () => {
    expect(
      findLeakedIdentifiers(
        "MEM-123456 reached dana@example.com at 212-555-0199; DOB 1974-03-02 and SSN 123-45-6789",
      ),
    ).toEqual(["MEM-123456", "123-45-6789", "dana@example.com", "212-555-0199", "1974-03-02"]);
    expect(
      findLeakedIdentifiers(
        redact("MEM-123456 reached dana@example.com at 212-555-0199; DOB 1974-03-02"),
      ),
    ).toEqual([]);
    expect(
      findLeakedIdentifiers(
        "Errors began on 2026-08-14; vendor code EHR123456; Dana Alvarez reviewed it",
        ["Dana Alvarez"],
        { includeAmbiguousMemberIds: false, includeBareDates: false },
      ),
    ).toEqual(["Dana Alvarez"]);
  });
});

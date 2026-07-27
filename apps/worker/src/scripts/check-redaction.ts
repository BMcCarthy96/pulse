/**
 * Redaction spot-checks (phase 8 acceptance). Phase 9 folds these into vitest.
 *   pnpm --filter @pulse/worker exec tsx src/scripts/check-redaction.ts
 */
import { redact, redactDeep, findLeakedIdentifiers } from "../ai/redact.js";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual);
  const e = typeof expected === "string" ? expected : JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got:      ${a}\n      expected: ${e}`);
}

// ── Identifier patterns ──────────────────────────────────────────────────────
check("patient ref", redact("sync failed for PAT-4821"), "sync failed for [REDACTED:patient-ref]");
check("claim ref", redact("claim CLM-483920 rejected"), "claim [REDACTED:claim-ref] rejected");
check(
  "FHIR patient reference keeps no dangling prefix",
  redact("actor: Patient/PAT-4821"),
  "actor: [REDACTED:patient-ref]",
);
check("appointment ref", redact("APT-556677 cancelled"), "[REDACTED:appointment-ref] cancelled");
check("ssn", redact("ssn 123-45-6789"), "ssn [REDACTED:ssn]");
check("email", redact("contact dana.alvarez@example.com now"), "contact [REDACTED:email] now");

// ── Dates: DOB redacted, operational timestamps preserved ────────────────────
check("bare ISO date is treated as a DOB", redact("birthDate 1974-03-02"), "birthDate [REDACTED:dob]");
check(
  "ISO timestamps survive (the summary needs them)",
  redact("failed at 2026-07-27T14:39:15.310Z"),
  "failed at 2026-07-27T14:39:15.310Z",
);
check("US-format DOB", redact("dob 3/2/1974"), "dob [REDACTED:dob]");

// ── Names ────────────────────────────────────────────────────────────────────
check("name next to patient context", redact("patient: Marcus Webb"), "patient: [REDACTED:name]");
check(
  "FHIR name fields",
  redact('{"family":"Kessler","given":["Dana"]}'),
  '{"family":"[REDACTED:name]","given":"[REDACTED:name]"}',
);
check(
  "connector display names are left alone",
  redact("Mercy General EHR (FHIR R4) is DOWN"),
  "Mercy General EHR (FHIR R4) is DOWN",
);

// ── Mixed text ───────────────────────────────────────────────────────────────
const mixed = "2026-07-27T14:39:15Z ERROR sync.page failed: patient PAT-4821 (Dana Kessler, dob 1974-03-02) claim CLM-483920";
const mixedOut = redact(mixed);
check(
  "mixed line",
  mixedOut,
  "2026-07-27T14:39:15Z ERROR sync.page failed: patient [REDACTED:patient-ref] ([REDACTED:name], dob [REDACTED:dob]) claim [REDACTED:claim-ref]",
);

// ── Idempotency ──────────────────────────────────────────────────────────────
check("idempotent: redact(redact(x)) === redact(x)", redact(mixedOut), mixedOut);
check("idempotent on the token itself", redact("[REDACTED:patient-ref]"), "[REDACTED:patient-ref]");

// ── Nested JSON ──────────────────────────────────────────────────────────────
const nested = {
  syncRunId: "cms3bt5j20004qah8t0fdjmz4",
  entries: [
    { resource: { id: "PAT-4821", birthDate: "1974-03-02" } },
    { resource: { id: "APT-556677", note: "claim CLM-483920 for PAT-1234" } },
  ],
  "PAT-9999": { seenAt: "2026-07-27T14:39:15Z" },
};
const nestedOut = redactDeep(nested);
check(
  "nested JSON values and keys",
  nestedOut,
  {
    syncRunId: "cms3bt5j20004qah8t0fdjmz4",
    entries: [
      { resource: { id: "[REDACTED:patient-ref]", birthDate: "[REDACTED:dob]" } },
      {
        resource: {
          id: "[REDACTED:appointment-ref]",
          note: "claim [REDACTED:claim-ref] for [REDACTED:patient-ref]",
        },
      },
    ],
    "[REDACTED:patient-ref]": { seenAt: "2026-07-27T14:39:15Z" },
  },
);
check("redactDeep is idempotent", redactDeep(nestedOut), nestedOut);
check("numbers and nulls survive redactDeep", redactDeep({ a: 1, b: null, c: true }), { a: 1, b: null, c: true });

// ── Leak detector ────────────────────────────────────────────────────────────
check("leak detector finds raw identifiers", findLeakedIdentifiers("PAT-1 and CLM-2"), ["PAT-1", "CLM-2"]);
check("leak detector is clean on redacted text", findLeakedIdentifiers(mixedOut), []);

// ── Known-names list ─────────────────────────────────────────────────────────
const known = ["Dana Alvarez", "Marcus Webb", "Priya Nair"];
check(
  "known name with no adjacent context word",
  redact("acknowledged by Marcus Webb", known),
  "acknowledged by [REDACTED:name]",
);
check("known name is case-insensitive", redact("dana alvarez applied chaos", known), "[REDACTED:name] applied chaos");
check(
  "known names apply inside nested JSON",
  redactDeep({ actor: "Priya Nair", note: "reviewed" }, known),
  { actor: "[REDACTED:name]", note: "reviewed" },
);
check("known-name redaction is idempotent", redact(redact("Marcus Webb", known), known), "[REDACTED:name]");

console.log(failures === 0 ? "\nAll redaction spot-checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

/**
 * PHI boundary (doc 03 §6.2). Everything leaving for the Anthropic API goes through here first.
 *
 * All data in Pulse is synthetic, but the discipline is the point: the redactor runs on the
 * assembled context, not on individual fields, so a new log message or payload shape cannot
 * quietly route around it.
 *
 * Two properties this file must keep:
 *   - **Ordered most-specific first.** `Patient/PAT-4821` has to match before the bare
 *     `PAT-4821` rule, or the prefix is left dangling.
 *   - **Idempotent.** Redacting twice equals redacting once — the replacement tokens are
 *     deliberately shaped so no pattern matches them.
 */

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * `[REDACTED:...]` is the one shape no rule may match. Every pattern below is anchored on
 * digits, an `@`, or a name-like capitalised pair, none of which appear inside the token.
 */
const RULES: RedactionRule[] = [
  // ── Most specific: identifiers carrying their own context ──────────────────
  {
    name: "fhir-patient-reference",
    pattern: /\bPatient\/PAT-\d+/g,
    replacement: "[REDACTED:patient-ref]",
  },
  {
    name: "patient-ref",
    pattern: /\bPAT-\d+/g,
    replacement: "[REDACTED:patient-ref]",
  },
  {
    name: "claim-ref",
    pattern: /\bCLM-\d+/g,
    replacement: "[REDACTED:claim-ref]",
  },
  {
    name: "appointment-ref",
    pattern: /\bAPT-\d+/g,
    replacement: "[REDACTED:appointment-ref]",
  },
  {
    name: "member-id",
    // Eligibility member ids: a letter block then digits, e.g. MEM-90210, W123456789.
    pattern: /\b(?:MEM-\d+|[A-Z]{1,3}\d{6,12})\b/g,
    replacement: "[REDACTED:member-id]",
  },
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED:ssn]",
  },
  {
    name: "email",
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,
    replacement: "[REDACTED:email]",
  },
  {
    name: "phone",
    // `\b` cannot open this pattern: the first character may be `+` or `(`, and there is no
    // word boundary between a space and a punctuation mark, so `\b` pushed the match start
    // past the punctuation and left `+` / `(` dangling outside the replacement token.
    pattern: /(?<!\w)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: "[REDACTED:phone]",
  },
  // ── Dates that look like a date of birth ───────────────────────────────────
  {
    name: "dob-iso",
    // ISO date with no time component. Timestamps (2026-07-27T14:39:15Z) are operationally
    // essential to the summary and are deliberately preserved by requiring the boundary.
    pattern: /\b(?:19|20)\d{2}-\d{2}-\d{2}\b(?!T)/g,
    replacement: "[REDACTED:dob]",
  },
  {
    name: "dob-us",
    pattern: /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b/g,
    replacement: "[REDACTED:dob]",
  },
  // ── Least specific: person names ───────────────────────────────────────────
  {
    name: "name-in-patient-context",
    // faker generates real-looking names. Rather than ship a name dictionary, match the
    // structural giveaway: a capitalised first/last pair sitting next to patient context.
    // The optional `[REDACTED:...]` in the middle matters — by the time this rule runs the
    // identifier has already been replaced, so `patient PAT-4821 (Dana Kessler)` reads as
    // `patient [REDACTED:patient-ref] (Dana Kessler)` and a stricter gap would miss the name.
    pattern:
      /\b(patient|member|subscriber|beneficiary|name|given|family)\b(\s*[:=]?\s*(?:\[REDACTED:[a-z-]+\])?\s*["(']?\s*)([A-Z][a-z]+ [A-Z][a-z]+)\b/gi,
    replacement: "$1$2[REDACTED:name]",
  },
  {
    name: "fhir-name-fields",
    // {"family":"Kessler","given":["Dana"]} — redact the values, keep the structure so the
    // model can still see that a name field was present and empty.
    pattern: /("(?:family|given|firstName|lastName)"\s*:\s*)(\[?\s*"[^"]+"\s*\]?)/g,
    replacement: '$1"[REDACTED:name]"',
  },
];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * doc 03 §6.2's "known-names list". The demo personas are staff rather than patients, but
 * their names are seeded data and appear in timeline entries the context builder reads, so
 * they are stripped too — the acceptance check greps the outgoing context for seeded names and
 * expects none.
 */
function knownNameRules(names: string[]): RedactionRule[] {
  return names
    .filter((n) => n.trim().length > 0)
    .map((name) => ({
      name: `known-name:${name}`,
      // Lookarounds rather than `\b` for the same reason as the phone rule: a seeded name can
      // end in punctuation ("Dana A.", "Kessler (Ops)"), and `\b` requires a word character on
      // the inside of the boundary — so those names silently failed to match at all.
      pattern: new RegExp(`(?<!\\w)${escapeRegExp(name.trim())}(?!\\w)`, "gi"),
      replacement: "[REDACTED:name]",
    }));
}

/**
 * Redacts a string. Safe to call on already-redacted text.
 *
 * `knownNames` are matched literally before the structural rules run — an exact known name is
 * the most specific signal available, so it goes first.
 */
export function redact(text: string, knownNames: string[] = []): string {
  let out = text;
  for (const rule of [...knownNameRules(knownNames), ...RULES]) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

/**
 * Deep variant for JSON contexts (log `context` blobs, job payloads, event bodies). Keys are
 * redacted as well as values — a key can carry an identifier (`{"PAT-4821": {...}}`).
 */
export function redactDeep<T>(value: T, knownNames: string[] = []): T {
  if (typeof value === "string") return redact(value, knownNames) as unknown as T;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, knownNames)) as unknown as T;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[redact(key, knownNames)] = redactDeep(v, knownNames);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Belt-and-braces check used by the summarizer before the payload leaves the process. Returns
 * the tokens that should never have survived redaction — if this is ever non-empty the call is
 * abandoned rather than sent.
 */
export function findLeakedIdentifiers(text: string): string[] {
  const leaks = new Set<string>();
  for (const pattern of [/\bPAT-\d+/g, /\bCLM-\d+/g, /\bAPT-\d+/g, /\b\d{3}-\d{2}-\d{4}\b/g]) {
    for (const match of text.matchAll(pattern)) leaks.add(match[0]);
  }
  return [...leaks];
}

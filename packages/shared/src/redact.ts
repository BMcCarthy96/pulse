/**
 * PHI boundary. Everything leaving for a model provider goes through this module first.
 *
 * Pulse data is synthetic, but the boundary is deliberate: redact the assembled context rather
 * than individual fields so new payload shapes cannot quietly route around it.
 */

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const RULES: RedactionRule[] = [
  {
    name: "fhir-patient-reference",
    pattern: /\bPatient\/PAT-\d+/gi,
    replacement: "[REDACTED:patient-ref]",
  },
  { name: "patient-ref", pattern: /\bPAT-\d+/gi, replacement: "[REDACTED:patient-ref]" },
  { name: "claim-ref", pattern: /\bCLM-\d+/gi, replacement: "[REDACTED:claim-ref]" },
  { name: "appointment-ref", pattern: /\bAPT-\d+/gi, replacement: "[REDACTED:appointment-ref]" },
  {
    name: "member-id",
    pattern: /\b(?:MEM-\d+|[A-Z]{1,3}\d{6,12})\b/gi,
    replacement: "[REDACTED:member-id]",
  },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[REDACTED:ssn]" },
  { name: "email", pattern: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, replacement: "[REDACTED:email]" },
  {
    name: "phone",
    pattern: /(?<!\w)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: "[REDACTED:phone]",
  },
  {
    name: "dob-iso",
    pattern: /\b(?:19|20)\d{2}-\d{2}-\d{2}\b(?!T)/g,
    replacement: "[REDACTED:dob]",
  },
  {
    name: "dob-us",
    pattern: /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b/g,
    replacement: "[REDACTED:dob]",
  },
  {
    name: "name-in-patient-context",
    pattern:
      /\b(patient|member|subscriber|beneficiary|name|given|family)\b(\s*[:=]?\s*(?:\[REDACTED:[a-z-]+\])?\s*["(']?\s*)([A-Z][a-z]+ [A-Z][a-z]+)\b/gi,
    replacement: "$1$2[REDACTED:name]",
  },
  {
    name: "fhir-name-fields",
    pattern: /("(?:family|given|firstName|lastName)"\s*:\s*)(\[?\s*"[^"]+"\s*\]?)/g,
    replacement: '$1"[REDACTED:name]"',
  },
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownNameRules(names: string[]): RedactionRule[] {
  return names
    .filter((name) => name.trim().length > 0)
    .map((name) => ({
      name: `known-name:${name}`,
      pattern: new RegExp(`(?<!\\w)${escapeRegExp(name.trim())}(?!\\w)`, "gi"),
      replacement: "[REDACTED:name]",
    }));
}

export function redact(text: string, knownNames: string[] = []): string {
  let output = text;
  for (const rule of [...knownNameRules(knownNames), ...RULES]) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
}

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
  if (Array.isArray(value))
    return value.map((item) => redactDeep(item, knownNames)) as unknown as T;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[redact(key, knownNames)] = redactDeep(item, knownNames);
    }
    return output as T;
  }
  return value;
}

export interface LeakScanOptions {
  /** Standalone codes such as W123456789 are treated as member IDs by the strict outbound scan. */
  includeAmbiguousMemberIds?: boolean;
  /** Bare YYYY-MM-DD values are DOB-like in source data but can be legitimate incident dates. */
  includeBareDates?: boolean;
}

export function findLeakedIdentifiers(
  text: string,
  knownIdentifiers: string[] = [],
  options: LeakScanOptions = {},
): string[] {
  const leaks = new Set<string>();
  // Keep this scanner intentionally independent from `RULES`. If the redactor regresses, the
  // policy check must still catch every protected category rather than reusing the same patterns.
  const protectedPatterns = [
    /\bPatient\/PAT-\d+/gi,
    /\bPAT-\d+/gi,
    /\bCLM-\d+/gi,
    /\bAPT-\d+/gi,
    /\bMEM-\d+\b/gi,
    /\b\d{3}-\d{2}-\d{4}\b/g,
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi,
    /(?<!\w)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b/g,
  ];
  if (options.includeAmbiguousMemberIds !== false) {
    protectedPatterns.push(/\b[A-Z]{1,3}\d{6,12}\b/gi);
  }
  if (options.includeBareDates !== false) {
    protectedPatterns.push(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b(?!T)/g);
  }
  for (const pattern of protectedPatterns) {
    for (const match of text.matchAll(pattern)) leaks.add(match[0]);
  }
  for (const identifier of knownIdentifiers) {
    const value = identifier.trim();
    if (value.length > 0 && text.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
      leaks.add(value);
  }
  return [...leaks];
}

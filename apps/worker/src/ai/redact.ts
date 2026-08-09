// Compatibility re-export for existing worker imports. The redaction boundary lives in the
// shared package so the web copilot and worker summaries cannot drift.
export { redact, redactDeep, findLeakedIdentifiers } from "@pulse/shared";

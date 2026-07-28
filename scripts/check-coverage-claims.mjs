#!/usr/bin/env node
/**
 * Asserts the two coverage claims the README makes, from `coverage/coverage-summary.json`.
 *
 * Vitest's threshold check already fails the run if these regress — this script exists so the
 * numbers are *visible*. The text reporter omits files at 100%, which means a passing run prints
 * nothing at all about the two files it is most important to be able to point at.
 *
 * Run after `pnpm test:coverage`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLAIMS = ["apps/worker/src/health/rules.ts", "apps/worker/src/ai/redact.ts"];
const SUMMARY = resolve(process.cwd(), "coverage/coverage-summary.json");

let summary;
try {
  summary = JSON.parse(readFileSync(SUMMARY, "utf8"));
} catch {
  console.error(`No coverage summary at ${SUMMARY}. Run \`pnpm test:coverage\` first.`);
  process.exit(1);
}

// Keys are absolute paths; match on a normalised suffix so this works on Windows and CI alike.
const normalise = (p) => p.replace(/\\/g, "/");
let failed = false;

for (const claim of CLAIMS) {
  const entry = Object.entries(summary).find(([path]) => normalise(path).endsWith(claim));

  if (!entry) {
    console.error(`MISSING  ${claim} — not present in the coverage report`);
    failed = true;
    continue;
  }

  const [, metrics] = entry;
  const parts = ["statements", "branches", "functions", "lines"].map((m) => `${m} ${metrics[m].pct}%`);
  const perfect = ["statements", "branches", "functions", "lines"].every((m) => metrics[m].pct === 100);

  console.log(`${perfect ? "OK      " : "BELOW   "}${claim} — ${parts.join(", ")}`);
  if (!perfect) failed = true;
}

if (failed) {
  console.error("\nCoverage claims not met.");
  process.exit(1);
}
console.log("\nAll coverage claims met.");

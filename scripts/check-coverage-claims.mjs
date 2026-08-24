#!/usr/bin/env node
/**
 * Asserts the targeted coverage claims the README makes, from
 * `coverage/coverage-summary.json`.
 *
 * Vitest's threshold check already fails the run if these regress — this script exists so the
 * numbers are *visible*. The text reporter omits files at 100%, which means a passing run prints
 * nothing at all about the files it is most important to be able to point at.
 *
 * Run after `pnpm test:coverage`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLAIMS = [
  {
    path: "apps/worker/src/health/rules.ts",
    minimum: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
  {
    path: "packages/shared/src/redact.ts",
    minimum: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
  {
    path: "packages/shared/src/ai-budget.ts",
    minimum: { statements: 100, branches: 90, functions: 100, lines: 100 },
  },
  {
    path: "packages/shared/src/tracked-jobs.ts",
    minimum: { statements: 100, branches: 80, functions: 100, lines: 100 },
  },
];
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
  const entry = Object.entries(summary).find(([path]) => normalise(path).endsWith(claim.path));

  if (!entry) {
    console.error(`MISSING  ${claim.path} — not present in the coverage report`);
    failed = true;
    continue;
  }

  const [, metrics] = entry;
  const parts = ["statements", "branches", "functions", "lines"].map(
    (m) => `${m} ${metrics[m].pct}%`,
  );
  const meetsClaim = ["statements", "branches", "functions", "lines"].every(
    (metric) => metrics[metric].pct >= claim.minimum[metric],
  );

  console.log(`${meetsClaim ? "OK      " : "BELOW   "}${claim.path} — ${parts.join(", ")}`);
  if (!meetsClaim) failed = true;
}

if (failed) {
  console.error("\nCoverage claims not met.");
  process.exit(1);
}
console.log("\nAll coverage claims met.");

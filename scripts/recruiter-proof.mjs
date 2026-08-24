#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "apps/web/content/recruiter-proof.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const mode = process.argv.includes("--write") ? "write" : "check";
const temporary = mkdtempSync(join(tmpdir(), "pulse-proof-"));

function run(args, extraEnv = {}) {
  const result = spawnSync(pnpm, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Command failed: pnpm ${args.join(" ")}`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function countVitest(config, filename) {
  const output = join(temporary, filename);
  const args = ["exec", "vitest", "list"];
  if (config) args.push("--config", config);
  args.push(`--json=${output}`);
  run(args, config ? { PULSE_PROOF_LIST: "true" } : {});
  return readJson(output).length;
}

function countPlaywright() {
  const output = run(["--filter", "@pulse/web", "exec", "playwright", "test", "--list"]);
  const match = output.match(/Total:\s+(\d+) tests?/);
  if (!match) throw new Error("Could not read the Playwright test count");
  return Number(match[1]);
}

function packageVersion(path) {
  return readJson(join(root, path)).version;
}

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`Could not update ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

try {
  const existing = readJson(manifestPath);
  const appVersions = [
    "apps/web/package.json",
    "apps/worker/package.json",
    "packages/db/package.json",
    "packages/shared/package.json",
  ].map(packageVersion);
  if (new Set(appVersions).size !== 1) {
    throw new Error(`Workspace versions are not aligned: ${appVersions.join(", ")}`);
  }

  const openapi = readFileSync(join(root, "docs/openapi.yaml"), "utf8");
  const apiVersion = openapi.match(/^\s*version:\s*([^\s]+)$/m)?.[1];
  if (!apiVersion) throw new Error("Could not read docs/openapi.yaml info.version");

  const corpus = readFileSync(join(root, "evals/corpus.ts"), "utf8");
  const investigationFixtures = readJson(join(root, "evals/investigation-fixtures.json"));
  const evalReport = readJson(join(root, "evals/reports/latest.json"));
  const aggregate = evalReport.aggregate ?? {};
  const rate = (key) => {
    const value = aggregate[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Missing numeric eval aggregate: ${key}`);
    }
    return value;
  };
  const derived = {
    appVersion: appVersions[0],
    apiVersion,
    tests: {
      unit: countVitest(null, "unit.json"),
      integration: countVitest("vitest.integration.config.ts", "integration.json"),
      e2e: countPlaywright(),
    },
    evals: {
      summaryCases: (corpus.match(/^\s{4}id:\s/gm) ?? []).length,
      investigationFixtures: investigationFixtures.length,
      safetyCategories: new Set(investigationFixtures.map((item) => item.category)).size,
      groundingRate: rate("required-fact grounding"),
      schemaPassRate: rate("critical / schema"),
      leakGuardRate: Math.min(
        rate("critical / pre-send leakage refusal"),
        rate("critical / output leakage"),
      ),
      injectionResistanceRate: rate("critical / injection resistance"),
    },
  };

  if (mode === "write") {
    const ciRunUrl =
      process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined;
    const next = {
      ...existing,
      ...derived,
      evals: { ...existing.evals, ...derived.evals },
      totalAutomatedTests: derived.tests.unit + derived.tests.integration + derived.tests.e2e,
      generatedAt: new Date().toISOString().slice(0, 10),
    };
    if (ciRunUrl) next.ciRunUrl = ciRunUrl;
    else delete next.ciRunUrl;
    // A local count refresh is not a commit-specific CI verification. Release automation owns
    // the immutable run/SHA association; keep the local manifest honest about what it proves.
    delete next.verifiedAt;
    delete next.lastVerifiedCommit;
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);

    const readmePath = join(root, "README.md");
    let readme = readFileSync(readmePath, "utf8");
    for (const [label, count] of Object.entries(derived.tests)) {
      const display = label === "e2e" ? "E2E" : label[0].toUpperCase() + label.slice(1);
      const row = new RegExp(
        `^(\\|\\s*\\*\\*${display}\\*\\*[^\\n]*\\|\\s*)\\d+(\\s*\\|\\s*)$`,
        "m",
      );
      readme = replaceRequired(
        readme,
        row,
        (_match, prefix, suffix) => `${prefix}${count}${suffix}`,
        `README ${display} test count`,
      );
    }
    writeFileSync(readmePath, readme);

    const positioningPath = join(root, "docs/positioning.md");
    const positioning = readFileSync(positioningPath, "utf8");
    const total = derived.tests.unit + derived.tests.integration + derived.tests.e2e;
    const updatedPositioning = replaceRequired(
      positioning,
      /\b\d+ automated tests\b/g,
      `${total} automated tests`,
      "positioning total test count",
    );
    writeFileSync(positioningPath, updatedPositioning);

    console.log(`Updated ${manifestPath}`);
    console.log(`Updated generated test claims in ${readmePath} and ${positioningPath}`);
    console.log(JSON.stringify(derived, null, 2));
  } else {
    const mismatches = [];
    for (const key of ["appVersion", "apiVersion", "tests"]) {
      if (JSON.stringify(existing[key]) !== JSON.stringify(derived[key])) mismatches.push(key);
    }
    for (const key of [
      "summaryCases",
      "investigationFixtures",
      "safetyCategories",
      "groundingRate",
      "schemaPassRate",
      "leakGuardRate",
      "injectionResistanceRate",
    ]) {
      if (existing.evals?.[key] !== derived.evals[key]) mismatches.push(`evals.${key}`);
    }
    if (typeof existing.totalAutomatedTests === "number") {
      const total = derived.tests.unit + derived.tests.integration + derived.tests.e2e;
      if (existing.totalAutomatedTests !== total) mismatches.push("totalAutomatedTests");
    }
    if (typeof existing.ciRunUrl === "string" && /actions\/workflows\//.test(existing.ciRunUrl)) {
      mismatches.push("ciRunUrl (must point to an immutable run)");
    }
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const positioning = readFileSync(join(root, "docs/positioning.md"), "utf8");
    const countClaim = (label, count) =>
      new RegExp("\\*\\*" + label + "\\*\\*[^\\n]*\\|\\s*" + count + "\\s*\\|").test(readme);
    if (!countClaim("Unit", derived.tests.unit)) mismatches.push("README unit test claim");
    if (!countClaim("Integration", derived.tests.integration))
      mismatches.push("README integration test claim");
    if (!countClaim("E2E", derived.tests.e2e)) mismatches.push("README E2E test claim");
    const total = derived.tests.unit + derived.tests.integration + derived.tests.e2e;
    if (!new RegExp("\\b" + total + " automated tests\\b").test(positioning)) {
      mismatches.push("positioning automated test claim");
    }
    if ("verifiedAt" in existing || "lastVerifiedCommit" in existing) {
      mismatches.push("legacy verification metadata (run proof:refresh)");
    }
    if (mismatches.length > 0) {
      console.error(`Recruiter proof is stale: ${mismatches.join(", ")}`);
      console.error("Run `pnpm proof:refresh` and commit the updated manifest.");
      process.exitCode = 1;
    } else {
      console.log(
        `Recruiter proof verified: ${derived.tests.unit} unit, ${derived.tests.integration} integration, ${derived.tests.e2e} browser tests.`,
      );
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

#!/usr/bin/env node
/**
 * Creates, migrates and seeds the dedicated `pulse_e2e` database.
 *
 * Runs as a separate step *before* `playwright test` rather than as Playwright's `globalSetup`,
 * because Playwright starts its `webServer` processes first — the worker would boot against a
 * database that did not exist yet and exit before global setup ever ran.
 *
 * A separate database, not the dev one: the demo flow deliberately breaks things (chaos OUTAGE,
 * a failed sync, an open incident), and running that over the seeded demo data would leave the
 * dashboard in a state nobody wants to screenshot.
 */
import { execFileSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Redis } from "ioredis";

const here = dirname(fileURLToPath(import.meta.url));
const dbPackage = resolve(here, "../../../packages/db");
const root = resolve(here, "../../..");

try {
  loadEnvFile(resolve(root, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function databaseUrl(name) {
  const configured = new URL(
    process.env.DATABASE_URL ?? "postgresql://pulse:pulse@localhost:5432/pulse",
  );
  configured.pathname = `/${name}`;
  return configured.toString();
}

function redisUrl(database) {
  const configured = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  configured.pathname = `/${database}`;
  return configured.toString();
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? databaseUrl("pulse_e2e");

const TRUNCATE_SQL = `TRUNCATE TABLE
  "InvestigationAction", "InvestigationEvidence", "Investigation", "DemoSession", "AiCall", "AiRun", "AuditEntry", "IncidentTimelineEntry", "Incident", "HealthSnapshot", "LogEntry",
  "IntegrationEvent", "Job", "SyncRun", "Connector", "User", "Organization"
RESTART IDENTITY CASCADE;`;

function run(args, env = {}, input) {
  return execFileSync("npx", args, {
    cwd: dbPackage,
    env: { ...process.env, ...env },
    input,
    stdio: input ? "pipe" : "inherit",
    shell: process.platform === "win32",
  });
}

const url = new URL(DATABASE_URL);
const databaseName = url.pathname.replace(/^\//, "");
if (!databaseName.endsWith("_e2e")) {
  console.error(`Refusing to reset "${databaseName}" — the e2e database name must end in _e2e.`);
  process.exit(1);
}
url.pathname = "/postgres";

try {
  run(
    ["prisma", "db", "execute", "--url", url.toString(), "--stdin"],
    {},
    `CREATE DATABASE "${databaseName}";`,
  );
  console.log(`[e2e] created database ${databaseName}`);
} catch (err) {
  const message = `${err?.message ?? ""}${err?.stderr ?? ""}`;
  if (!/already exists/i.test(message)) {
    console.error(`[e2e] failed to create ${databaseName}`);
    throw err;
  }
  console.log(`[e2e] database ${databaseName} already exists`);
}

run(["prisma", "migrate", "deploy"], { DATABASE_URL });

// Reset to a known state on every run: the flow asserts on statuses and counts, and a database
// still carrying the previous run's OUTAGE would make the first assertion pass for the wrong
// reason.
run(["prisma", "db", "execute", "--url", DATABASE_URL, "--stdin"], {}, TRUNCATE_SQL);

// BullMQ jobs live outside Postgres. Flush only the explicitly dedicated E2E Redis database so
// stale jobs from a previous run cannot reference rows that the reset above deliberately removed.
const e2eRedis = new Redis(process.env.E2E_REDIS_URL ?? redisUrl(2));
await e2eRedis.flushdb();
await e2eRedis.quit();
run(["tsx", "prisma/seed.ts"], { DATABASE_URL });

console.log(`[e2e] ${databaseName} migrated and seeded`);

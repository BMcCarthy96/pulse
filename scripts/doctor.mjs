#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const warnings = [];

function line(label, status, detail) {
  console.log(`${status.padEnd(5)} ${label.padEnd(18)} ${detail}`);
}

function command(program, args, options = {}) {
  const executable = process.platform === "win32" && program === "pnpm" ? "pnpm.cmd" : program;
  return spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
    timeout: 10_000,
  });
}

function parseEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((entry) => entry && !entry.startsWith("#") && entry.includes("="))
      .map((entry) => {
        const index = entry.indexOf("=");
        return [entry.slice(0, index), entry.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function endpoint(value, fallbackPort) {
  const url = new URL(value);
  return `${url.hostname}:${url.port || fallbackPort}`;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 22) line("Node", "OK", process.versions.node);
else {
  failures.push("Node 22 or newer is required");
  line("Node", "FAIL", `${process.versions.node}; expected >=22`);
}

const pnpm = command("pnpm", ["--version"]);
if (pnpm.status === 0) line("pnpm", "OK", pnpm.stdout.trim());
else {
  failures.push("pnpm is not available");
  line("pnpm", "FAIL", "run `corepack enable`");
}

const envPath = resolve(root, ".env");
if (existsSync(envPath)) line("Environment", "OK", ".env found");
else {
  failures.push(".env is missing");
  line("Environment", "FAIL", "copy .env.example to .env");
}
const env = { ...parseEnv(envPath), ...process.env };

const docker = command("docker", ["info", "--format", "{{.ServerVersion}}"]);
if (docker.status === 0) line("Docker", "OK", `engine ${docker.stdout.trim()}`);
else {
  failures.push("Docker engine is unavailable");
  const output = `${docker.stdout ?? ""}\n${docker.stderr ?? ""}`;
  line(
    "Docker",
    "FAIL",
    output.includes("activate the WSL integration")
      ? "enable Docker Desktop → Resources → WSL integration → Ubuntu"
      : "start Docker Desktop or dockerd",
  );
}

const compose = command("docker", ["compose", "ps", "--format", "json"]);
if (compose.status === 0) {
  const services = compose.stdout.trim();
  line(
    "Compose",
    services ? "OK" : "WARN",
    services ? "services discovered" : "no services running",
  );
  if (!services) warnings.push("Run `docker compose up -d` before integration or browser tests");
} else {
  failures.push("Docker Compose is unavailable");
  line("Compose", "FAIL", "`docker compose ps` failed");
}

const databaseUrl = env.DATABASE_URL ?? "postgresql://pulse:pulse@localhost:5432/pulse";
const postgres = command(
  "pnpm",
  ["--filter", "@pulse/db", "exec", "prisma", "db", "execute", "--url", databaseUrl, "--stdin"],
  { input: "SELECT 1;" },
);
if (postgres.status === 0)
  line("Postgres", "OK", `${endpoint(databaseUrl, 5432)} answered SELECT 1`);
else {
  failures.push(`Postgres is not ready at ${endpoint(databaseUrl, 5432)}`);
  line("Postgres", "FAIL", `${endpoint(databaseUrl, 5432)} did not answer a protocol check`);
}

const redisConnection = env.REDIS_URL ?? "redis://localhost:6379";
const redis = command(
  "pnpm",
  [
    "--filter",
    "@pulse/web",
    "exec",
    "node",
    "-e",
    "const Redis=require('ioredis').default;const r=new Redis(process.env.PULSE_DOCTOR_REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:0,connectTimeout:3000});r.connect().then(()=>r.ping()).then(()=>r.quit()).then(()=>process.exit(0)).catch(()=>process.exit(1));",
  ],
  { env: { PULSE_DOCTOR_REDIS_URL: redisConnection } },
);
if (redis.status === 0) line("Redis", "OK", `${endpoint(redisConnection, 6379)} answered PING`);
else {
  failures.push(`Redis is not ready at ${endpoint(redisConnection, 6379)}`);
  line("Redis", "FAIL", `${endpoint(redisConnection, 6379)} did not answer a protocol check`);
}

const playwright = command("pnpm", [
  "--filter",
  "@pulse/web",
  "exec",
  "node",
  "-e",
  "const{chromium}=require('@playwright/test');const fs=require('node:fs');process.exit(fs.existsSync(chromium.executablePath())?0:1)",
]);
if (playwright.status === 0) line("Playwright", "OK", "Chromium installed");
else {
  failures.push("Playwright Chromium is missing");
  line("Playwright", "FAIL", "run `pnpm --filter @pulse/web exec playwright install chromium`");
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);
if (failures.length > 0) {
  console.error(`\nDoctor found ${failures.length} blocking issue(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("\nPulse is ready for the full local verification path.");

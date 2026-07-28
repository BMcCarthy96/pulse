import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Creates and migrates the dedicated `pulse_test` database once per run.
 *
 * It is a separate database rather than a separate schema so that a mistyped connection string
 * cannot truncate the demo data — the seeded demo is the thing every screenshot and walkthrough
 * depends on, and it is not reproducible without re-running the seed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dbPackage = resolve(here, "../../packages/db");

function adminUrlFor(databaseUrl: string): { adminUrl: string; databaseName: string } {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");
  // Connect to the always-present `postgres` database to issue CREATE DATABASE, which cannot be
  // run from inside the database it is creating.
  url.pathname = "/postgres";
  return { adminUrl: url.toString(), databaseName };
}

function prisma(args: string[], env: NodeJS.ProcessEnv) {
  return execFileSync("npx", ["prisma", ...args], {
    cwd: dbPackage,
    env: { ...process.env, ...env },
    stdio: "pipe",
    shell: process.platform === "win32",
  }).toString();
}

export async function setup() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set — check vitest.integration.config.ts");

  const { adminUrl, databaseName } = adminUrlFor(databaseUrl);

  if (!databaseName.endsWith("_test")) {
    // A guard, not a formality: every suite truncates every table on the way in.
    throw new Error(
      `Refusing to run integration tests against "${databaseName}" — the database name must end in _test.`,
    );
  }

  try {
    execFileSync("npx", ["prisma", "db", "execute", "--url", adminUrl, "--stdin"], {
      cwd: dbPackage,
      input: `CREATE DATABASE "${databaseName}";`,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    console.log(`[integration] created database ${databaseName}`);
  } catch (err) {
    // Already exists is the normal case on every run after the first.
    const message = err instanceof Error ? `${err.message}${"stderr" in err ? String(err.stderr) : ""}` : String(err);
    if (!/already exists/i.test(message)) throw err;
  }

  prisma(["migrate", "deploy"], { DATABASE_URL: databaseUrl });
  console.log(`[integration] migrations applied to ${databaseName}`);
}

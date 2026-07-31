import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration suite: real Postgres + real Redis, no HTTP servers.
 *
 * Kept in its own config so `pnpm test:unit` stays runnable with nothing installed but Node —
 * a unit suite that quietly needs Docker is a unit suite people stop running.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://pulse:pulse@localhost:5432/pulse_test";

// Redis logical database 1, so a test run cannot drain or corrupt the queues a dev server is
// working against on database 0.
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

const TEST_ENV = {
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  WEBHOOK_SIGNING_SECRET: "integration-test-secret",
  // Shrunk so lifecycle tests assert the rules rather than wait out production timings.
  HEALTH_TICK_SEC: "5",
  HEALTH_WINDOW_MIN: "15",
  INCIDENT_STABILITY_MIN: "0",
  // Explicitly absent: the AI path must degrade gracefully, and no test may spend money.
  ANTHROPIC_API_KEY: "",
  // The worker logs every transition at INFO; across a lifecycle suite that buries the results.
  LOG_LEVEL: "silent",
};

// `test.env` is injected into the worker threads only — `globalSetup` runs earlier, in the main
// process, and would not see it. Assigning here covers both.
Object.assign(process.env, TEST_ENV);

export default defineConfig({
  test: {
    include: ["apps/**/test/integration/**/*.test.ts", "packages/**/test/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./test/integration/global-setup.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // One database, shared. Running files in parallel against it would make truncation between
    // suites race with whatever another file is mid-insert on.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: TEST_ENV,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".json"],
    alias: {
      // `@pulse/*` resolve to source for the same reason as in vitest.config.ts: those packages
      // publish `dist` for the `default` condition so the worker container can run plain Node,
      // and without these the integration suite would need a `pnpm build` first. Subpath entry
      // comes first — these are prefix matches.
      "@pulse/shared/webhook-signature": fileURLToPath(
        new URL("./packages/shared/src/webhook-signature.ts", import.meta.url),
      ),
      "@pulse/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@pulse/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      // Mirrors apps/web/tsconfig.json's path mapping so web lib modules can be imported and
      // tested directly, without a Next server in the way.
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against the built app plus a real worker, because the demo flow is a worker story:
 * chaos → failing sync → retries → DEAD jobs → health tick → incident → recovery. A mocked
 * backend would exercise nothing the integration suite does not already cover.
 *
 * Both processes are managed here via `webServer`, each with its own env. The worker is polled
 * on its simulator's `/healthz` — it has no HTTP surface of its own, but the simulator only
 * listens once the worker has booted, which makes it a valid readiness probe.
 */

const PORT = 3010;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://pulse:pulse@localhost:5432/pulse_e2e";

const SHARED_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://localhost:6379/2",
  AUTH_SECRET: "e2e-secret-not-used-anywhere-else",
  AUTH_URL: BASE_URL,
  WEBHOOK_SIGNING_SECRET: "e2e-webhook-secret",
  WEBHOOK_TARGET_URL: BASE_URL,
  SEED_DEMO_PASSWORD: "pulse-demo-2026",
  NEXT_PUBLIC_DEMO_PASSWORD: "pulse-demo-2026",
  // doc 05 step 5: the flow must degrade gracefully with no key, and CI must never spend money.
  ANTHROPIC_API_KEY: "",
  // Compressed timings so the demo flow runs in minutes, not half an hour. The rules themselves
  // are untouched — only how long each window is.
  HEALTH_TICK_SEC: "5",
  HEALTH_WINDOW_MIN: "2",
  INCIDENT_STABILITY_MIN: "0",
};

export default defineConfig({
  testDir: "./e2e",
  // No `globalSetup` for the database: Playwright starts `webServer` before global setup runs,
  // so the worker would boot against a database that does not exist yet. `scripts/
  // prepare-e2e-db.mjs` runs ahead of Playwright from the `test:e2e` script instead.
  // The demo flow waits on real health ticks and a full retry cycle (5 attempts, 2s→32s
  // backoff); it is inherently slow and that is fine.
  timeout: 420_000,
  expect: { timeout: 30_000 },
  // One worker: the specs drive shared connector state (chaos mode) through a single database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm --filter @pulse/web start`,
      url: `${BASE_URL}/login`,
      cwd: "../..",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...SHARED_ENV, PORT: String(PORT) },
    },
    {
      // A dedicated script rather than `exec tsx` (which does not resolve from the workspace
      // root) and rather than `dev` (whose `--env-file=.env` would pull in local dev settings).
      command: `pnpm --filter @pulse/worker start:e2e`,
      url: "http://localhost:4001/healthz",
      cwd: "../..",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...SHARED_ENV,
        SIMULATOR_PORT: "4001",
        SIMULATOR_BASE_URL: "http://localhost:4001",
        LOG_LEVEL: "info",
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DEMO_BASE_URL;
if (!baseURL) throw new Error("DEMO_BASE_URL is required for remote smoke tests");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "remote-smoke.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});

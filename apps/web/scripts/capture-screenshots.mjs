/**
 * Captures the five README/portfolio screenshots into `docs/media/`.
 *
 * Deliberately a script rather than a Playwright test: it is not an assertion about the app, it
 * is a build step for the docs, and running it in CI would mean committing binaries from a job.
 * It talks to an already-running stack (`pnpm dev` or `pnpm --filter @pulse/web start`) so the
 * charts and job tables contain the same seeded data a reader will see when they clone and run.
 *
 *   pnpm --filter @pulse/web screenshots
 *
 * Re-seed first (`pnpm db:seed`) if the shots need to match a clean checkout — phase 11 task 3
 * asks for "consistent seeded state", and the health engine mutates connector status as it ticks.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3010";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "pulse-demo-2026";
const ADMIN_EMAIL = "dana@lakeviewhealth.example";

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.resolve(here, "../../../docs/media");

/** 2x so the images stay sharp when GitHub scales them down inside the README. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

/**
 * Next's dev-tools bubble renders into a `<nextjs-portal>` element and floats over the
 * bottom-left corner of every page, so it lands in the frame of anything captured against
 * `pnpm dev`. Hidden per-navigation rather than by turning `devIndicators` off in
 * `next.config.ts`, which would take the indicator away from normal development too.
 */
async function hideDevOverlay(page) {
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast] { display: none !important; }" });
}

async function shoot(page, name, { fullPage = false } = {}) {
  await hideDevOverlay(page);
  // Recharts animates on mount; without settling first the line chart is captured mid-draw.
  await page.waitForTimeout(1200);
  const file = path.join(MEDIA_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: "disabled", scale: "css" });
  console.log(`  wrote docs/media/${name}.png`);
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "light",
    // Pinned so relative timestamps ("2d ago") and the 24h chart axis read the same for every
    // person who regenerates these, rather than tracking the machine's locale.
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();

  // Admin persona: the chaos panel and the audit log are both ADMIN-gated, and two of the five
  // required shots are of exactly those.
  console.log(`Signing in as ${ADMIN_EMAIL} at ${BASE_URL}`);
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 30_000 });

  // 1 — Overview. The README hero.
  await page.goto(`${BASE_URL}/`);
  await page.getByText("Integration health across all connectors.").waitFor();
  await shoot(page, "01-overview");

  // 2 — Connector detail with the chaos panel. Full page: the panel sits below the metrics.
  await page.goto(`${BASE_URL}/connectors/ehr-fhir`);
  await page.getByText("Chaos panel").waitFor({ timeout: 30_000 });
  await shoot(page, "02-connector-chaos-panel", { fullPage: true });

  // 3 — Failing jobs. The page already defaults its status filter to DEAD.
  await page.goto(`${BASE_URL}/jobs`);
  await page.getByRole("table").waitFor({ timeout: 30_000 });
  await shoot(page, "03-dead-jobs");

  // 4 — An incident with a finished AI summary. Picked from the API rather than hardcoded,
  // because the seed uses cuids for some incidents and uuids for others.
  const incidents = await page.evaluate(async () => {
    const res = await fetch("/api/v1/incidents?limit=50");
    if (!res.ok) throw new Error(`incidents list failed: ${res.status}`);
    return (await res.json()).data;
  });
  const withSummary = incidents.find((i) => i.aiSummaryStatus === "ready" || i.aiSummaryStatus === "edited");
  if (!withSummary) {
    throw new Error(
      "No incident has a completed AI summary. Run the worker with ANTHROPIC_API_KEY set, or re-seed.",
    );
  }
  console.log(`  incident ${withSummary.id} (${withSummary.aiSummaryStatus})`);
  await page.goto(`${BASE_URL}/incidents/${withSummary.id}`);
  await page.getByText("AI summary").waitFor({ timeout: 30_000 });
  await shoot(page, "04-incident-ai-summary", { fullPage: true });

  // 5 — Audit log. It is the default tab on Settings.
  await page.goto(`${BASE_URL}/settings`);
  await page.getByRole("table").waitFor({ timeout: 30_000 });
  await shoot(page, "05-audit-log");

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

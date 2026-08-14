/**
 * Captures the recruiter-facing v3 story into `docs/media/`.
 *
 * This deliberately enters through the public `/recruiter` page and provisions the same
 * short-lived, tenant-isolated demo a recruiter receives. It does not use a shared admin
 * account, an AI provider key, or mutable seed history. The result is one coherent incident:
 * public pitch → broken overview → cited findings → approval → execution + audit.
 *
 * It is a documentation build step rather than a Playwright test. Run it against an already
 * running current build with `DEMO_MODE=true`:
 *
 *   pnpm --filter @pulse/web screenshots
 *
 * Override `SCREENSHOT_BASE_URL` when the preview is not on http://localhost:3010.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3010";

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.resolve(here, "../../../docs/media");
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Hide development-only UI without changing normal application configuration. */
async function hideDevOverlay(page) {
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-toast] { display: none !important; }",
  });
}

async function settle(page) {
  await hideDevOverlay(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Recharts and route transitions animate on mount. A short settle keeps captures repeatable.
  await page.waitForTimeout(900);
}

async function shoot(page, name, { fullPage = false } = {}) {
  await settle(page);
  const file = path.join(MEDIA_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: "disabled", scale: "css" });
  console.log(`  wrote docs/media/${name}.png`);
}

async function openRecruiterLanding(page) {
  const response = await page.goto(`${BASE_URL}/recruiter`, { waitUntil: "networkidle" });
  if (!response?.ok()) {
    throw new Error(`Recruiter landing failed: ${response?.status() ?? "no response"}`);
  }
  await page
    .getByRole("heading", {
      name: /Investigate integration failures before clinicians discover them/i,
    })
    .waitFor();
  await page.getByText("Provider-free by default").waitFor();
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  let demoCreated = false;

  try {
    console.log(`Capturing the public recruiter path at ${BASE_URL}`);
    await openRecruiterLanding(page);
    await shoot(page, "01-recruiter-landing");

    await page.setViewportSize(MOBILE_VIEWPORT);
    await openRecruiterLanding(page);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (hasHorizontalOverflow) throw new Error("Recruiter landing overflows the mobile viewport");
    await shoot(page, "02-recruiter-mobile");

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await openRecruiterLanding(page);
    await page
      .getByRole("button", { name: /Launch interactive demo/i })
      .first()
      .click();
    try {
      await page.getByTestId("recruiter-tour-button").waitFor({ timeout: 30_000 });
    } catch (error) {
      const visibleError = await page
        .getByRole("alert")
        .textContent()
        .catch(() => null);
      throw new Error(
        visibleError
          ? `Demo provisioning failed: ${visibleError}`
          : "Demo provisioning failed. Confirm the current app was started with DEMO_MODE=true.",
        { cause: error },
      );
    }
    demoCreated = true;

    await page.getByText("Synthetic incident workspace").waitFor();
    await page.getByRole("link", { name: "Continue investigation" }).waitFor();
    await shoot(page, "03-broken-overview");

    await page.getByRole("link", { name: "Continue investigation" }).click();
    await page.getByRole("heading", { name: "Investigation workspace" }).waitFor();
    await page.getByTestId("guided-question-first-signal").click();
    await page.getByText("Deterministic demo synthesis").first().waitFor({ timeout: 30_000 });
    await page.getByRole("heading", { name: "Proposed actions" }).waitFor();
    await page.getByText(/Evidence board/).waitFor();
    await page.getByRole("link", { name: "Findings", exact: true }).click();
    await page.locator("#findings").waitFor();
    await shoot(page, "04-cited-investigation");

    const approve = page.getByTestId("approve-action").first();
    await approve.scrollIntoViewIfNeeded();
    await approve.click();
    await page.getByRole("button", { name: "Revalidate and approve" }).waitFor();
    await shoot(page, "05-approval-confirmation");

    const approvalResponse = page.waitForResponse(
      (response) => response.url().includes("/actions/") && response.url().endsWith("/approve"),
    );
    await page.getByRole("button", { name: "Revalidate and approve" }).click();
    const response = await approvalResponse;
    if (!response.ok()) throw new Error(`Action approval failed: ${response.status()}`);

    await page.getByText("Action history").waitFor();
    await page.getByText("SUCCEEDED", { exact: true }).first().waitFor();
    const auditHeading = page.getByText("Audit trail", { exact: true });
    await auditHeading.waitFor();
    await auditHeading.scrollIntoViewIfNeeded();
    await shoot(page, "06-executed-action-audit");

    console.log("Done. Captured one isolated, provider-free recruiter story.");
  } finally {
    if (demoCreated) {
      const reset = await page.request.post(`${BASE_URL}/api/demo/reset`).catch(() => null);
      if (reset?.ok()) {
        console.log("  reset demo to baseline; one-hour TTL cleanup remains scheduled");
      } else console.warn("  demo reset did not complete; one-hour TTL cleanup remains scheduled");
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Captures the guided v3 demo story into `docs/media/`.
 *
 * This enters through the public `/demo` page and provisions a short-lived, tenant-isolated
 * workspace. It does not use a shared admin
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

async function openDemoLanding(page) {
  const response = await page.goto(`${BASE_URL}/demo`, { waitUntil: "networkidle" });
  if (!response?.ok()) {
    throw new Error(`Demo landing failed: ${response?.status() ?? "no response"}`);
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
    console.log(`Capturing the public demo path at ${BASE_URL}`);
    await openDemoLanding(page);
    await shoot(page, "01-recruiter-landing");

    await page.setViewportSize(MOBILE_VIEWPORT);
    await openDemoLanding(page);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (hasHorizontalOverflow) throw new Error("Demo landing overflows the mobile viewport");
    await shoot(page, "02-recruiter-mobile");

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await openDemoLanding(page);
    await page
      .getByRole("button", { name: /Launch interactive demo/i })
      .first()
      .click();
    try {
      await page.getByTestId("walkthrough-button").waitFor({ timeout: 30_000 });
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
    await page.getByRole("heading", { name: "Start with the failed sync" }).waitFor();
    await page.locator('[data-walkthrough="open-incident"]').waitFor();
    await shoot(page, "03-broken-overview");

    await page.setViewportSize(MOBILE_VIEWPORT);
    const guidedOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (guidedOverflow) throw new Error("Guided walkthrough overflows the mobile viewport");
    await shoot(page, "03-guided-overview-mobile");
    await page.setViewportSize(DESKTOP_VIEWPORT);

    await page.locator('[data-walkthrough="open-incident"]').click();
    await page.getByRole("heading", { name: "Investigation workspace" }).waitFor();
    await page.locator('[data-walkthrough="run-first-signal"]').click();
    await page.getByText("Deterministic demo synthesis").first().waitFor({ timeout: 30_000 });
    await page.getByRole("heading", { name: "Proposed actions" }).waitFor();
    await page.getByText(/Evidence board/).waitFor();
    await page.getByRole("heading", { name: "Open the source" }).waitFor();
    await shoot(page, "04-cited-investigation");

    await page.locator('[data-walkthrough="open-first-citation"]').click();
    await page.locator('[data-walkthrough="open-actions"]').click();
    const approve = page.locator('[data-walkthrough="open-retry-approval"]');
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
    await page.getByRole("heading", { name: "The action is recorded" }).waitFor();
    await shoot(page, "06-executed-action-audit");
    await page.getByRole("button", { name: "Finish walkthrough" }).click();

    console.log("Done. Captured one isolated, provider-free demo story.");
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

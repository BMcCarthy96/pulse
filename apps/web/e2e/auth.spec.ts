import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs, logout } from "./helpers";

test.describe("auth and role gates", () => {
  test("gives an anonymous visitor a useful public entry point and protects the app", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/demo/);
    await expect(
      page.getByRole("heading", {
        name: /Investigate integration failures before clinicians discover them/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Launch interactive demo/i }).first(),
    ).toBeVisible();
    await expect(page.getByText("Recorded replay by default")).toBeVisible();
    await page.goto("/recruiter");
    await expect(page).toHaveURL(/\/demo/);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const live = await page.request.get("/livez", { maxRedirects: 0 });
    expect(live.status()).toBe(200);
    expect(await live.json()).toMatchObject({ ok: true, service: "web" });
    const ready = await page.request.get("/readyz", { maxRedirects: 0 });
    expect([200, 503]).toContain(ready.status());
    expect(await ready.json()).toHaveProperty("ready");
    const socialCard = await page.request.get("/pulse-demo-card.png", { maxRedirects: 0 });
    expect(socialCard.status()).toBe(200);
    expect(socialCard.headers()["content-type"]).toContain("image/png");

    await page.goto("/incidents");
    await expect(page).toHaveURL(/\/login/);
    // Asserting on the form itself rather than a "Sign in" heading: the card title is a styled
    // div, not an h-element, so it has no heading role to query.
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByText("All data is synthetic. Upstream systems are simulated."),
    ).toBeVisible();
  });

  test("rejects a wrong password without leaking which field was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("dana@lakeviewhealth.example");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in and out through the demo persona buttons", async ({ page }) => {
    await loginAs(page, "ops");
    await expect(page.getByRole("link", { name: /connectors/i })).toBeVisible();
    await expect(page.getByText("Synthetic incident workspace")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-button")).toHaveCount(0);
    await logout(page);
  });

  test("guides an isolated demo through evidence, approval, and audit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/demo");
    await page
      .getByRole("button", { name: /Launch interactive demo/i })
      .first()
      .click();

    const walkthroughButton = page.getByTestId("walkthrough-button");
    await expect(walkthroughButton).toContainText("1/7");
    await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const callout = document
          .querySelector('[data-testid="walkthrough-callout"]')
          ?.getBoundingClientRect();
        const target = document
          .querySelector('[data-walkthrough="open-incident"]')
          ?.getBoundingClientRect();
        if (!callout || !target) return null;
        return {
          callout: {
            top: callout.top,
            right: callout.right,
            bottom: callout.bottom,
            left: callout.left,
          },
          overlapsTarget: !(
            callout.right <= target.left ||
            callout.left >= target.right ||
            callout.bottom <= target.top ||
            callout.top >= target.bottom
          ),
          overflows: document.documentElement.scrollWidth > window.innerWidth,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      });
      expect(layout).not.toBeNull();
      expect(layout?.overflows).toBe(false);
      expect(layout?.overlapsTarget).toBe(false);
      expect(layout?.callout.left).toBeGreaterThanOrEqual(0);
      expect(layout?.callout.top).toBeGreaterThanOrEqual(0);
      expect(layout?.callout.right).toBeLessThanOrEqual(layout?.viewport.width ?? 0);
      expect(layout?.callout.bottom).toBeLessThanOrEqual(layout?.viewport.height ?? 0);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    const overviewAxe = await new AxeBuilder({ page }).analyze();
    expect(
      overviewAxe.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(walkthroughButton).toContainText("Resume 1/7");
    await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toHaveCount(0);
    await page.reload();
    await expect(walkthroughButton).toContainText("Resume 1/7");
    await walkthroughButton.click();

    const openIncident = page.locator('[data-walkthrough="open-incident"]');
    await expect(openIncident).toBeFocused();
    await openIncident.press("Enter");
    await expect(page).toHaveURL(/\/incidents\/[^/]+#investigation-heading/);
    await expect(page.getByRole("heading", { name: "Investigation workspace" })).toBeVisible();
    await expect(walkthroughButton).toContainText("2/7");
    await expect(page.getByRole("heading", { name: "Check the first signal" })).toBeVisible();

    const firstSignal = page.getByTestId("guided-question-first-signal");
    await expect(firstSignal).toBeFocused();
    await firstSignal.press("Enter");
    await expect(page.getByText("Deterministic demo synthesis").first()).toBeVisible();
    await expect(page.getByTestId("investigation-telemetry")).toContainText(
      "deterministic-demo-v3",
    );
    await expect(page.getByText("Investigation activity")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposed actions" })).toBeVisible();
    await expect(walkthroughButton).toContainText("3/7");

    const firstCitation = page.locator('[data-walkthrough="open-first-citation"]');
    await expect(firstCitation).toBeFocused();
    await firstCitation.click();
    await expect(walkthroughButton).toContainText("4/7");
    const actionsLink = page.locator('[data-walkthrough="open-actions"]');
    await expect(actionsLink).toBeFocused();
    await actionsLink.click();

    await expect(walkthroughButton).toContainText("5/7");
    const approveRetry = page.locator('[data-walkthrough="open-retry-approval"]');
    await expect(approveRetry).toBeFocused();
    await approveRetry.click();
    await expect(page.getByRole("button", { name: "Revalidate and approve" })).toBeVisible();
    await expect(walkthroughButton).toContainText("6/7");

    const confirmApproval = page.locator('[data-walkthrough="confirm-retry-approval"]');
    await expect(confirmApproval).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-slot="dialog-content"] :focus')).toHaveCount(1);
    await confirmApproval.focus();
    const approvalResponse = page.waitForResponse(
      (response) => response.url().includes("/actions/") && response.url().endsWith("/approve"),
    );
    await confirmApproval.press("Enter");
    const approvedResponse = await approvalResponse;
    expect(approvedResponse.ok()).toBeTruthy();
    const approved = (await approvedResponse.json()) as {
      action: { result?: { dbJobId?: string } };
    };
    const retriedJobId = approved.action.result?.dbJobId;
    expect(retriedJobId).toBeTruthy();
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/v1/jobs/${retriedJobId}`);
        if (!response.ok()) return `HTTP ${response.status()}`;
        return ((await response.json()) as { job: { status: string } }).job.status;
      })
      .toBe("SUCCEEDED");
    await expect(page.getByText("Action history")).toBeVisible();
    await expect(page.getByText("SUCCEEDED", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Job retry queued")).toBeVisible();
    await expect(walkthroughButton).toContainText("7/7");
    await expect(page.getByRole("heading", { name: "The action is recorded" })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);

    await page.getByRole("button", { name: "Finish walkthrough" }).click();
    await expect(walkthroughButton).toContainText("Replay walkthrough");
    await page.reload();
    await expect(walkthroughButton).toContainText("Replay walkthrough");
    await expect(page.getByRole("heading", { name: "The action is recorded" })).toHaveCount(0);

    await page.getByTestId("demo-controls-button").click();
    await page.getByRole("menuitem", { name: "Reset workspace" }).click();
    await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
    await expect(walkthroughButton).toContainText("1/7");

    const storageKey = await page.evaluate(() =>
      Object.keys(window.localStorage).find((key) => key.startsWith("pulse:guided-walkthrough:")),
    );
    if (!storageKey) throw new Error("Guided walkthrough state was not saved");
    const incidents = await page.request.get("/api/v1/incidents?status=ACTIVE&limit=1");
    const incidentId = (await incidents.json()).data[0].id as string;
    await page.evaluate((key) => {
      const current = JSON.parse(window.localStorage.getItem(key) ?? "null");
      window.localStorage.setItem(
        key,
        JSON.stringify({ ...current, stepIndex: 2, status: "active" }),
      );
    }, storageKey);
    await page.goto(`/incidents/${incidentId}`);
    await expect(page.getByTestId("walkthrough-recovery")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Explore on your own" }).click();
    await expect(walkthroughButton).toContainText("Resume 3/7");
  });

  test("keeps concurrent guided demo tenants isolated", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    for (const page of [pageA, pageB]) {
      await page.goto("/login");
      await page.getByRole("button", { name: "Enter one-click demo" }).click();
      await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("demo-controls-button")).toBeVisible();
    }

    const incidentsA = await pageA.request.get("/api/v1/incidents");
    const incidentsB = await pageB.request.get("/api/v1/incidents");
    expect(incidentsA.ok()).toBeTruthy();
    expect(incidentsB.ok()).toBeTruthy();
    const incidentA = (await incidentsA.json()).data[0].id as string;
    const incidentB = (await incidentsB.json()).data[0].id as string;
    expect(incidentA).not.toBe(incidentB);

    const crossTenantRead = await pageB.request.get("/api/v1/incidents/" + incidentA);
    expect(crossTenantRead.status()).toBe(404);
    const crossTenantMutation = await pageB.request.post(
      "/api/v1/incidents/" + incidentA + "/investigations",
    );
    expect(crossTenantMutation.status()).toBe(404);

    for (const page of [pageA, pageB]) {
      await page.getByTestId("demo-controls-button").click();
      await page.getByRole("menuitem", { name: "Reset workspace" }).click();
    }
    await contextA.close();
    await contextB.close();
  });
  test("keeps the guided demo login free of serious or critical accessibility violations", async ({
    page,
  }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("keeps primary navigation usable on a phone-sized viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "admin");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Incidents" }),
    ).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: "Incidents" }).click();
    await expect(page).toHaveURL(/\/incidents/);
  });

  test("keeps overview and investigation workspace free of serious accessibility violations", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Enter one-click demo" }).click();
    await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("demo-controls-button")).toBeVisible();

    await page.goto("/");
    const overviewResults = await new AxeBuilder({ page }).analyze();
    expect(
      overviewResults.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);

    await page.goto("/incidents");
    await page.getByRole("link", { name: /Mercy General EHR sync is failing/i }).click();
    await expect(page.getByRole("heading", { name: "Investigation workspace" })).toBeVisible();
    const workspaceResults = await new AxeBuilder({ page }).analyze();
    expect(
      workspaceResults.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
  test("shows Settings to an admin", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();
  });

  test("hides Settings from a viewer and blocks the API behind it", async ({ page }) => {
    await loginAs(page, "viewer");
    await expect(page.getByRole("link", { name: /settings/i })).toHaveCount(0);

    const res = await page.request.get("/api/v1/audit");
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  test("blocks a viewer from mutating, with the error envelope", async ({ page }) => {
    await loginAs(page, "viewer");

    const res = await page.request.post("/api/v1/connectors/ehr-fhir/chaos", {
      data: { mode: "OUTAGE" },
    });

    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "FORBIDDEN", message: /ADMIN role required/ },
    });
  });
});

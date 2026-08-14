import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs, logout } from "./helpers";

test.describe("auth and role gates", () => {
  test("gives an anonymous recruiter a useful public entry point and protects the app", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/recruiter/);
    await expect(
      page.getByRole("heading", {
        name: /Investigate integration failures before clinicians discover them/i,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the live demo" }).first()).toBeVisible();
    await expect(page.getByText("Recorded AI by default")).toBeVisible();

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
    await logout(page);
  });

  test("opens an isolated recruiter workspace with recorded investigation evidence", async ({
    page,
  }) => {
    await page.goto("/recruiter");
    await page.getByRole("button", { name: "Try the live demo" }).first().click();
    await expect(page.getByRole("heading", { name: "Recruiter walkthrough" })).toBeVisible();
    await expect(page.getByText("1. Review the overview")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
    await page.goto("/incidents");
    await page.getByRole("link", { name: /Mercy General EHR sync is failing/i }).click();
    await expect(page.getByRole("heading", { name: "Investigation workspace" })).toBeVisible();
    const firstSignal = page.getByTestId("guided-question-first-signal");
    await firstSignal.click();
    await expect(page.getByText("Recorded fixture")).toBeVisible();
    await expect(page.getByTestId("investigation-telemetry")).toContainText("recorded-fixture-v3");
    await expect(page.getByText("Investigation activity")).toBeVisible();
    await expect(page.getByText(/Evidence board/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposed actions" })).toBeVisible();
    // The report renders from the run.completed refresh just before the stream's finally block
    // clears `busy`. Waiting for the guided control to re-enable avoids clicking an action while
    // that final workspace refresh can still replace the proposed-action DOM.
    await expect(firstSignal).toBeEnabled();
    const approvalResponse = page.waitForResponse(
      (response) => response.url().includes("/actions/") && response.url().endsWith("/approve"),
    );
    await page.getByTestId("approve-action").first().click();
    expect((await approvalResponse).ok()).toBeTruthy();
    await expect(page.getByText("Action history")).toBeVisible();
    await expect(page.getByText("SUCCEEDED")).toBeVisible();
    await expect(page.getByText("Audit trail")).toBeVisible();
    await expect(page.getByText("job · retry")).toBeVisible();
  });

  test("keeps concurrent recruiter tenants isolated", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    for (const page of [pageA, pageB]) {
      await page.goto("/login");
      await page.getByRole("button", { name: "Enter one-click demo" }).click();
      await expect(page.getByRole("heading", { name: "Recruiter walkthrough" })).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
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

    await pageA.getByRole("button", { name: "Reset demo" }).click();
    await pageB.getByRole("button", { name: "Reset demo" }).click();
    await contextA.close();
    await contextB.close();
  });
  test("keeps the recruiter login free of serious or critical accessibility violations", async ({
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
    await expect(page.getByRole("heading", { name: "Recruiter walkthrough" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();

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

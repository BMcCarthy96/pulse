import { expect, test } from "@playwright/test";
import { loginAs, logout } from "./helpers";

test.describe("auth and role gates", () => {
  test("redirects an anonymous visitor to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    // Asserting on the form itself rather than a "Sign in" heading: the card title is a styled
    // div, not an h-element, so it has no heading role to query.
    await expect(page.getByLabel("Email")).toHaveCount(99); // TEMPORARY: forced failure to verify CI artifact upload
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByText("All data is synthetic. Upstream systems are simulated.")).toBeVisible();
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
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN", message: /ADMIN role required/ } });
  });
});

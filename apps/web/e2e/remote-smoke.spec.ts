import { expect, test } from "@playwright/test";

test("deployed recruiter path provisions, explains, and resets an isolated demo", async ({
  page,
}) => {
  const health = await page.request.get("/api/v1/health");
  expect(health.ok()).toBeTruthy();

  await page.goto("/recruiter");
  await expect(
    page.getByRole("heading", {
      name: /Investigate integration failures before clinicians discover them/i,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try the live demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Recruiter walkthrough" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();

  const incidents = await page.request.get("/api/v1/incidents?status=ACTIVE&limit=1");
  expect(incidents.ok()).toBeTruthy();
  expect((await incidents.json()).data).toHaveLength(1);

  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Recruiter walkthrough" })).toBeVisible();
});

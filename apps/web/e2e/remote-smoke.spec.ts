import { expect, test } from "@playwright/test";

test("deployed demo path provisions, explains, and resets an isolated workspace", async ({
  page,
}) => {
  const health = await page.request.get("/api/v1/health");
  expect(health.ok()).toBeTruthy();

  await page.goto("/demo");
  await expect(
    page.getByRole("heading", {
      name: /Investigate integration failures before clinicians discover them/i,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Launch interactive demo/i })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("demo-controls-button")).toBeVisible();

  const incidents = await page.request.get("/api/v1/incidents?status=ACTIVE&limit=1");
  expect(incidents.ok()).toBeTruthy();
  expect((await incidents.json()).data).toHaveLength(1);

  await page.getByTestId("demo-controls-button").click();
  await page.getByRole("menuitem", { name: "Reset workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
});

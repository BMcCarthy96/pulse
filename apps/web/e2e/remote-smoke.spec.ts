import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

test("deployed demo completes the investigation, approval, audit, and reset path", async ({
  page,
}) => {
  const health = await page.request.get("/api/v1/health");
  expect(health.ok()).toBeTruthy();
  const socialCard = await page.request.get("/pulse-demo-card.png", { maxRedirects: 0 });
  expect(socialCard.status()).toBe(200);
  expect(socialCard.headers()["content-type"]).toContain("image/png");

  await page.goto("/recruiter");
  await expect(page).toHaveURL(/\/demo\/?$/);
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

  const walkthroughButton = page.getByTestId("walkthrough-button");
  await expect(walkthroughButton).toContainText("1/7");
  const openIncident = page.locator('[data-walkthrough="open-incident"]');
  await expect(openIncident).toBeFocused();
  await openIncident.press("Enter");
  await expect(page.getByRole("heading", { name: "Investigation workspace" })).toBeVisible();
  await expect(walkthroughButton).toContainText("2/7");

  const firstSignal = page.getByTestId("guided-question-first-signal");
  await expect(firstSignal).toBeFocused();
  await firstSignal.press("Enter");
  // The deployed environment may expose either the provider-free replay or the budgeted live
  // model. Both use the same evidence, citation, approval, and audit contract.
  await expect(page.getByText(/Deterministic demo synthesis|Live provider/).first()).toBeVisible({
    timeout: 60_000,
  });
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
  await expect(page.getByText("SUCCEEDED", { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Job retry queued")).toBeVisible();
  await expect(walkthroughButton).toContainText("7/7");
  await expect(page.getByRole("heading", { name: "The action is recorded" })).toBeVisible();

  await page.getByRole("button", { name: "Finish walkthrough" }).click();
  await expect(walkthroughButton).toContainText("Replay walkthrough");

  await page.getByTestId("demo-controls-button").click();
  const resetWorkspace = page.getByRole("menuitem", { name: "Reset workspace" });
  await expect(resetWorkspace).toBeVisible();
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/demo/reset") && response.request().method() === "POST",
  );
  await resetWorkspace.press("Enter");
  expect((await resetResponse).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Start with the failed sync" })).toBeVisible();
  await expect(walkthroughButton).toContainText("1/7");
});

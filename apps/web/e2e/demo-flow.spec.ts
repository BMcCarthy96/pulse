import { expect, test } from "@playwright/test";
import { loginAs, setChaosMode, waitForCondition } from "./helpers";

/**
 * doc 05 §"E2E demo flow" — the eight steps the Loom walkthrough follows, in order.
 *
 * Deliberately one long test rather than eight independent ones: each step's precondition is the
 * previous step's outcome, and splitting them would either re-run the whole flow per step or
 * leave the specs order-dependent while pretending not to be.
 *
 * Runs with no ANTHROPIC_API_KEY (see playwright.config.ts), so step 5 asserts the graceful
 * degradation path rather than a real generation.
 */

const EHR = "ehr-fhir";

test("the full demo flow: healthy → outage → incident → recovery → audit", async ({ page }) => {
  // ── 1. Login as Ops; overview shows the fleet ────────────────────────────
  await loginAs(page, "ops");
  await expect(page.getByRole("heading", { name: /overview/i })).toBeVisible();
  // `.first()` because the connector name legitimately appears several times on the overview —
  // its health tile, the error-rate chart legend, and the seeded incident history.
  await expect(page.getByText("Mercy General EHR (FHIR R4)").first()).toBeVisible();

  // Ops must not see the chaos panel — that is an admin control.
  await page.goto(`/connectors/${EHR}`);
  await expect(page.getByText("Chaos panel")).toHaveCount(0);

  // ── 2. As Admin, set the EHR connector to OUTAGE ─────────────────────────
  await loginAs(page, "admin");
  await setChaosMode(page, EHR, "OUTAGE");

  // ── 3. Trigger a sync; watch it fail through retries into DEAD ───────────
  const deadBefore = await countJobs(page, "DEAD");

  await page.goto(`/connectors/${EHR}`);
  await page.getByRole("button", { name: "Run sync now" }).click();

  await waitForCondition(page, async () => (await countJobs(page, "DEAD")) > deadBefore, {
    label: "a sync job to exhaust its retries and land in DEAD",
    timeoutMs: 180_000,
    intervalMs: 5_000,
  });

  // The failure is visible where an operator would look, not just in the database.
  await page.goto(`/connectors/${EHR}`);
  await page.getByRole("tab", { name: "Sync History" }).click();
  await expect(page.getByText(/simulator returned 503/i).first()).toBeVisible();

  // ── 4. Health ticks drive the connector DOWN and open an incident ────────
  await waitForCondition(page, async () => (await connectorStatus(page, EHR)) === "DOWN", {
    label: "the health engine to mark the connector DOWN",
    timeoutMs: 120_000,
  });

  await waitForCondition(page, async () => (await openIncidentCount(page)) >= 1, {
    label: "an incident to open",
    timeoutMs: 120_000,
  });

  await page.goto("/incidents");
  await expect(page.getByText(/Mercy General EHR \(FHIR R4\) is DOWN/).first()).toBeVisible();
  await expect(page.getByText("OPEN").first()).toBeVisible();

  // ── 5. The incident's AI card degrades gracefully with no API key ────────
  const incidentId = await firstOpenIncidentId(page);
  await page.goto(`/incidents/${incidentId}`);
  await expect(page.getByText("AI incident summary")).toBeVisible();

  await waitForCondition(
    page,
    async () => {
      const status = await incidentSummaryStatus(page, incidentId);
      return status === "failed";
    },
    { label: "the AI summary to fail cleanly with no API key", timeoutMs: 90_000 },
  );

  await page.goto(`/incidents/${incidentId}`);
  await expect(page.getByText(/AI not configured/i)).toBeVisible();
  // The rest of the incident page must still be fully usable without AI.
  await expect(page.getByText(/incident opened/i).first()).toBeVisible();

  // ── 6. Chaos back to HEALTHY, then retry the dead jobs ───────────────────
  await setChaosMode(page, EHR, "HEALTHY");

  await page.goto("/jobs");
  await page.getByRole("button", { name: /retry all matching/i }).click();
  await page.getByRole("button", { name: /retry/i }).last().click();

  await waitForCondition(page, async () => (await countJobs(page, "DEAD")) === 0, {
    label: "the dead-job queue to drain after retry",
    timeoutMs: 120_000,
    intervalMs: 5_000,
  });

  // ── 7. Health recovers; the incident monitors then resolves ──────────────
  await waitForCondition(page, async () => (await connectorStatus(page, EHR)) === "HEALTHY", {
    label: "the connector to recover to HEALTHY",
    timeoutMs: 180_000,
    intervalMs: 5_000,
  });

  await waitForCondition(
    page,
    async () => {
      const status = await incidentStatus(page, incidentId);
      return status === "RESOLVED";
    },
    {
      label: "the incident to pass through MONITORING and auto-resolve",
      timeoutMs: 180_000,
      intervalMs: 5_000,
    },
  );

  await page.goto(`/incidents/${incidentId}`);
  await expect(page.getByText("RESOLVED").first()).toBeVisible();
  await expect(page.getByText(/auto-resolved/i)).toBeVisible();

  // ── 8. The audit log accounts for everything an operator did ─────────────
  await loginAs(page, "admin");
  await page.goto("/settings");

  await expect(page.getByText("connector.chaos_change").first()).toBeVisible();
  await expect(page.getByText(/job\.retry/).first()).toBeVisible();
  // Every audited action names a real person, not "system".
  await expect(page.getByText("Dana Alvarez").first()).toBeVisible();
});

// ── Helpers that read state through the API rather than scraping the DOM ────
// The API is the same surface the UI polls, so this is not a shortcut around the app — it is
// just a stable way to ask "has the background work finished yet".

async function countJobs(page: import("@playwright/test").Page, status: string): Promise<number> {
  const res = await page.request.get(`/api/v1/jobs?status=${status}&limit=1&withTotal=1&connectorKey=${EHR}`);
  if (!res.ok()) return -1;
  return (await res.json()).total ?? 0;
}

async function connectorStatus(page: import("@playwright/test").Page, key: string): Promise<string> {
  const res = await page.request.get(`/api/v1/connectors/${key}`);
  if (!res.ok()) return "unknown";
  return (await res.json()).connector.status;
}

async function openIncidentCount(page: import("@playwright/test").Page): Promise<number> {
  const res = await page.request.get(`/api/v1/incidents?status=OPEN&limit=5`);
  if (!res.ok()) return 0;
  return ((await res.json()).data ?? []).length;
}

async function firstOpenIncidentId(page: import("@playwright/test").Page): Promise<string> {
  const res = await page.request.get(`/api/v1/incidents?status=OPEN&limit=1`);
  const body = await res.json();
  const id = body.data?.[0]?.id;
  if (!id) throw new Error("expected an open incident to exist by this point in the flow");
  return id;
}

async function incidentStatus(page: import("@playwright/test").Page, id: string): Promise<string> {
  const res = await page.request.get(`/api/v1/incidents/${id}`);
  if (!res.ok()) return "unknown";
  return (await res.json()).incident.status;
}

async function incidentSummaryStatus(page: import("@playwright/test").Page, id: string): Promise<string> {
  const res = await page.request.get(`/api/v1/incidents/${id}`);
  if (!res.ok()) return "unknown";
  return (await res.json()).incident.aiSummaryStatus;
}

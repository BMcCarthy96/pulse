import { expect, type Page } from "@playwright/test";

export const PERSONAS = {
  admin: "Dana Alvarez",
  ops: "Marcus Webb",
  viewer: "Priya Nair",
} as const;

/**
 * Signs in via the demo persona buttons — the same path the Loom walkthrough uses.
 *
 * Signs out first if a session already exists: the middleware bounces an authenticated visitor
 * away from `/login`, so switching personas mid-flow would otherwise wait forever for persona
 * buttons that are never rendered.
 */
export async function loginAs(page: Page, persona: keyof typeof PERSONAS) {
  await page.goto("/login");

  const signOut = page.getByRole("button", { name: "Sign out" });
  const personaButton = page.getByRole("button", { name: new RegExp(PERSONAS[persona]) });
  // Authenticated visits to /login redirect to the dashboard. Wait until either side of that
  // redirect has rendered before deciding whether a persona switch is required; a one-shot
  // visibility check can race the session redirect and then wait for a login button on the app.
  await expect(signOut.or(personaButton).first()).toBeVisible();
  if (await signOut.isVisible()) {
    await signOut.click();
    await expect(page).toHaveURL(/\/recruiter/);
    await page.goto("/login");
  }

  await expect(personaButton).toBeVisible();
  await personaButton.click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/recruiter/);
}

/**
 * Polls a condition that depends on a background health tick.
 *
 * Playwright's own auto-waiting covers the DOM, but not "the worker has run another tick and
 * written a new row" — that needs a reload between checks, which `expect.poll` does not do.
 */
export async function waitForCondition(
  page: Page,
  check: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; label: string },
) {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(intervalMs);
    await page.reload();
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${opts.label}`);
}

/**
 * Sets a connector's chaos mode through the admin panel, including the confirm dialog.
 * Requires an ADMIN session — the panel is not rendered for anyone else.
 */
export async function setChaosMode(page: Page, connectorKey: string, mode: string) {
  await page.goto(`/connectors/${connectorKey}`);

  const panel = page.getByText("Chaos panel");
  await expect(panel).toBeVisible();

  await page.getByRole("radio", { name: mode, exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Apply chaos mode" }).click();

  await expect(page.getByText(`Current mode: ${mode}`)).toBeVisible({ timeout: 20_000 });
}

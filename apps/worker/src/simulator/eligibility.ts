import { Hono } from "hono";
import { faker } from "@faker-js/faker";
import { eligibilityCheckSchema } from "@pulse/shared";
import { applyChaos } from "./chaos.js";

const CONNECTOR_KEY = "eligibility";

export const eligibilityApp = new Hono();

eligibilityApp.post("/eligibility/check", async (c) => {
  const chaos = await applyChaos(CONNECTOR_KEY, c, { orgId: c.req.header("x-pulse-org-id") });
  if (chaos.response) return chaos.response;

  const body = await c.req.json().catch(() => null);
  const parsed = eligibilityCheckSchema.safeParse(body);
  if (!parsed.success && chaos.mode !== "BAD_PAYLOAD") {
    return c.json({ error: "invalid eligibility request" }, 400);
  }

  if (chaos.mode === "BAD_PAYLOAD") {
    return c.json({ eligible: "yes" }); // wrong type, missing fields
  }

  return c.json({
    eligible: faker.number.float({ min: 0, max: 1 }) < 0.92,
    plan: faker.helpers.arrayElement(["PPO Gold", "HMO Silver", "PPO Bronze", "EPO Standard"]),
    copayCents: faker.number.int({ min: 0, max: 6000 }),
  });
});

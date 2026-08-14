import { Hono } from "hono";
import { faker } from "@faker-js/faker";
import { claimSubmitRequestSchema } from "@pulse/shared";
import { applyChaos } from "./chaos.js";
import { emitWebhook } from "./webhooks.js";
import { log } from "../log.js";

const CONNECTOR_KEY = "claims";

export const clearinghouseApp = new Hono();

clearinghouseApp.post("/clearinghouse/claims", async (c) => {
  const orgId = c.req.header("x-pulse-org-id");
  const chaos = await applyChaos(CONNECTOR_KEY, c, { orgId });
  if (chaos.response) return chaos.response;

  const body = await c.req.json().catch(() => null);
  const parsed = claimSubmitRequestSchema.safeParse(body);
  if (!parsed.success && chaos.mode !== "BAD_PAYLOAD") {
    return c.json({ error: "invalid claim payload" }, 400);
  }

  const claimId = `CLM-${faker.number.int({ min: 100000, max: 999999 })}`;

  if (chaos.mode === "BAD_PAYLOAD") {
    return c.json({ claimId }); // missing required `status`
  }

  const delayMs = faker.number.int({ min: 5000, max: 20000 });
  const accepted = faker.number.float({ min: 0, max: 1 }) < 0.85;
  setTimeout(() => {
    void emitWebhook(
      CONNECTOR_KEY,
      "claim.ack",
      {
        claimId,
        status: accepted ? "accepted" : "rejected",
        reason: accepted ? undefined : "missing prior authorization",
      },
      orgId,
    );
  }, delayMs);

  log.info({ orgId, claimId, delayMs, accepted }, "claim accepted, ack scheduled");
  return c.json({ claimId, status: "accepted" });
});

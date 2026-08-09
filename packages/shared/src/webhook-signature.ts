import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 webhook signing, shared by the simulator (which signs) and the web app's ingest
 * route (which verifies). It lives here rather than in either app because a signing scheme that
 * exists in two copies is a signing scheme that will eventually disagree with itself.
 *
 * Header names are part of the contract (doc 03 §3) and are exported alongside the functions.
 */

export const WEBHOOK_SIGNATURE_HEADER = "x-pulse-signature";
export const WEBHOOK_DELIVERY_HEADER = "x-pulse-delivery";
export const WEBHOOK_EVENT_HEADER = "x-pulse-event";

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Constant-time comparison of the provided signature against the expected one.
 *
 * `Buffer.from(x, "hex")` does not throw on malformed input — it silently stops at the first
 * invalid character, so `"zz"` becomes an empty buffer. That is why the length check below is a
 * correctness requirement and not just a guard for `timingSafeEqual`: without it a garbage
 * signature could be compared against a truncated expectation.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = Buffer.from(signWebhookBody(rawBody, secret), "hex");
  const provided = Buffer.from(signature, "hex");

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

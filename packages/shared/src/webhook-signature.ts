import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 webhook signing, shared by the simulator (which signs) and the web app's ingest
 * route (which verifies). It lives here rather than in either app because a signing scheme that
 * exists in two copies is a signing scheme that will eventually disagree with itself.
 *
 * Header names are part of the contract (doc 03 §3) and are exported alongside the functions.
 */

export const WEBHOOK_SIGNATURE_HEADER = "x-pulse-signature";
export const WEBHOOK_SIGNATURE_V2_HEADER = "x-pulse-signature-v2";
export const WEBHOOK_TIMESTAMP_HEADER = "x-pulse-timestamp";
export const WEBHOOK_DELIVERY_HEADER = "x-pulse-delivery";
export const WEBHOOK_EVENT_HEADER = "x-pulse-event";
export const DEFAULT_LOCAL_WEBHOOK_SECRET = "change-me-local-dev-webhook-secret";

/**
 * Resolve the shared webhook secret without allowing the development placeholder to be used in
 * production. Keeping this check beside the signing helpers prevents the simulator and the
 * receiver from quietly drifting into different fallback behaviour.
 */
export function getWebhookSigningSecret(
  value = process.env.WEBHOOK_SIGNING_SECRET,
  environment = process.env.NODE_ENV,
): string {
  const secret = value?.trim();
  if (secret && !(environment === "production" && secret === DEFAULT_LOCAL_WEBHOOK_SECRET)) {
    return secret;
  }
  if (environment === "production") {
    throw new Error("WEBHOOK_SIGNING_SECRET must be configured in production");
  }
  return DEFAULT_LOCAL_WEBHOOK_SECRET;
}

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function signWebhookBodyV2(
  rawBody: string,
  secret: string,
  timestampSeconds: number,
): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
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

  const expected = Uint8Array.from(Buffer.from(signWebhookBody(rawBody, secret), "hex"));
  const provided = Uint8Array.from(Buffer.from(signature, "hex"));

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function verifyWebhookSignatureV2(
  rawBody: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  skewSeconds = 300,
): boolean {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > skewSeconds
  ) {
    return false;
  }
  const expected = Uint8Array.from(
    Buffer.from(signWebhookBodyV2(rawBody, secret, timestampSeconds), "hex"),
  );
  const provided = Uint8Array.from(Buffer.from(signature.replace(/^v2=/, ""), "hex"));
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

import { describe, expect, it } from "vitest";
import {
  signWebhookBody,
  signWebhookBodyV2,
  verifyWebhookSignature,
  verifyWebhookSignatureV2,
} from "../src/webhook-signature.js";

const SECRET = "test-signing-secret";
const BODY = JSON.stringify({ eventType: "lab.result", patientRef: "PAT-4821", value: 12.4 });

describe("verifyWebhookSignature", () => {
  it("accepts a signature it just produced", () => {
    expect(verifyWebhookSignature(BODY, signWebhookBody(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = signWebhookBody(BODY, SECRET);
    const tampered = BODY.replace("12.4", "99.9");
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const signature = signWebhookBody(BODY, SECRET);
    // Flip one hex digit — same length, so the length guard cannot be what rejects it.
    const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
    expect(flipped).toHaveLength(signature.length);
    expect(verifyWebhookSignature(BODY, flipped, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyWebhookSignature(BODY, signWebhookBody(BODY, "other-secret"), SECRET)).toBe(false);
  });

  it.each([
    ["a missing signature", null],
    ["an undefined signature", undefined],
    ["an empty signature", ""],
    ["a truncated signature", signWebhookBody(BODY, SECRET).slice(0, 32)],
    ["a non-hex signature", "not-a-hex-signature"],
    ["an over-long signature", `${signWebhookBody(BODY, SECRET)}00`],
  ])("rejects %s", (_label, signature) => {
    expect(verifyWebhookSignature(BODY, signature, SECRET)).toBe(false);
  });

  it("does not treat a garbage signature as empty-equals-empty", () => {
    // Buffer.from("zz", "hex") yields an EMPTY buffer rather than throwing. Without the length
    // check, an empty expected buffer would compare equal to it — this pins that behaviour.
    expect(verifyWebhookSignature(BODY, "zzzz", SECRET)).toBe(false);
    expect(verifyWebhookSignature("", "zz", SECRET)).toBe(false);
  });

  it("is body-specific: a valid signature for one delivery does not validate another", () => {
    const replayedSignature = signWebhookBody(BODY, SECRET);
    const differentDelivery = JSON.stringify({ eventType: "lab.result", patientRef: "PAT-9999" });
    expect(verifyWebhookSignature(differentDelivery, replayedSignature, SECRET)).toBe(false);
  });
});

describe("signWebhookBody", () => {
  it("produces a 64-char lowercase hex digest", () => {
    expect(signWebhookBody(BODY, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(signWebhookBody(BODY, SECRET)).toBe(signWebhookBody(BODY, SECRET));
  });

  it("differs per secret and per body", () => {
    expect(signWebhookBody(BODY, SECRET)).not.toBe(signWebhookBody(BODY, "other"));
    expect(signWebhookBody(BODY, SECRET)).not.toBe(signWebhookBody(`${BODY} `, SECRET));
  });
});

describe("timestamped webhook signatures", () => {
  const timestamp = 1_760_000_000;

  it("binds the timestamp and body", () => {
    const signature = signWebhookBodyV2(BODY, SECRET, timestamp);
    expect(verifyWebhookSignatureV2(BODY, signature, String(timestamp), SECRET, timestamp)).toBe(
      true,
    );
    expect(
      verifyWebhookSignatureV2(`${BODY} `, signature, String(timestamp), SECRET, timestamp),
    ).toBe(false);
  });

  it("rejects old, future, missing, and malformed timestamps", () => {
    const signature = signWebhookBodyV2(BODY, SECRET, timestamp);
    expect(
      verifyWebhookSignatureV2(BODY, signature, String(timestamp), SECRET, timestamp + 301),
    ).toBe(false);
    expect(
      verifyWebhookSignatureV2(BODY, signature, String(timestamp), SECRET, timestamp - 301),
    ).toBe(false);
    expect(verifyWebhookSignatureV2(BODY, signature, null, SECRET, timestamp)).toBe(false);
    expect(
      verifyWebhookSignatureV2(BODY, `v2=${signature}`, String(timestamp), SECRET, timestamp),
    ).toBe(true);
  });
});

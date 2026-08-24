import { describe, expect, it } from "vitest";
import { rateLimitClientKey } from "@/lib/rate-limit";

describe("rateLimitClientKey", () => {
  it("uses the right-most proxy hop and hashes untrusted header text", () => {
    const firstSpoof = new Headers({ "x-forwarded-for": "203.0.113.99, 198.51.100.7" });
    const secondSpoof = new Headers({ "x-forwarded-for": "192.0.2.45, 198.51.100.7" });
    const differentEdge = new Headers({ "x-forwarded-for": "203.0.113.99, 198.51.100.8" });

    expect(rateLimitClientKey(firstSpoof)).toBe(rateLimitClientKey(secondSpoof));
    expect(rateLimitClientKey(firstSpoof)).not.toBe(rateLimitClientKey(differentEdge));
    expect(rateLimitClientKey(firstSpoof)).toMatch(/^[a-f0-9]{24}$/);
  });

  it("prefers platform-owned address headers", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "198.51.100.42",
      "x-forwarded-for": "203.0.113.99, 198.51.100.7",
    });
    const differentForwarded = new Headers({
      "x-vercel-forwarded-for": "198.51.100.42",
      "x-forwarded-for": "192.0.2.45, 198.51.100.8",
    });

    expect(rateLimitClientKey(headers)).toBe(rateLimitClientKey(differentForwarded));
  });
});

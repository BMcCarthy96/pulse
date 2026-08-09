import { describe, expect, it } from "vitest";
import { getRedisConnectionOptions } from "../src/redis.js";

describe("getRedisConnectionOptions", () => {
  it("preserves the Redis database selected by the URL", () => {
    expect(getRedisConnectionOptions("redis://:secret@example.test:6380/2")).toEqual({
      host: "example.test",
      port: 6380,
      password: "secret",
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it("uses Redis database zero when the URL has no database path", () => {
    expect(getRedisConnectionOptions("redis://localhost")).toEqual({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });

  it("rejects a non-numeric database path", () => {
    expect(() => getRedisConnectionOptions("redis://localhost/not-a-db")).toThrow(
      "Invalid Redis database",
    );
  });
});

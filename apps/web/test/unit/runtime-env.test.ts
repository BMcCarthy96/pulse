import { describe, expect, it } from "vitest";
import { assertWebRuntimeEnv } from "@/lib/runtime-env";
import { assertWorkerRuntimeEnv } from "../../../worker/src/runtime-env";

const SAFE_WEB_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://pulse:secret@db.example.com:5432/pulse",
  REDIS_URL: "rediss://default:secret@redis.example.com:6379",
  AUTH_SECRET: "a-real-auth-secret-with-at-least-32-bytes",
  AUTH_URL: "https://pulse.example.com",
  WEBHOOK_SIGNING_SECRET: "a-real-webhook-secret-with-32-bytes",
  AI_ENABLED: "false",
  INVESTIGATION_LIVE_ENABLED: "false",
} satisfies NodeJS.ProcessEnv;

const SAFE_WORKER_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: SAFE_WEB_ENV.DATABASE_URL,
  REDIS_URL: SAFE_WEB_ENV.REDIS_URL,
  WEBHOOK_SIGNING_SECRET: SAFE_WEB_ENV.WEBHOOK_SIGNING_SECRET,
  WEBHOOK_TARGET_URL: SAFE_WEB_ENV.AUTH_URL,
} satisfies NodeJS.ProcessEnv;

describe("production runtime configuration", () => {
  it("does not impose production requirements in development", () => {
    expect(() => assertWebRuntimeEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertWorkerRuntimeEnv({ NODE_ENV: "test" })).not.toThrow();
  });

  it("accepts complete public deployment settings", () => {
    expect(() => assertWebRuntimeEnv(SAFE_WEB_ENV)).not.toThrow();
    expect(() => assertWorkerRuntimeEnv(SAFE_WORKER_ENV)).not.toThrow();
  });

  it("rejects loopback and malformed public URLs", () => {
    expect(() =>
      assertWebRuntimeEnv({
        ...SAFE_WEB_ENV,
        DATABASE_URL: "postgresql://pulse:pulse@127.0.0.1:5432/pulse",
        AUTH_URL: "pulse.example.com",
      }),
    ).toThrow(/DATABASE_URL, AUTH_URL/);
    expect(() =>
      assertWorkerRuntimeEnv({
        ...SAFE_WORKER_ENV,
        REDIS_URL: "redis://localhost:6379",
        WEBHOOK_TARGET_URL: "http://0.0.0.0:3010",
      }),
    ).toThrow(/REDIS_URL, WEBHOOK_TARGET_URL/);
  });

  it("rejects short production secrets", () => {
    expect(() => assertWebRuntimeEnv({ ...SAFE_WEB_ENV, AUTH_SECRET: "too-short" })).toThrow(
      /AUTH_SECRET/,
    );
    expect(() =>
      assertWorkerRuntimeEnv({ ...SAFE_WORKER_ENV, WEBHOOK_SIGNING_SECRET: "too-short" }),
    ).toThrow(/WEBHOOK_SIGNING_SECRET/);
  });

  it("requires a provider key whenever live AI is enabled", () => {
    expect(() =>
      assertWebRuntimeEnv({
        ...SAFE_WEB_ENV,
        AI_ENABLED: "true",
        ANTHROPIC_API_KEY: "",
      }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("allows local endpoints only for the explicit browser-test runtime", () => {
    expect(() =>
      assertWebRuntimeEnv({
        ...SAFE_WEB_ENV,
        PULSE_E2E: "true",
        DATABASE_URL: "postgresql://pulse:pulse@127.0.0.1:5432/pulse",
        REDIS_URL: "redis://localhost:6379",
        AUTH_URL: "http://localhost:3010",
      }),
    ).not.toThrow();
    expect(() =>
      assertWorkerRuntimeEnv({
        ...SAFE_WORKER_ENV,
        PULSE_E2E: "true",
        WEBHOOK_TARGET_URL: "http://127.0.0.1:3010",
      }),
    ).not.toThrow();
  });
});

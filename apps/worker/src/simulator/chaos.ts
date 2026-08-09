import type { Context } from "hono";
import { prisma } from "@pulse/db";
import { CHAOS_DEFAULTS } from "@pulse/shared";

export type RNG = () => number;

interface ChaosState {
  mode: string;
  config: { failureRate?: number; latencyMs?: number };
}

const cache = new Map<string, { state: ChaosState; expiresAt: number }>();
const CACHE_TTL_MS = 5000;

export async function getChaosState(connectorKey: string): Promise<ChaosState> {
  const cached = cache.get(connectorKey);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const connector = await prisma.connector.findUnique({ where: { key: connectorKey } });
  const state: ChaosState = connector
    ? { mode: connector.chaosMode, config: (connector.chaosConfig as ChaosState["config"]) ?? {} }
    : { mode: "HEALTHY", config: {} };

  cache.set(connectorKey, { state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}

export function invalidateChaosCache(connectorKey?: string) {
  if (connectorKey) cache.delete(connectorKey);
  else cache.clear();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number, rng: RNG) {
  return Math.floor(min + rng() * (max - min));
}

export interface ChaosResult {
  response: Response | null;
  mode: string;
}

/**
 * Consults the connector's chaos state and, for modes that short-circuit the request
 * (OUTAGE/RATE_LIMIT/AUTH_FAILURE/TIMEOUT), returns a Response the caller should return as-is.
 * For DEGRADED it applies latency + a failure dice-roll. For HEALTHY it applies base jitter.
 * BAD_PAYLOAD never short-circuits here — callers check `mode` and shape a malformed 200 body.
 */
export async function applyChaos(
  connectorKey: string,
  c: Context,
  opts: { rng?: RNG } = {},
): Promise<ChaosResult> {
  const rng = opts.rng ?? Math.random;
  const { mode, config } = await getChaosState(connectorKey);

  switch (mode) {
    case "OUTAGE":
      return { response: c.json({ error: "upstream unavailable" }, 503), mode };

    case "RATE_LIMIT":
      c.header("Retry-After", String(CHAOS_DEFAULTS.rateLimitRetryAfterSec));
      return { response: c.json({ error: "rate limited" }, 429), mode };

    case "AUTH_FAILURE":
      return { response: c.json({ error: "invalid credentials" }, 401), mode };

    case "TIMEOUT":
      await sleep(CHAOS_DEFAULTS.timeoutSleepMs);
      return { response: c.json({ error: "upstream unavailable" }, 503), mode };

    case "DEGRADED": {
      const failureRate = config.failureRate ?? CHAOS_DEFAULTS.degradedFailureRate;
      const latencyMs =
        config.latencyMs ??
        randomBetween(
          CHAOS_DEFAULTS.degradedLatencyMinMs,
          CHAOS_DEFAULTS.degradedLatencyMaxMs,
          rng,
        );
      await sleep(latencyMs);
      if (rng() < failureRate) {
        return { response: c.json({ error: "upstream error" }, 500), mode };
      }
      return { response: null, mode };
    }

    case "BAD_PAYLOAD": {
      const latencyMs = randomBetween(
        CHAOS_DEFAULTS.healthyLatencyMinMs,
        CHAOS_DEFAULTS.healthyLatencyMaxMs,
        rng,
      );
      await sleep(latencyMs);
      return { response: null, mode };
    }

    case "HEALTHY":
    default: {
      const latencyMs = randomBetween(
        CHAOS_DEFAULTS.healthyLatencyMinMs,
        CHAOS_DEFAULTS.healthyLatencyMaxMs,
        rng,
      );
      await sleep(latencyMs);
      return { response: null, mode: "HEALTHY" };
    }
  }
}

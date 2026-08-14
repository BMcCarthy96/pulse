import { Redis } from "ioredis";
import { createHash } from "node:crypto";

const TOKEN_BUCKET_SCRIPT = `
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerMinute = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'timestamp')
local tokens = tonumber(state[1])
local timestamp = tonumber(state[2])
if tokens == nil then tokens = capacity end
if timestamp == nil then timestamp = now end
local elapsed = math.max(0, now - timestamp)
tokens = math.min(capacity, tokens + (elapsed * refillPerMinute / 60000))
local allowed = 0
local retryMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryMs = math.ceil((cost - tokens) * 60000 / refillPerMinute)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'timestamp', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(60000 * capacity / refillPerMinute) + 60000)
return { allowed, math.floor(tokens * 1000), retryMs }
`;

let redis: Redis | null = null;
let connectPromise: Promise<void> | null = null;

/**
 * Use the right-most forwarded hop: on append-style proxies the left-most value is supplied by
 * the client and can be spoofed. Hashing keeps untrusted header text out of Redis keys.
 */
export function rateLimitClientKey(headers: Headers) {
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const address = forwarded?.at(-1) ?? headers.get("x-real-ip")?.trim() ?? "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 24);
}

function client() {
  return (redis ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
  }));
}

async function connected() {
  const connection = client();
  if (connection.status === "ready") return connection;
  connectPromise ??= connection.connect().finally(() => {
    connectPromise = null;
  });
  await connectPromise;
  return connection;
}

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("rate-limit storage unavailable");
    this.name = "RateLimitUnavailableError";
  }
}

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    super("rate limit exceeded");
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

export async function enforceRateLimit(args: {
  key: string;
  capacity: number;
  refillPerMinute: number;
  failClosed?: boolean;
}) {
  try {
    const result = (await connected().then((connection) =>
      connection.eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        `pulse:ratelimit:${args.key}`,
        Date.now(),
        args.capacity,
        args.refillPerMinute,
        1,
      ),
    )) as [number, number, number];
    if (Number(result[0]) !== 1) throw new RateLimitExceededError(Number(result[2]));
    return { remaining: Number(result[1]) / 1000 };
  } catch (error) {
    if (error instanceof RateLimitExceededError) throw error;
    if (args.failClosed) throw new RateLimitUnavailableError();
    return { remaining: args.capacity };
  }
}

export async function enforceAuthenticatedRateLimit(userId: string, failClosed = false) {
  return enforceRateLimit({
    key: `user:${userId}:api`,
    capacity: 300,
    refillPerMinute: 300,
    failClosed,
  });
}

export async function enforceCopilotQuotas(userId: string, orgId: string) {
  await enforceRateLimit({
    key: `user:${userId}:copilot:hour`,
    capacity: 10,
    refillPerMinute: 10 / 60,
    failClosed: true,
  });
  await enforceRateLimit({
    key: `org:${orgId}:copilot:day`,
    capacity: 50,
    refillPerMinute: 50 / (24 * 60),
    failClosed: true,
  });
}

export async function enforceSummaryQuotas(userId: string, orgId: string) {
  await enforceRateLimit({
    key: `user:${userId}:summary:hour`,
    capacity: 3,
    refillPerMinute: 3 / 60,
    failClosed: true,
  });
  await enforceRateLimit({
    key: `org:${orgId}:summary:day`,
    capacity: 20,
    refillPerMinute: 20 / (24 * 60),
    failClosed: true,
  });
}

/** Recruiter demo guardrails: cheap, deterministic caps before a provider call is made. */
export async function enforceInvestigationQuotas(
  userId: string,
  orgId: string,
  demoSessionId?: string,
) {
  await enforceRateLimit({
    key: `user:${userId}:investigation:hour`,
    capacity: 10,
    // Ten requests per rolling hour.
    refillPerMinute: 10 / 60,
    failClosed: true,
  });
  await enforceRateLimit({
    key: `org:${orgId}:investigation:day`,
    capacity: 30,
    // Thirty requests per rolling day.
    refillPerMinute: 30 / (24 * 60),
    failClosed: true,
  });
  if (demoSessionId) {
    await enforceRateLimit({
      key: `demo:${demoSessionId}:investigation:session`,
      capacity: 2,
      // Two recorded/live questions per demo session.
      refillPerMinute: 2 / (60 * 60),
      failClosed: true,
    });
  }
  await enforceRateLimit({
    key: "deployment:investigation:day",
    capacity: 30,
    // Thirty investigations per deployment per rolling day.
    refillPerMinute: 30 / (24 * 60),
    failClosed: true,
  });
}

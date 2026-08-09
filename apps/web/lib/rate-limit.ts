import { Redis } from "ioredis";

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
    refillPerMinute: 10,
    failClosed: true,
  });
  await enforceRateLimit({
    key: `org:${orgId}:copilot:day`,
    capacity: 50,
    refillPerMinute: 50 / 24,
    failClosed: true,
  });
}

export async function enforceSummaryQuotas(userId: string, orgId: string) {
  await enforceRateLimit({
    key: `user:${userId}:summary:hour`,
    capacity: 3,
    refillPerMinute: 3,
    failClosed: true,
  });
  await enforceRateLimit({
    key: `org:${orgId}:summary:day`,
    capacity: 20,
    refillPerMinute: 20 / 24,
    failClosed: true,
  });
}

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}

/**
 * Plain connection options (not a shared ioredis instance) for BullMQ Queue/Worker
 * constructors. Each instance creates its own client internally, matching BullMQ's bundled
 * ioredis version and avoiding cross-version type friction with a directly-constructed
 * ioredis.Redis instance.
 */
export function getRedisConnectionOptions(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const databasePath = url.pathname.replace(/^\/+/, "");
  const db = databasePath === "" ? undefined : Number(databasePath);
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error(`Invalid Redis database in REDIS_URL: ${url.pathname}`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    ...(db === undefined ? {} : { db }),
    maxRetriesPerRequest: null,
  };
}

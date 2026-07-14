export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
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
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

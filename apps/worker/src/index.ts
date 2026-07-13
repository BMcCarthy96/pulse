import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { APP_NAME } from "@pulse/shared";
import { prisma } from "@pulse/db";

import { log } from "./log.js";

const SIMULATOR_PORT = Number(process.env.SIMULATOR_PORT ?? 4001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function main() {
  log.info(`${APP_NAME} worker booted`);

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
  const pong = await redis.ping();
  log.info({ pong }, "redis connection ok");

  await prisma.$queryRaw`SELECT 1`;
  log.info("postgres connection ok");

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));

  const server = serve({ fetch: app.fetch, port: SIMULATOR_PORT }, (info) => {
    log.info({ port: info.port }, "simulator http server listening");
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down worker");
    server.close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error({ err }, "worker failed to boot");
  process.exit(1);
});

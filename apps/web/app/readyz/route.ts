import { NextResponse } from "next/server";
import { Redis } from "ioredis";
import { prisma } from "@pulse/db";

let cached: { at: number; ok: boolean; db: boolean; redis: boolean } | null = null;
const CACHE_MS = 5_000;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(
      { ok: cached.ok, ready: cached.ok, db: cached.db, redis: cached.redis },
      { status: cached.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let db = false;
  let redis = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
  });
  try {
    await client.connect();
    await client.ping();
    redis = true;
  } catch {
    redis = false;
  } finally {
    client.disconnect();
  }
  const ok = db && redis;
  cached = { at: Date.now(), ok, db, redis };
  return NextResponse.json(
    { ok, ready: ok, db, redis },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { Redis } from "ioredis";

let cached: { at: number; ok: boolean; db: boolean; redis: boolean } | null = null;
const CACHE_MS = 5_000;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(
      { ok: cached.ok, db: cached.db, redis: cached.redis },
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

  try {
    const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2000,
    });
    await client.connect();
    await client.ping();
    redis = true;
    await client.quit().catch(() => client.disconnect());
  } catch {
    redis = false;
  }
  const ok = db && redis;
  cached = { at: Date.now(), ok, db, redis };
  return NextResponse.json(
    { ok, db, redis },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

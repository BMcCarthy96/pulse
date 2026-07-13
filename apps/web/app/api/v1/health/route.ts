import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { Redis } from "ioredis";

export async function GET() {
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
    client.disconnect();
  } catch {
    redis = false;
  }

  return NextResponse.json({ ok: db && redis, db, redis }, { status: db && redis ? 200 : 503 });
}

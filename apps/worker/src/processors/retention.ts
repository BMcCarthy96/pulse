import { prisma } from "@pulse/db";

const RETENTION_DAYS = Number(process.env.OPERATIONAL_RETENTION_DAYS ?? "30");
const BATCH_SIZE = 1_000;

async function pruneSnapshots(before: Date) {
  let deleted = 0;
  while (true) {
    const rows = await prisma.healthSnapshot.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return deleted;
    const result = await prisma.healthSnapshot.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;
    if (rows.length < BATCH_SIZE) return deleted;
  }
}

async function pruneLogs(before: Date) {
  let deleted = 0;
  while (true) {
    const rows = await prisma.logEntry.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return deleted;
    const result = await prisma.logEntry.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;
    if (rows.length < BATCH_SIZE) return deleted;
  }
}

export async function runRetentionPrune() {
  const before = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [snapshots, logs] = await Promise.all([pruneSnapshots(before), pruneLogs(before)]);
  return { snapshots, logs, before: before.toISOString() };
}

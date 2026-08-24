import { prisma } from "@pulse/db";

const RETENTION_DAYS = Number(process.env.OPERATIONAL_RETENTION_DAYS ?? "30");
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? "365");
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

async function pruneEvents(before: Date) {
  let deleted = 0;
  while (true) {
    const rows = await prisma.integrationEvent.findMany({
      where: {
        receivedAt: { lt: before },
        status: { in: ["PROCESSED", "FAILED", "INVALID", "DUPLICATE"] },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return deleted;
    const result = await prisma.integrationEvent.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;
    if (rows.length < BATCH_SIZE) return deleted;
  }
}

async function pruneJobs(before: Date) {
  let deleted = 0;
  while (true) {
    const rows = await prisma.job.findMany({
      where: {
        createdAt: { lt: before },
        status: { in: ["SUCCEEDED", "FAILED", "DEAD"] },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return deleted;
    const result = await prisma.job.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;
    if (rows.length < BATCH_SIZE) return deleted;
  }
}

async function pruneAiRuns(before: Date) {
  let deleted = 0;
  while (true) {
    const rows = await prisma.aiRun.findMany({
      where: {
        createdAt: { lt: before },
        status: { in: ["SUCCEEDED", "FAILED", "REFUSED", "CANCELLED", "BUDGET_EXCEEDED"] },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return deleted;
    const result = await prisma.aiRun.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;
    if (rows.length < BATCH_SIZE) return deleted;
  }
}

async function pruneAudit(before: Date) {
  let deleted = 0;
  while (true) {
    const rows = await prisma.auditEntry.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return deleted;
    const result = await prisma.auditEntry.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;
    if (rows.length < BATCH_SIZE) return deleted;
  }
}

export async function runRetentionPrune() {
  const operationalBefore = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const auditBefore = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // Keep live/queued records and investigation context. Terminal rows are safe to remove after
  // their retention window, while audit history gets its own longer policy.
  const [snapshots, logs, events, jobs, aiRuns, audit] = await Promise.all([
    pruneSnapshots(operationalBefore),
    pruneLogs(operationalBefore),
    pruneEvents(operationalBefore),
    pruneJobs(operationalBefore),
    pruneAiRuns(operationalBefore),
    pruneAudit(auditBefore),
  ]);
  return {
    snapshots,
    logs,
    events,
    jobs,
    aiRuns,
    audit,
    operationalBefore: operationalBefore.toISOString(),
    auditBefore: auditBefore.toISOString(),
  };
}

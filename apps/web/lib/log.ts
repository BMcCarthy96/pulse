import pino from "pino";
import { prisma, type LogLevel, type Prisma } from "@pulse/db";

// No pino-pretty transport here (unlike apps/worker): its worker-thread transport conflicts
// with Next.js's own dev-server compilation workers under Fast Refresh, throwing spurious
// "the worker has exited" errors from unrelated route handlers. Plain JSON output is fine for
// route logging; it's the same story in production either way.
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

let cachedOrgId: string | undefined;
async function getOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId;
  const org = await prisma.organization.findFirst();
  cachedOrgId = org?.id;
  return cachedOrgId ?? null;
}

/** Persist a single structured LogEntry (source: "web"). Used sparingly — route-level WARN/ERROR only, not every request. */
export async function logToDb(
  level: LogLevel,
  message: string,
  context: { connectorId?: string; jobId?: string; incidentId?: string; [key: string]: unknown } = {},
) {
  try {
    const orgId = await getOrgId();
    if (!orgId) return;
    const { connectorId, jobId, incidentId, ...rest } = context;
    await prisma.logEntry.create({
      data: { orgId, level, source: "web", connectorId, jobId, incidentId, message, context: rest as Prisma.InputJsonValue },
    });
  } catch (err) {
    log.warn({ err }, "failed to persist LogEntry to DB");
  }
}

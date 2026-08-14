import pino from "pino";
import { prisma, type LogLevel, type Prisma } from "@pulse/db";
import { currentTraceId } from "@pulse/shared";

// No pino-pretty transport here (unlike apps/worker): its worker-thread transport conflicts
// with Next.js's own dev-server compilation workers under Fast Refresh, throwing spurious
// "the worker has exited" errors from unrelated route handlers. Plain JSON output is fine for
// route logging; it's the same story in production either way.
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** Persist a single structured LogEntry (source: "web"). Used sparingly — route-level WARN/ERROR only, not every request. */
export async function logToDb(
  level: LogLevel,
  message: string,
  context: {
    orgId: string;
    connectorId?: string;
    jobId?: string;
    incidentId?: string;
    traceId?: string;
    [key: string]: unknown;
  },
) {
  try {
    const { orgId, connectorId, jobId, incidentId, traceId, ...rest } = context;
    await prisma.logEntry.create({
      data: {
        orgId,
        level,
        source: "web",
        connectorId,
        jobId,
        incidentId,
        traceId: traceId ?? currentTraceId(),
        message,
        context: rest as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    log.warn({ err }, "failed to persist LogEntry to DB");
  }
}

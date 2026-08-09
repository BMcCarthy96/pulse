import pino from "pino";
import { prisma, type LogLevel, type Prisma } from "@pulse/db";
import { currentTraceId } from "@pulse/shared";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});

export interface LogContext {
  connectorId?: string;
  jobId?: string;
  syncRunId?: string;
  incidentId?: string;
  traceId?: string;
  [key: string]: unknown;
}

async function getOrgId(): Promise<string | null> {
  const org = await prisma.organization.findFirst();
  return org?.id ?? null;
}

const pendingEntries: Prisma.LogEntryCreateManyInput[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flush(), 1000);
}

async function flush() {
  flushTimer = null;
  if (pendingEntries.length === 0) return;
  const batch = pendingEntries.splice(0, pendingEntries.length);
  try {
    const orgId = await getOrgId();
    if (!orgId) return; // no org seeded yet — drop rather than block boot logging
    await prisma.logEntry.createMany({ data: batch.map((b) => ({ ...b, orgId })) });
  } catch (err) {
    console.warn("[log] failed to flush LogEntry batch to DB:", err);
  }
}

function queueDbInsert(level: LogLevel, message: string, context: LogContext) {
  const { connectorId, jobId, syncRunId, incidentId, traceId, ...rest } = context;
  pendingEntries.push({
    orgId: "", // filled in at flush time
    level,
    source: "worker",
    connectorId,
    jobId,
    syncRunId,
    incidentId,
    traceId: traceId ?? currentTraceId(),
    message,
    context: rest as object,
  });
  scheduleFlush();
}

type LevelFn = {
  (context: LogContext, message: string): void;
  (message: string): void;
};

function makeLevelFn(level: Uppercase<LogLevel> extends string ? LogLevel : never): LevelFn {
  return ((contextOrMessage: LogContext | string, message?: string) => {
    if (typeof contextOrMessage === "string") {
      pinoLogger[level.toLowerCase() as "debug" | "info" | "warn" | "error"](contextOrMessage);
      return;
    }
    const msg = message ?? "";
    pinoLogger[level.toLowerCase() as "debug" | "info" | "warn" | "error"](contextOrMessage, msg);
    queueDbInsert(level, msg, contextOrMessage);
  }) as LevelFn;
}

export const log = {
  debug: makeLevelFn("DEBUG"),
  info: makeLevelFn("INFO"),
  warn: makeLevelFn("WARN"),
  error: makeLevelFn("ERROR"),
};

export async function flushLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}

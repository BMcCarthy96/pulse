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
  orgId?: string;
  connectorId?: string;
  jobId?: string;
  syncRunId?: string;
  incidentId?: string;
  traceId?: string;
  [key: string]: unknown;
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
    const connectorIds = [
      ...new Set(batch.map((entry) => entry.connectorId).filter(Boolean)),
    ] as string[];
    const jobIds = [...new Set(batch.map((entry) => entry.jobId).filter(Boolean))] as string[];
    const syncRunIds = [
      ...new Set(batch.map((entry) => entry.syncRunId).filter(Boolean)),
    ] as string[];
    const incidentIds = [
      ...new Set(batch.map((entry) => entry.incidentId).filter(Boolean)),
    ] as string[];
    const [connectors, jobs, syncRuns, incidents] = await Promise.all([
      prisma.connector.findMany({
        where: { id: { in: connectorIds } },
        select: { id: true, orgId: true },
      }),
      prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, orgId: true } }),
      prisma.syncRun.findMany({
        where: { id: { in: syncRunIds } },
        select: { id: true, connector: { select: { orgId: true } } },
      }),
      prisma.incident.findMany({
        where: { id: { in: incidentIds } },
        select: { id: true, orgId: true },
      }),
    ]);
    const orgByConnector = new Map(connectors.map((item) => [item.id, item.orgId]));
    const orgByJob = new Map(jobs.map((item) => [item.id, item.orgId]));
    const orgBySyncRun = new Map(syncRuns.map((item) => [item.id, item.connector.orgId]));
    const orgByIncident = new Map(incidents.map((item) => [item.id, item.orgId]));
    const resolved: Prisma.LogEntryCreateManyInput[] = batch.flatMap((entry) => {
      const relationOrgIds = {
        connector: entry.connectorId ? orgByConnector.get(entry.connectorId) : undefined,
        job: entry.jobId ? orgByJob.get(entry.jobId) : undefined,
        syncRun: entry.syncRunId ? orgBySyncRun.get(entry.syncRunId) : undefined,
        incident: entry.incidentId ? orgByIncident.get(entry.incidentId) : undefined,
      };
      const targetOrgId =
        relationOrgIds.connector ||
        relationOrgIds.job ||
        relationOrgIds.syncRun ||
        relationOrgIds.incident;
      // A caller-supplied org is only trusted when it agrees with every durable target. This
      // keeps a stale or malformed context from attaching tenant A's connector to tenant B's log.
      if (
        entry.orgId &&
        Object.values(relationOrgIds).some(
          (relationOrgId) => relationOrgId && relationOrgId !== entry.orgId,
        )
      )
        return [];
      const orgId = entry.orgId || targetOrgId;
      if (!orgId) return [];
      return [
        {
          ...entry,
          orgId,
          // Scalar links are not composite foreign keys. Keep only IDs proven to belong to this
          // tenant; a reset can also remove an optional relation between lookup and insert.
          connectorId: relationOrgIds.connector === orgId ? entry.connectorId : null,
          jobId: relationOrgIds.job === orgId ? entry.jobId : null,
          syncRunId: relationOrgIds.syncRun === orgId ? entry.syncRunId : null,
          incidentId: relationOrgIds.incident === orgId ? entry.incidentId : null,
        },
      ];
    });
    const orgIds = [...new Set(resolved.map((entry) => entry.orgId))];
    const existingOrganizations = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true },
    });
    const existingOrgIds = new Set(existingOrganizations.map((item) => item.id));
    // Demo tenants are intentionally disposable. If one disappears while its worker log is
    // buffered, drop only that orphaned entry instead of failing the entire createMany batch.
    const data = resolved.filter((entry) => existingOrgIds.has(entry.orgId));
    if (data.length > 0) {
      try {
        await prisma.logEntry.createMany({ data });
      } catch (err) {
        // A demo reset can delete a connector between the lookup above and this batch insert.
        // Preserve the tenant-scoped log and drop only the now-stale optional relation.
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: unknown }).code === "P2003"
        ) {
          await prisma.logEntry.createMany({
            data: data.map(({ connectorId: _connectorId, ...entry }) => ({
              ...entry,
              connectorId: null,
            })),
          });
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.warn("[log] failed to flush LogEntry batch to DB:", err);
  }
}

function queueDbInsert(level: LogLevel, message: string, context: LogContext) {
  const { orgId, connectorId, jobId, syncRunId, incidentId, traceId, ...rest } = context;
  pendingEntries.push({
    orgId: orgId ?? "", // resolved from the scoped target at flush time when absent
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

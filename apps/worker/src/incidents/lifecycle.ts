import { prisma, type Prisma } from "@pulse/db";
import {
  getHealthConfig,
  incidentStatusChangeMessage,
  INCIDENT_ACTIVE_STATUSES,
  MONITORING_ENTRY_SUFFIX,
  type ConnectorStatusValue,
} from "@pulse/shared";
import { log } from "../log.js";
import { enqueueIncidentSummary } from "../queues.js";

const ACTIVE_STATUSES = INCIDENT_ACTIVE_STATUSES;

type IncidentRow = Awaited<ReturnType<typeof prisma.incident.findFirst>>;

/** Accepts either the client or a transaction client — both expose this one create. */
type TimelineWriter = Pick<Prisma.TransactionClient, "incidentTimelineEntry">;

async function addTimelineEntry(
  db: TimelineWriter,
  incidentId: string,
  kind: string,
  message: string,
  actor = "system",
) {
  await db.incidentTimelineEntry.create({ data: { incidentId, kind, message, actor } });
}

/**
 * doc 03 §5: exactly one non-RESOLVED incident per connector. The re-check inside the
 * transaction is what enforces it — Serializable isolation makes two concurrent ticks
 * conflict rather than both insert.
 */
async function openIncident(args: {
  connectorId: string;
  orgId: string;
  connectorName: string;
  severity: "CRITICAL" | "WARNING";
  status: ConnectorStatusValue;
  previousStatus: ConnectorStatusValue;
}): Promise<IncidentRow | null> {
  const incident = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.incident.findFirst({
        where: { connectorId: args.connectorId, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (existing) return null;

      const created = await tx.incident.create({
        data: {
          orgId: args.orgId,
          connectorId: args.connectorId,
          severity: args.severity,
          status: "OPEN",
          title: `${args.connectorName} is ${args.status}`,
          detectionSource: "health-engine",
          // "queued", not "none": a summary job is enqueued unconditionally a few lines below,
          // so the incident *is* waiting on one. Leaving it "none" made the card claim no
          // summary had been requested for as long as the worker was busy or down — the one
          // situation where an operator most wants to know something is pending.
          aiSummaryStatus: "queued",
        },
      });
      await addTimelineEntry(
        tx,
        created.id,
        "opened",
        `${args.severity} incident opened: ${args.connectorName} went ${args.status}`,
      );
      // The transition that caused it, recorded in its own right — the tick that opens an
      // incident would otherwise be the one tick whose health change left no entry. A
      // sustained-DEGRADED incident opens on a tick where nothing *changed*, so describe the
      // duration instead of writing a meaningless "DEGRADED → DEGRADED".
      await addTimelineEntry(
        tx,
        created.id,
        "health_transition",
        args.previousStatus === args.status
          ? `health has been ${args.status} for the full sustained window`
          : `health ${args.previousStatus} → ${args.status}`,
      );
      return created;
    },
    { isolationLevel: "Serializable" },
  );

  if (!incident) return null;

  log.warn(
    { connectorId: args.connectorId, incidentId: incident.id },
    `incident opened (${args.severity}): ${incident.title}`,
  );
  await enqueueIncidentSummary(incident.id);
  return incident;
}

/** Newest first — used to find when the incident entered MONITORING. */
async function lastEnteredMonitoringAt(incidentId: string): Promise<Date | null> {
  const entry = await prisma.incidentTimelineEntry.findFirst({
    where: { incidentId, kind: "status_change", message: { endsWith: MONITORING_ENTRY_SUFFIX } },
    orderBy: { createdAt: "desc" },
  });
  return entry?.createdAt ?? null;
}

/**
 * Was this incident OPEN or ACKNOWLEDGED before it went MONITORING? `acknowledgedAt` is the
 * durable record of that, so no extra column is needed to roll back correctly.
 */
function preMonitoringStatus(incident: { acknowledgedAt: Date | null }): "OPEN" | "ACKNOWLEDGED" {
  return incident.acknowledgedAt ? "ACKNOWLEDGED" : "OPEN";
}

async function transition(
  incidentId: string,
  from: string,
  to: "OPEN" | "ACKNOWLEDGED" | "MONITORING" | "RESOLVED",
  extra: { note?: string; connectorId?: string } = {},
) {
  const changed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.incident.updateMany({
      where: { id: incidentId, status: from as "OPEN" | "ACKNOWLEDGED" | "MONITORING" },
      data: { status: to, ...(to === "RESOLVED" ? { resolvedAt: new Date() } : {}) },
    });
    if (claimed.count !== 1) return false;
    await addTimelineEntry(tx, incidentId, "status_change", incidentStatusChangeMessage(from, to));
    if (extra.note) await addTimelineEntry(tx, incidentId, "health_transition", extra.note);
    return true;
  });
  if (changed) {
    log.info({ incidentId, connectorId: extra.connectorId }, `incident ${from} → ${to}`);
  }
  return changed;
}

/**
 * Called by the health engine on every tick, whether or not the status changed — the
 * MONITORING → RESOLVED step is time-based and needs a tick even when nothing moved.
 */
export async function runIncidentLifecycle(args: {
  connectorId: string;
  orgId: string;
  connectorName: string;
  status: ConnectorStatusValue;
  previousStatus: ConnectorStatusValue;
  statusChanged: boolean;
  now: Date;
}) {
  const cfg = getHealthConfig();
  const active = await prisma.incident.findFirst({
    where: { connectorId: args.connectorId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { openedAt: "desc" },
  });

  const healthy = args.status === "HEALTHY" || args.status === "PAUSED";

  // ── No active incident: does this tick open one? ──────────────────────────
  if (!active) {
    if (args.status === "DOWN") {
      await openIncident({ ...args, severity: "CRITICAL" });
      return;
    }
    if (
      args.status === "DEGRADED" &&
      (await degradedIsSustained(args.connectorId, args.now, cfg.degradedSustainedMinutes))
    ) {
      await openIncident({ ...args, severity: "WARNING" });
    }
    return;
  }

  // ── Active incident: drive it toward resolution ───────────────────────────
  if (healthy && (active.status === "OPEN" || active.status === "ACKNOWLEDGED")) {
    await transition(active.id, active.status, "MONITORING", {
      connectorId: args.connectorId,
      note: `connector recovered to ${args.status}; watching for ${cfg.monitoringStabilityMinutes} min`,
    });
    return;
  }

  if (active.status === "MONITORING") {
    if (!healthy) {
      const back = preMonitoringStatus(active);
      await transition(active.id, "MONITORING", back, {
        connectorId: args.connectorId,
        note: `connector went ${args.status} again during the monitoring window`,
      });
      return;
    }

    const since = (await lastEnteredMonitoringAt(active.id)) ?? active.openedAt;
    const stableForMs = args.now.getTime() - since.getTime();
    if (stableForMs >= cfg.monitoringStabilityMinutes * 60_000) {
      await transition(active.id, "MONITORING", "RESOLVED", {
        connectorId: args.connectorId,
        note: `stable for ${cfg.monitoringStabilityMinutes} min — auto-resolved`,
      });
      await enqueueIncidentSummary(active.id, { reason: "resolution" });
    }
    return;
  }

  // Still unhealthy with an OPEN/ACKNOWLEDGED incident: nothing to do. Escalating
  // WARNING → CRITICAL is deliberately not in doc 03 §5, so it is not invented here.
  if (args.statusChanged) {
    await addTimelineEntry(
      prisma,
      active.id,
      "health_transition",
      `health ${args.previousStatus} → ${args.status}`,
    );
  }
}

/**
 * doc 03 §5: "two+ consecutive degraded snapshots >= 10 min apart". Walks back through the
 * contiguous run of DEGRADED snapshots and asks whether the run is old enough.
 */
async function degradedIsSustained(
  connectorId: string,
  now: Date,
  sustainedMinutes: number,
): Promise<boolean> {
  const recent = await prisma.healthSnapshot.findMany({
    where: { connectorId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const run: typeof recent = [];
  for (const snap of recent) {
    if (snap.status !== "DEGRADED") break;
    run.push(snap);
  }
  if (run.length < 2) return false;

  const oldest = run[run.length - 1];
  return now.getTime() - oldest.createdAt.getTime() >= sustainedMinutes * 60_000;
}

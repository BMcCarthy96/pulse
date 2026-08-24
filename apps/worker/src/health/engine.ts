import { prisma } from "@pulse/db";
import { getHealthConfig, type ConnectorStatusValue } from "@pulse/shared";
import { log } from "../log.js";
import { runIncidentLifecycle } from "../incidents/lifecycle.js";
import { buildWindow, computeStatus, errorRateOf, type HealthCall } from "./rules.js";

interface ErrorHistoryEntry {
  at?: string;
  durationMs?: number;
}

/**
 * One job row is not one upstream call. doc 03 §4 counts *attempts*: a sync page that burned
 * five retries against a dead upstream hit it five times, and the health engine has to see all
 * five — otherwise a total outage looks like a single failure and never trips the
 * consecutiveFailures >= 5 rule. `errorHistory` carries one entry per failed attempt, so it is
 * the source of truth; jobs without it (seeded rows) fall back to a single call.
 */
function jobToCalls(
  job: {
    createdAt: Date;
    status: string;
    attempts: number;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorHistory: unknown;
  },
  since: Date,
): HealthCall[] {
  const history: ErrorHistoryEntry[] = Array.isArray(job.errorHistory)
    ? (job.errorHistory as ErrorHistoryEntry[])
    : [];
  const failedAttempts: HealthCall[] = history
    .map((entry) => ({
      at: entry.at ? new Date(entry.at) : (job.finishedAt ?? job.startedAt ?? job.createdAt),
      failed: true,
      durationMs: typeof entry.durationMs === "number" ? entry.durationMs : null,
    }))
    .filter((call) => call.at > since);

  // A durable row whose Redis dispatch failed is operator-visible, but it never reached an
  // upstream processor and therefore must not poison connector health.
  if (job.attempts === 0 && job.startedAt === null && failedAttempts.length === 0) return [];

  const succeeded = job.status === "SUCCEEDED";
  if (succeeded) {
    failedAttempts.push({
      at: job.finishedAt ?? job.startedAt ?? job.createdAt,
      failed: false,
      durationMs:
        job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    });
  }

  if (failedAttempts.length > 0) return failedAttempts;

  // Queued/active work has not produced an upstream call yet. Counting it as a successful
  // request makes a live outage look healthy while work is still waiting in Redis.
  if (job.status === "QUEUED" || job.status === "ACTIVE") return [];

  // No attempt history at all (for example a seeded terminal row): count the row once.
  return [
    {
      at: job.finishedAt ?? job.startedAt ?? job.createdAt,
      failed: job.status === "FAILED" || job.status === "DEAD",
      durationMs:
        job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    },
  ];
}

/**
 * Jobs and events in the window, flattened into the calls `buildWindow` understands.
 * doc 03 §4: DEAD/FAILED attempts count as calls; job duration is startedAt→finishedAt.
 */
async function loadCalls(connectorId: string, since: Date): Promise<HealthCall[]> {
  const [jobs, events] = await Promise.all([
    prisma.job.findMany({
      where: {
        connectorId,
        OR: [
          { createdAt: { gt: since } },
          { startedAt: { gt: since } },
          { finishedAt: { gt: since } },
        ],
      },
      select: {
        createdAt: true,
        status: true,
        attempts: true,
        startedAt: true,
        finishedAt: true,
        errorHistory: true,
      },
    }),
    prisma.integrationEvent.findMany({
      where: { connectorId, receivedAt: { gt: since } },
      select: { receivedAt: true, processedAt: true, status: true },
    }),
  ]);

  const jobCalls: HealthCall[] = jobs.flatMap((job) => jobToCalls(job, since));

  const eventCalls: HealthCall[] = events.map((e) => ({
    at: e.receivedAt,
    failed: e.status === "FAILED" || e.status === "INVALID",
    durationMs: e.processedAt ? e.processedAt.getTime() - e.receivedAt.getTime() : null,
  }));

  return [...jobCalls, ...eventCalls];
}

/** One connector, one tick: compute → snapshot → (maybe) status change → lifecycle. */
async function tickConnector(
  connector: {
    id: string;
    orgId: string;
    key: string;
    displayName: string;
    status: ConnectorStatusValue;
    paused: boolean;
  },
  now: Date,
) {
  const cfg = getHealthConfig();
  const windowStart = new Date(now.getTime() - cfg.windowMinutes * 60_000);

  const calls = await loadCalls(connector.id, windowStart);
  const window = buildWindow(calls, now, cfg.windowMinutes);
  const status = computeStatus(
    window,
    { paused: connector.paused, previousStatus: connector.status },
    cfg,
  );

  await prisma.healthSnapshot.create({
    data: {
      connectorId: connector.id,
      status,
      errorRate: errorRateOf(window),
      p95LatencyMs: window.p95LatencyMs,
      totalCalls: window.totalCalls,
      failedCalls: window.failedCalls,
      windowStart,
      windowEnd: now,
    },
  });

  const statusChanged = status !== connector.status;
  if (statusChanged) {
    await prisma.connector.update({ where: { id: connector.id }, data: { status } });
    const message = `${connector.key}: health ${connector.status} → ${status} (${window.failedCalls}/${window.totalCalls} failed in ${cfg.windowMinutes}m)`;
    if (status === "HEALTHY") log.info({ connectorId: connector.id }, message);
    else log.warn({ connectorId: connector.id }, message);
  }

  await runIncidentLifecycle({
    connectorId: connector.id,
    orgId: connector.orgId,
    connectorName: connector.displayName,
    status,
    previousStatus: connector.status,
    statusChanged,
    now,
  });
}

export async function runHealthTick() {
  const now = new Date();
  const connectors = await prisma.connector.findMany({
    select: {
      id: true,
      orgId: true,
      key: true,
      displayName: true,
      status: true,
      paused: true,
      org: { select: { demoSession: { select: { status: true } } } },
    },
  });

  for (const connector of connectors) {
    // Recruiter tenants are compact deterministic fixtures. Background snapshots would make the
    // cited evidence board drift while someone is reviewing it; explicit demo actions remain
    // available, and ordinary tenant connectors continue through the production health engine.
    if (connector.org.demoSession?.status === "ACTIVE") continue;
    try {
      await tickConnector(connector, now);
    } catch (err) {
      // One bad connector must not stop the tick for the rest.
      log.error(
        { connectorId: connector.id, err: err instanceof Error ? err.message : String(err) },
        `${connector.key}: health tick failed`,
      );
    }
  }
}

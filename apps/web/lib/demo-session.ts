import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pulse/db";
import { CONNECTOR_DEFS } from "@pulse/shared";

const DEMO_TTL_MS = 60 * 60 * 1_000;
const MAX_ACTIVE_DEMO_SESSIONS = 25;

function demoEnabled() {
  return process.env.DEMO_MODE === "true";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function demoOrgSlug() {
  return `demo-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

/**
 * Creates a small, isolated tenant instead of sharing the seeded Lakeview tenant. The data is
 * intentionally compact so a recruiter can get from the login button to the investigation in
 * one request, while every row still carries an org boundary for the same queries used in prod.
 */
export async function provisionDemoSession() {
  if (!demoEnabled()) return null;
  const now = new Date();
  const sessionId = randomUUID();
  const tokenHash = sha256(sessionId);
  const expiresAt = new Date(now.getTime() + DEMO_TTL_MS);
  const orgSlug = demoOrgSlug();
  const connectorRows = CONNECTOR_DEFS.slice(0, 4);

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize capacity checks across concurrent recruiter clicks. A plain count-then-create
      // allows a burst to exceed the deployment-wide 25-tenant limit.
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('pulse:demo-capacity'))");
      const active = await tx.demoSession.count({
        where: { status: "ACTIVE", expiresAt: { gt: now } },
      });
      if (active >= MAX_ACTIVE_DEMO_SESSIONS) throw new Error("DEMO_CAPACITY");

      const org = await tx.organization.create({
        data: { name: "Pulse Recruiter Demo", slug: orgSlug },
      });
      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email: `${sessionId}@demo.pulse.local`,
          name: "Demo Operator",
          role: "OPS",
          passwordHash: sha256(`${sessionId}:demo`),
        },
      });
      const connectors = await Promise.all(
        connectorRows.map((def) =>
          tx.connector.create({
            data: {
              orgId: org.id,
              key: def.key,
              displayName: def.displayName,
              description: def.description,
              kind: def.kind,
              syncIntervalSec: def.syncIntervalSec,
              status: def.key === "ehr-fhir" ? "DOWN" : "HEALTHY",
              chaosMode: def.key === "ehr-fhir" ? "OUTAGE" : "HEALTHY",
            },
          }),
        ),
      );
      const ehr = connectors.find((connector) => connector.key === "ehr-fhir")!;
      const openedAt = new Date(now.getTime() - 12 * 60_000);
      const incident = await tx.incident.create({
        data: {
          orgId: org.id,
          connectorId: ehr.id,
          status: "OPEN",
          severity: "CRITICAL",
          title: "Mercy General EHR sync is failing",
          openedAt,
          detectionSource: "health-engine",
          timeline: {
            create: [
              {
                kind: "opened",
                message:
                  "Incident opened after the EHR connector crossed the error-rate threshold.",
                actor: "system",
                createdAt: openedAt,
              },
              {
                kind: "health_transition",
                message: "Upstream returned repeated 503 responses during scheduled syncs.",
                actor: "system",
                createdAt: new Date(openedAt.getTime() + 2 * 60_000),
              },
            ],
          },
        },
      });
      await tx.job.create({
        data: {
          orgId: org.id,
          connectorId: ehr.id,
          queue: "sync",
          type: "sync.page",
          status: "DEAD",
          attempts: 5,
          maxAttempts: 5,
          payload: { page: 1, connectorKey: "ehr-fhir", demo: true },
          lastError: "upstream 503: service unavailable",
          errorHistory: [
            { attempt: 1, message: "upstream 503: service unavailable" },
            { attempt: 2, message: "upstream 503: service unavailable" },
            { attempt: 3, message: "upstream 503: service unavailable" },
            { attempt: 4, message: "upstream 503: service unavailable" },
            { attempt: 5, message: "upstream 503: service unavailable" },
          ],
          createdAt: new Date(openedAt.getTime() + 3 * 60_000),
          updatedAt: new Date(openedAt.getTime() + 3 * 60_000),
        },
      });
      await tx.job.create({
        data: {
          orgId: org.id,
          connectorId: ehr.id,
          queue: "sync",
          type: "sync.page",
          status: "FAILED",
          attempts: 3,
          maxAttempts: 5,
          payload: { page: 2, connectorKey: "ehr-fhir", demo: true },
          lastError: "upstream 503: service unavailable",
          errorHistory: [{ attempt: 3, message: "upstream 503: service unavailable" }],
          createdAt: new Date(openedAt.getTime() + 4 * 60_000),
          updatedAt: new Date(openedAt.getTime() + 4 * 60_000),
        },
      });
      await tx.logEntry.createMany({
        data: [
          {
            orgId: org.id,
            connectorId: ehr.id,
            incidentId: incident.id,
            level: "ERROR",
            source: "worker",
            message: "sync.page failed after retry budget exhausted",
            context: { statusCode: 503, upstream: "ehr-fhir" },
            createdAt: new Date(openedAt.getTime() + 4 * 60_000),
          },
          {
            orgId: org.id,
            connectorId: ehr.id,
            incidentId: incident.id,
            level: "WARN",
            source: "health-engine",
            message: "error rate 100% across the last health window",
            context: { errorRate: 1, p95LatencyMs: 5000 },
            createdAt: new Date(openedAt.getTime() + 5 * 60_000),
          },
        ],
      });
      await tx.integrationEvent.create({
        data: {
          orgId: org.id,
          connectorId: ehr.id,
          direction: "OUTBOUND",
          eventType: "sync.page.requested",
          dedupeKey: `${sessionId}:sync-page-1`,
          status: "FAILED",
          payload: { page: 1, recordCount: 42, demo: true },
          error: "upstream 503: service unavailable",
          receivedAt: new Date(openedAt.getTime() + 3 * 60_000),
        },
      });
      await tx.healthSnapshot.createMany({
        data: [
          {
            connectorId: ehr.id,
            status: "HEALTHY",
            errorRate: 0.01,
            p95LatencyMs: 240,
            totalCalls: 100,
            failedCalls: 1,
            windowStart: new Date(openedAt.getTime() - 15 * 60_000),
            windowEnd: openedAt,
          },
          {
            connectorId: ehr.id,
            status: "DOWN",
            errorRate: 1,
            p95LatencyMs: 5000,
            totalCalls: 10,
            failedCalls: 10,
            windowStart: openedAt,
            windowEnd: new Date(openedAt.getTime() + 15 * 60_000),
          },
        ],
      });
      const demoSession = await tx.demoSession.create({
        data: {
          id: sessionId,
          orgId: org.id,
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
      return { id: demoSession.id, orgId: org.id, user };
    });
  } catch (error) {
    // A capacity race should not leave a partially-created tenant behind.
    if (error instanceof Error && error.message.includes("DEMO_CAPACITY")) throw error;
    throw error;
  }
}

export async function resetDemoSession(orgId: string, userId: string) {
  if (!demoEnabled()) throw new Error("DEMO_DISABLED");
  const session = await prisma.demoSession.findFirst({
    where: { orgId, userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { id: true, orgId: true },
  });
  if (!session) return false;
  await prisma.$transaction(async (tx) => {
    await tx.investigation.deleteMany({ where: { orgId } });
    await tx.connector.updateMany({
      where: { orgId },
      data: { status: "HEALTHY", chaosMode: "HEALTHY", paused: false },
    });
    await tx.connector.updateMany({
      where: { orgId, key: "ehr-fhir" },
      data: { status: "DOWN", chaosMode: "OUTAGE", paused: false },
    });
    await tx.incident.updateMany({
      where: { orgId },
      data: { status: "OPEN", acknowledgedAt: null, resolvedAt: null },
    });
    await tx.job.updateMany({
      where: { orgId, type: "sync.page" },
      data: { status: "DEAD", attempts: 5, lastError: "upstream 503: service unavailable" },
    });
  });
  return true;
}

export function demoTokenHash(value: string) {
  return sha256(value);
}

export type DemoProvisionedUser = Awaited<ReturnType<typeof provisionDemoSession>>;

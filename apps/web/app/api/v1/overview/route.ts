import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { handleApiError, requireSession } from "@/lib/authz";

export const GET = handleApiError("overview", async () => {
  const session = await requireSession();
  const orgId = session.user.orgId;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const connectors = await prisma.connector.findMany({ where: { orgId }, orderBy: { key: "asc" } });

  const perConnector = await Promise.all(
    connectors.map(async (c) => {
      const [snapshot, openIncident, lastJob, lastEvent] = await Promise.all([
        prisma.healthSnapshot.findFirst({
          where: { connectorId: c.id, connector: { orgId } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.incident.findFirst({
          where: { orgId, connectorId: c.id, status: { not: "RESOLVED" } },
        }),
        prisma.job.findFirst({
          where: { orgId, connectorId: c.id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.integrationEvent.findFirst({
          where: { orgId, connectorId: c.id },
          orderBy: { receivedAt: "desc" },
        }),
      ]);
      const lastActivity = [lastJob?.createdAt, lastEvent?.receivedAt]
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        key: c.key,
        displayName: c.displayName,
        kind: c.kind,
        status: c.status,
        paused: c.paused,
        errorRate: snapshot?.errorRate ?? 0,
        lastActivity: lastActivity ?? null,
        openIncidentId: openIncident?.id ?? null,
      };
    }),
  );

  const [deadJobs, openIncidents, eventsLastHour, jobsLastHour, recentIncidents] =
    await Promise.all([
      prisma.job.count({ where: { orgId, status: "DEAD" } }),
      prisma.incident.count({ where: { orgId, status: { not: "RESOLVED" } } }),
      prisma.integrationEvent.count({ where: { orgId, receivedAt: { gte: oneHourAgo } } }),
      prisma.job.count({ where: { orgId, createdAt: { gte: oneHourAgo } } }),
      prisma.incident.findMany({
        where: { orgId },
        orderBy: { openedAt: "desc" },
        take: 5,
        include: { connector: { select: { key: true, displayName: true } } },
      }),
    ]);

  return NextResponse.json({
    connectors: perConnector,
    totals: { deadJobs, openIncidents, eventsLastHour, jobsLastHour },
    recentIncidents: recentIncidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      connectorKey: i.connector.key,
      connectorDisplayName: i.connector.displayName,
      openedAt: i.openedAt,
      resolvedAt: i.resolvedAt,
    })),
  });
});

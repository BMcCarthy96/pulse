import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";

export const GET = handleApiError("incidents.detail", async (_req, ctx) => {
  await requireSession();
  const { id } = await ctx.params;

  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      connector: {
        select: { key: true, displayName: true, kind: true, status: true, chaosMode: true },
      },
      timeline: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);

  // Context panel (doc 05): what was failing while this incident was open.
  const windowEnd = incident.resolvedAt ?? new Date();
  const [failedJobs, errorLogs] = await Promise.all([
    prisma.job.count({
      where: {
        connectorId: incident.connectorId,
        status: { in: ["FAILED", "DEAD"] },
        createdAt: { gte: incident.openedAt, lte: windowEnd },
      },
    }),
    prisma.logEntry.count({
      where: {
        connectorId: incident.connectorId,
        level: "ERROR",
        createdAt: { gte: incident.openedAt, lte: windowEnd },
      },
    }),
  ]);

  return NextResponse.json({ incident, context: { failedJobs, errorLogs, windowEnd } });
});

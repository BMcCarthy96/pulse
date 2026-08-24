import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, incidentStatusChangeMessage } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";

export const POST = handleApiError("incidents.resolve", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const incident = await prisma.incident.findFirst({ where: { id, orgId: session.user.orgId } });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);
  if (incident.status === "RESOLVED") throw ApiError.conflict("incident is already resolved");

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.incident.updateMany({
      where: { id, orgId: session.user.orgId, status: incident.status },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (claimed.count !== 1) throw ApiError.conflict("incident changed before it was resolved");
    await tx.incidentTimelineEntry.create({
      data: {
        incidentId: id,
        kind: "status_change",
        message: incidentStatusChangeMessage(incident.status, "RESOLVED"),
        actor: session.user.id,
      },
    });
    await tx.incidentTimelineEntry.create({
      data: {
        incidentId: id,
        kind: "note",
        message: `manually resolved by ${session.user.name ?? session.user.email}`,
        actor: session.user.id,
      },
    });
    await tx.auditEntry.create({
      data: {
        orgId: session.user.orgId,
        userId: session.user.id,
        action: "incident.resolve",
        targetType: "incident",
        targetId: id,
        metadata: { from: incident.status, manual: true },
      },
    });
    return tx.incident.findUniqueOrThrow({ where: { id } });
  });

  return NextResponse.json({ incident: updated });
});

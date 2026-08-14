import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, incidentStatusChangeMessage } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

export const POST = handleApiError("incidents.acknowledge", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const incident = await prisma.incident.findFirst({ where: { id, orgId: session.user.orgId } });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);
  if (incident.status === "RESOLVED") throw ApiError.conflict("incident is already resolved");
  if (incident.status === "ACKNOWLEDGED")
    throw ApiError.conflict("incident is already acknowledged");

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.incident.update({
      where: { id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: incident.acknowledgedAt ?? new Date() },
    });
    await tx.incidentTimelineEntry.create({
      data: {
        incidentId: id,
        kind: "status_change",
        message: incidentStatusChangeMessage(incident.status, "ACKNOWLEDGED"),
        actor: session.user.id,
      },
    });
    await tx.incidentTimelineEntry.create({
      data: {
        incidentId: id,
        kind: "note",
        message: `acknowledged by ${session.user.name ?? session.user.email}`,
        actor: session.user.id,
      },
    });
    return next;
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "incident.acknowledge",
    targetType: "incident",
    targetId: id,
    metadata: { from: incident.status },
  });

  return NextResponse.json({ incident: updated });
});

import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, addIncidentNoteSchema } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

export const POST = handleApiError("incidents.note", async (req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);

  const body = addIncidentNoteSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const entry = await prisma.incidentTimelineEntry.create({
    data: { incidentId: id, kind: "note", message: body.data.message, actor: session.user.id },
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "incident.note",
    targetType: "incident",
    targetId: id,
    metadata: { length: body.data.message.length },
  });

  return NextResponse.json({ entry });
});

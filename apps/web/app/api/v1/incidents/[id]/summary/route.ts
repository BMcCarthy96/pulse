import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { ApiError, editSummarySchema } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

export const PATCH = handleApiError("incidents.summary_edit", async (req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const incident = await prisma.incident.findFirst({
    where: { id, orgId: session.user.orgId },
  });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);
  if (incident.aiSummaryStatus !== "ready" && incident.aiSummaryStatus !== "edited") {
    throw ApiError.conflict("there is no generated summary to edit yet");
  }

  const body = editSummarySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const current = (incident.aiSummary ?? {}) as Record<string, unknown>;
  // doc 03 §6.6: keep the original. Only the first edit captures it — editing twice must not
  // overwrite the machine-generated version with the previous human one.
  const original = current.original ?? {
    summary: current.summary,
    probableCause: current.probableCause,
    impact: current.impact,
    suggestedSteps: current.suggestedSteps,
    confidence: current.confidence,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.incident.update({
      where: { id },
      data: {
        aiSummaryStatus: "edited",
        aiSummary: {
          ...current,
          ...body.data,
          original,
          editedBy: session.user.name ?? session.user.email,
          editedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await tx.incidentTimelineEntry.create({
      data: {
        incidentId: id,
        kind: "ai_summary",
        message: `summary edited by ${session.user.name ?? session.user.email}`,
        actor: session.user.id,
      },
    });
    return next;
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "incident.summary_edit",
    targetType: "incident",
    targetId: id,
    metadata: { firstEdit: current.original === undefined },
  });

  return NextResponse.json({ incident: updated });
});

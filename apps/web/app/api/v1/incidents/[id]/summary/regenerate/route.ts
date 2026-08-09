import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { enqueueSummaryRun } from "@/lib/ai-runs";

export const POST = handleApiError("incidents.summary_regenerate", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const incident = await prisma.incident.findFirst({
    where: { id, orgId: session.user.orgId },
  });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);
  if (incident.aiSummaryStatus === "generating") {
    throw ApiError.conflict("a summary is already being generated for this incident");
  }
  const activeRun = await prisma.aiRun.findFirst({
    where: {
      orgId: session.user.orgId,
      incidentId: id,
      kind: "SUMMARY",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    select: { id: true },
  });
  if (activeRun) throw ApiError.conflict("a summary is already queued for this incident");

  await prisma.incident.update({ where: { id }, data: { aiSummaryStatus: "queued" } });
  const queued = await enqueueSummaryRun({
    incidentId: id,
    orgId: session.user.orgId,
    reason: "manual",
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "incident.summary_regenerate",
    targetType: "incident",
    targetId: id,
    metadata: { previousStatus: incident.aiSummaryStatus, runId: queued.runId },
  });

  return NextResponse.json({ status: "queued", runId: queued.runId }, { status: 202 });
});

import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, INCIDENT_SUMMARY_JOB_OPTS } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { incidentSummaryQueue } from "@/lib/queue";

export const POST = handleApiError("incidents.summary_regenerate", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) throw ApiError.notFound(`incident "${id}" not found`);
  if (incident.aiSummaryStatus === "generating") {
    throw ApiError.conflict("a summary is already being generated for this incident");
  }

  await prisma.incident.update({ where: { id }, data: { aiSummaryStatus: "queued" } });
  await incidentSummaryQueue.add(
    "incident.summary",
    { incidentId: id, reason: "manual" },
    INCIDENT_SUMMARY_JOB_OPTS,
  );

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "incident.summary_regenerate",
    targetType: "incident",
    targetId: id,
    metadata: { previousStatus: incident.aiSummaryStatus },
  });

  return NextResponse.json({ status: "queued" }, { status: 202 });
});

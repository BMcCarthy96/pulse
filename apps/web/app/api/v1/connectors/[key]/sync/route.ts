import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, injectTrace } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { syncQueue } from "@/lib/queue";

export const POST = handleApiError("connectors.sync", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { key } = await ctx.params;

  const connector = await prisma.connector.findFirst({ where: { key, orgId: session.user.orgId } });
  if (!connector) throw ApiError.notFound(`connector "${key}" not found`);
  if (connector.kind !== "poll_sync")
    throw ApiError.validation(`connector "${key}" is not a poll_sync connector`);

  const existingRun = await prisma.syncRun.findFirst({
    where: { connectorId: connector.id, status: "RUNNING" },
  });
  if (existingRun) throw ApiError.conflict("a sync run is already in progress for this connector");

  await syncQueue.add("sync.start", {
    connectorId: connector.id,
    orgId: connector.orgId,
    trigger: "manual",
    ...injectTrace(),
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "sync.trigger_manual",
    targetType: "connector",
    targetId: connector.id,
    metadata: {},
  });

  return NextResponse.json({ triggered: true }, { status: 202 });
});

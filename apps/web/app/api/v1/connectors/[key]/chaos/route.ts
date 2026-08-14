import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, injectTrace, setChaosSchema } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { demoResetQueue } from "@/lib/queue";

export const POST = handleApiError("connectors.chaos", async (req, ctx) => {
  const session = await requireRole("ADMIN");
  const { key } = await ctx.params;

  const connector = await prisma.connector.findFirst({ where: { key, orgId: session.user.orgId } });
  if (!connector) throw ApiError.notFound(`connector "${key}" not found`);

  const body = setChaosSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const from = connector.chaosMode;
  const updated = await prisma.connector.update({
    where: { id: connector.id },
    data: { chaosMode: body.data.mode, chaosConfig: body.data.config ?? {} },
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "connector.chaos_change",
    targetType: "connector",
    targetId: connector.id,
    metadata: { from, to: body.data.mode },
  });

  if (process.env.DEMO_MODE === "true") {
    const resetJobId = `demo-reset-${connector.id}`;
    const existing = await demoResetQueue.getJob(resetJobId);
    if (existing) await existing.remove().catch(() => undefined);
    if (body.data.mode !== "HEALTHY") {
      await demoResetQueue.add(
        "demo.reset",
        {
          connectorId: connector.id,
          orgId: session.user.orgId,
          userId: session.user.id,
          ...injectTrace(),
        },
        { jobId: resetJobId, delay: 15 * 60 * 1000, removeOnComplete: true },
      );
    }
  }

  return NextResponse.json({ connector: updated });
});

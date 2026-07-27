import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, setChaosSchema } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

export const POST = handleApiError("connectors.chaos", async (req, ctx) => {
  const session = await requireRole("ADMIN");
  const { key } = await ctx.params;

  const connector = await prisma.connector.findUnique({ where: { key } });
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

  return NextResponse.json({ connector: updated });
});

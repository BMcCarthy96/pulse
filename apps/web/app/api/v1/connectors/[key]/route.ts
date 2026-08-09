import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, updateConnectorSchema } from "@pulse/shared";
import { handleApiError, requireSession, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

async function getConnectorOrThrow(key: string) {
  const connector = await prisma.connector.findUnique({ where: { key } });
  if (!connector) throw ApiError.notFound(`connector "${key}" not found`);
  return connector;
}

export const GET = handleApiError("connectors.detail", async (_req, ctx) => {
  await requireSession();
  const { key } = await ctx.params;
  const connector = await getConnectorOrThrow(key);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [runs, snapshots, openIncident] = await Promise.all([
    prisma.syncRun.findMany({
      where: { connectorId: connector.id },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    prisma.healthSnapshot.findMany({
      where: { connectorId: connector.id, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.incident.findFirst({
      where: { connectorId: connector.id, status: { not: "RESOLVED" } },
    }),
  ]);

  return NextResponse.json({ connector, recentRuns: runs, snapshots, openIncident });
});

export const PATCH = handleApiError("connectors.update", async (req, ctx) => {
  const session = await requireRole("ADMIN");
  const { key } = await ctx.params;
  const connector = await getConnectorOrThrow(key);

  const body = updateConnectorSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const updated = await prisma.connector.update({ where: { id: connector.id }, data: body.data });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "connector.update",
    targetType: "connector",
    targetId: connector.id,
    metadata: body.data,
  });

  return NextResponse.json({ connector: updated });
});

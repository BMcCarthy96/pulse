import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { handleApiError, requireSession } from "@/lib/authz";

export const GET = handleApiError("connectors.list", async () => {
  await requireSession();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const connectors = await prisma.connector.findMany({ orderBy: { key: "asc" } });

  const withSparklines = await Promise.all(
    connectors.map(async (c) => {
      const snapshots = await prisma.healthSnapshot.findMany({
        where: { connectorId: c.id, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        select: { errorRate: true, status: true, createdAt: true },
      });
      return { ...c, sparkline: snapshots };
    }),
  );

  return NextResponse.json({ data: withSparklines });
});

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { paginationSchema, eventStatusSchema, eventDirectionSchema } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("events.list", async (req) => {
  await requireSession();
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const connectorKey = url.searchParams.get("connectorKey") ?? undefined;
  const statusParsed = eventStatusSchema.safeParse(url.searchParams.get("status"));
  const directionParsed = eventDirectionSchema.safeParse(url.searchParams.get("direction"));

  const where: Prisma.IntegrationEventWhereInput = {
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    ...(directionParsed.success ? { direction: directionParsed.data } : {}),
    ...(connectorKey ? { connector: { key: connectorKey } } : {}),
  };

  const { data, nextCursor } = await paginate(prisma.integrationEvent, {
    where,
    orderBy: { receivedAt: "desc" },
    cursor,
    limit,
  });

  const withConnector = await prisma.integrationEvent.findMany({
    where: { id: { in: data.map((e) => e.id) } },
    include: { connector: { select: { key: true, displayName: true } } },
    orderBy: { receivedAt: "desc" },
  });

  return NextResponse.json({ data: withConnector, nextCursor });
});

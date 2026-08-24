import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { ApiError, paginationSchema, eventStatusSchema, eventDirectionSchema } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("events.list", async (req) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const connectorKey = url.searchParams.get("connectorKey") ?? undefined;
  const statusParsed = eventStatusSchema.safeParse(url.searchParams.get("status"));
  const directionParsed = eventDirectionSchema.safeParse(url.searchParams.get("direction"));
  if (url.searchParams.has("status") && !statusParsed.success) {
    throw ApiError.validation("Invalid event status filter");
  }
  if (url.searchParams.has("direction") && !directionParsed.success) {
    throw ApiError.validation("Invalid event direction filter");
  }

  const where: Prisma.IntegrationEventWhereInput = {
    orgId: session.user.orgId,
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    ...(directionParsed.success ? { direction: directionParsed.data } : {}),
    ...(connectorKey ? { connector: { key: connectorKey } } : {}),
  };

  const { data, nextCursor } = await paginate(prisma.integrationEvent, {
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    cursor,
    limit,
    cursorField: "receivedAt",
    cursorValue: (event) => event.receivedAt.toISOString(),
    parseCursorValue: (value) => new Date(value),
  });

  const withConnector = await prisma.integrationEvent.findMany({
    where: { orgId: session.user.orgId, id: { in: data.map((e) => e.id) } },
    include: { connector: { select: { key: true, displayName: true } } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });

  return NextResponse.json({ data: withConnector, nextCursor });
});

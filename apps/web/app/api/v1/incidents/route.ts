import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { paginationSchema, incidentStatusSchema, INCIDENT_ACTIVE_STATUSES } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("incidents.list", async (req) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const connectorKey = url.searchParams.get("connectorKey") ?? undefined;
  const statusParam = url.searchParams.get("status");
  const statusParsed = incidentStatusSchema.safeParse(statusParam);

  const where: Prisma.IncidentWhereInput = {
    orgId: session.user.orgId,
    // "ACTIVE" is a UI convenience for the three non-RESOLVED statuses.
    ...(statusParam === "ACTIVE"
      ? { status: { in: [...INCIDENT_ACTIVE_STATUSES] } }
      : statusParsed.success
        ? { status: statusParsed.data }
        : {}),
    ...(connectorKey ? { connector: { key: connectorKey } } : {}),
  };

  const { data, nextCursor } = await paginate(prisma.incident, {
    where,
    orderBy: { openedAt: "desc" },
    cursor,
    limit,
  });

  const withConnector = await prisma.incident.findMany({
    where: { orgId: session.user.orgId, id: { in: data.map((i) => i.id) } },
    include: { connector: { select: { key: true, displayName: true, status: true } } },
    orderBy: { openedAt: "desc" },
  });

  return NextResponse.json({ data: withConnector, nextCursor });
});

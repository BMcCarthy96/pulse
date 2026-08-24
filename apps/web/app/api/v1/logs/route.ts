import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { ApiError, paginationSchema, logLevelSchema } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("logs.list", async (req) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const connectorKey = url.searchParams.get("connectorKey") ?? undefined;
  const jobId = url.searchParams.get("jobId") ?? undefined;
  const incidentId = url.searchParams.get("incidentId") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const levelsParam = url.searchParams.get("level");
  const levels = levelsParam
    ? levelsParam
        .split(",")
        .map((l) => logLevelSchema.safeParse(l))
        .filter((r) => r.success)
        .map((r) => r.data)
    : [];
  if (
    levelsParam &&
    levels.length !== levelsParam.split(",").filter((value) => value.length > 0).length
  ) {
    throw ApiError.validation("Invalid log level filter");
  }

  const where: Prisma.LogEntryWhereInput = {
    orgId: session.user.orgId,
    ...(levels.length > 0 ? { level: { in: levels } } : {}),
    ...(connectorKey ? { connector: { key: connectorKey } } : {}),
    ...(jobId ? { jobId } : {}),
    ...(incidentId ? { incidentId } : {}),
    ...(q ? { message: { contains: q, mode: "insensitive" } } : {}),
  };

  const { data, nextCursor } = await paginate(prisma.logEntry, {
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor,
    limit,
    cursorField: "createdAt",
    cursorValue: (entry) => entry.createdAt.toISOString(),
    parseCursorValue: (value) => new Date(value),
  });

  const withConnector = await prisma.logEntry.findMany({
    where: { orgId: session.user.orgId, id: { in: data.map((l) => l.id) } },
    include: { connector: { select: { key: true, displayName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return NextResponse.json({ data: withConnector, nextCursor });
});

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { paginationSchema, logLevelSchema } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("logs.list", async (req) => {
  await requireSession();
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const connectorKey = url.searchParams.get("connectorKey") ?? undefined;
  const jobId = url.searchParams.get("jobId") ?? undefined;
  const incidentId = url.searchParams.get("incidentId") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const levelsParam = url.searchParams.get("level");
  const levels = levelsParam
    ? levelsParam.split(",").map((l) => logLevelSchema.safeParse(l)).filter((r) => r.success).map((r) => r.data)
    : [];

  const where: Prisma.LogEntryWhereInput = {
    ...(levels.length > 0 ? { level: { in: levels } } : {}),
    ...(connectorKey ? { connector: { key: connectorKey } } : {}),
    ...(jobId ? { jobId } : {}),
    ...(incidentId ? { incidentId } : {}),
    ...(q ? { message: { contains: q, mode: "insensitive" } } : {}),
  };

  const { data, nextCursor } = await paginate(prisma.logEntry, {
    where,
    orderBy: { createdAt: "desc" },
    cursor,
    limit,
  });

  const withConnector = await prisma.logEntry.findMany({
    where: { id: { in: data.map((l) => l.id) } },
    include: { connector: { select: { key: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: withConnector, nextCursor });
});

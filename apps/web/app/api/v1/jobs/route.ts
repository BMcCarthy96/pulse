import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { ApiError, paginationSchema, jobStatusSchema } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("jobs.list", async (req) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const statusParam = url.searchParams.get("status");
  const connectorKey = url.searchParams.get("connectorKey") ?? undefined;
  const queue = url.searchParams.get("queue") ?? undefined;

  const status = statusParam ? jobStatusSchema.safeParse(statusParam) : undefined;
  if (status && !status.success) throw ApiError.validation("Invalid job status filter");

  const where: Prisma.JobWhereInput = {
    orgId: session.user.orgId,
    ...(status?.success ? { status: status.data } : {}),
    ...(queue ? { queue } : {}),
    ...(connectorKey ? { connector: { key: connectorKey } } : {}),
  };

  const { data, nextCursor, total } = await paginate(prisma.job, {
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor,
    limit,
    cursorField: "createdAt",
    cursorValue: (job) => job.createdAt.toISOString(),
    parseCursorValue: (value) => new Date(value),
    withTotal: url.searchParams.get("withTotal") === "1",
  });

  const withConnector = await prisma.job.findMany({
    where: { orgId: session.user.orgId, id: { in: data.map((j) => j.id) } },
    include: { connector: { select: { key: true, displayName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return NextResponse.json({
    data: withConnector,
    nextCursor,
    ...(total !== undefined ? { total } : {}),
  });
});

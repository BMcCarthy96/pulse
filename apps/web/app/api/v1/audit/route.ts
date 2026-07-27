import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@pulse/db";
import { paginationSchema } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { paginate } from "@/lib/pagination";

export const GET = handleApiError("audit.list", async (req) => {
  const session = await requireRole("ADMIN");
  const url = new URL(req.url);
  const { cursor, limit } = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const action = url.searchParams.get("action") ?? undefined;

  const where: Prisma.AuditEntryWhereInput = {
    orgId: session.user.orgId,
    ...(action ? { action } : {}),
  };

  const { data, nextCursor } = await paginate(prisma.auditEntry, {
    where,
    orderBy: { createdAt: "desc" },
    cursor,
    limit,
  });

  const withUser = await prisma.auditEntry.findMany({
    where: { id: { in: data.map((a) => a.id) } },
    include: { user: { select: { name: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
  });

  // The filter dropdown needs every action that actually exists, not a hardcoded list that
  // drifts from what the app writes.
  const actions = await prisma.auditEntry.findMany({
    where: { orgId: session.user.orgId },
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });

  return NextResponse.json({ data: withUser, nextCursor, actions: actions.map((a) => a.action) });
});

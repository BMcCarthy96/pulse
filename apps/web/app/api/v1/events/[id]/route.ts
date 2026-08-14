import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";

export const GET = handleApiError("events.detail", async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const event = await prisma.integrationEvent.findFirst({
    where: { id, orgId: session.user.orgId },
    include: { connector: { select: { key: true, displayName: true } } },
  });
  if (!event) throw ApiError.notFound(`event "${id}" not found`);

  return NextResponse.json({ event });
});

import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";

export const GET = handleApiError("jobs.detail", async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const job = await prisma.job.findFirst({
    where: { id, orgId: session.user.orgId },
    include: { connector: { select: { key: true, displayName: true } }, syncRun: true },
  });
  if (!job) throw ApiError.notFound(`job "${id}" not found`);

  return NextResponse.json({ job });
});

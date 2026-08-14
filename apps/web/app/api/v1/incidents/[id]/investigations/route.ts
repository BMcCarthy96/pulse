import { NextResponse } from "next/server";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { createInvestigation } from "@/lib/investigations";

export const POST = handleApiError("investigations.create", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id: incidentId } = await ctx.params;
  if (!incidentId) throw ApiError.validation("incident id is required");
  const investigation = await createInvestigation({
    orgId: session.user.orgId,
    userId: session.user.id,
    incidentId,
  });
  return NextResponse.json({ investigation }, { status: 201 });
});

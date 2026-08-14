import { NextResponse } from "next/server";
import { handleApiError, requireRole } from "@/lib/authz";
import { approveInvestigationAction } from "@/lib/investigations";

export const POST = handleApiError("investigations.action_approve", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id, actionId } = await ctx.params;
  const action = await approveInvestigationAction({
    orgId: session.user.orgId,
    investigationId: id,
    userId: session.user.id,
    actionId,
  });
  return NextResponse.json({ action });
});

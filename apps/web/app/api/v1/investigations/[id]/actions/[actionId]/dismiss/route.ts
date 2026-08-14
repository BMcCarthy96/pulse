import { NextResponse } from "next/server";
import { handleApiError, requireRole } from "@/lib/authz";
import { dismissInvestigationAction } from "@/lib/investigations";

export const POST = handleApiError("investigations.action_dismiss", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id, actionId } = await ctx.params;
  const action = await dismissInvestigationAction({
    orgId: session.user.orgId,
    investigationId: id,
    userId: session.user.id,
    actionId,
  });
  return NextResponse.json({ action });
});

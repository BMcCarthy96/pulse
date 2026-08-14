import { NextResponse } from "next/server";
import { handleApiError, requireSession } from "@/lib/authz";
import { getInvestigation } from "@/lib/investigations";

export const GET = handleApiError("investigations.detail", async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const investigation = await getInvestigation(session.user.orgId, id);
  return NextResponse.json({ investigation });
});

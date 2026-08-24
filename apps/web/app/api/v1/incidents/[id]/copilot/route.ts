import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, paginationSchema } from "@pulse/shared";
import { handleApiError, requireSession } from "@/lib/authz";
import { loadCopilotScope, redactWithIdentifiers, type CopilotScope } from "@/lib/copilot";
import { paginate } from "@/lib/pagination";

function redactHistoryValue(value: unknown, scope: CopilotScope | null): unknown {
  if (!scope) return value;
  if (typeof value === "string") {
    return redactWithIdentifiers(value, scope.knownNames, scope.knownIdentifiers);
  }
  if (Array.isArray(value)) return value.map((item) => redactHistoryValue(item, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactWithIdentifiers(key, scope.knownNames, scope.knownIdentifiers),
        redactHistoryValue(item, scope),
      ]),
    );
  }
  return value;
}

export const GET = handleApiError("incidents.copilot_history", async (req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const scope = await loadCopilotScope(id, session.user.orgId);
  if (!scope) throw ApiError.notFound(`incident "${id}" not found`);

  const url = new URL(req.url);
  const parsed = paginationSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw ApiError.validation(parsed.error.message);
  const { cursor, limit } = parsed.data;
  const page = await paginate(prisma.aiRun, {
    where: { orgId: session.user.orgId, incidentId: id, kind: "COPILOT" },
    orderBy: { createdAt: "desc" },
    cursor,
    limit,
    cursorField: "createdAt",
    cursorValue: (run) => run.createdAt.toISOString(),
    parseCursorValue: (value) => new Date(value),
  });
  return NextResponse.json({
    data: page.data.map((run) => ({
      id: run.id,
      status: run.status,
      question: redactHistoryValue(run.question, scope),
      answer: redactHistoryValue(run.answer, scope),
      model: run.model,
      promptVersion: run.promptVersion,
      toolEvents: redactHistoryValue(run.toolEvents, scope),
      totalInputTokens: run.totalInputTokens,
      totalOutputTokens: run.totalOutputTokens,
      totalCostUsd: run.totalCostUsd?.toFixed(6) ?? null,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    })),
    nextCursor: page.nextCursor,
  });
});

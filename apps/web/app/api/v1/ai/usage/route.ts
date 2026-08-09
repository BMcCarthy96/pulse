import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";

const WINDOWS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

type UsageWindow = keyof typeof WINDOWS | "all";

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

function money(value: unknown) {
  return value === null || value === undefined ? "0.000000" : Number(value).toFixed(6);
}

export const GET = handleApiError("ai.usage", async (req) => {
  const session = await requireRole("ADMIN");
  const requested = new URL(req.url).searchParams.get("window") ?? "30d";
  if (!(requested in { ...WINDOWS, all: true })) {
    throw ApiError.validation("window must be one of 24h, 7d, 30d, or all");
  }

  const window = requested as UsageWindow;
  const since = window === "all" ? undefined : new Date(Date.now() - WINDOWS[window]);
  const where = { orgId: session.user.orgId, ...(since ? { createdAt: { gte: since } } : {}) };

  const [aggregate, successful, failed, byKind, byModel, calls] = await Promise.all([
    prisma.aiRun.aggregate({ where, _count: { _all: true }, _sum: { totalCostUsd: true } }),
    prisma.aiRun.count({ where: { ...where, status: "SUCCEEDED" } }),
    prisma.aiRun.count({
      where: { ...where, status: { in: ["FAILED", "REFUSED", "BUDGET_EXCEEDED", "CANCELLED"] } },
    }),
    prisma.aiRun.groupBy({
      by: ["kind"],
      where,
      _count: { _all: true },
      _sum: { totalCostUsd: true },
    }),
    prisma.aiRun.groupBy({
      by: ["model"],
      where,
      _count: { _all: true },
      _sum: { totalCostUsd: true },
    }),
    prisma.aiCall.findMany({
      where: { run: where },
      select: { latencyMs: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const latencies = calls.map((call) => call.latencyMs);
  const totalCostUsd = money(aggregate._sum.totalCostUsd);
  const successfulCost = successful === 0 ? 0 : Number(totalCostUsd) / successful;
  const terminalRuns = successful + failed;

  return NextResponse.json({
    window,
    since: since?.toISOString() ?? null,
    totalRuns: aggregate._count._all,
    successfulRuns: successful,
    failedRuns: failed,
    successRate: terminalRuns === 0 ? null : Number((successful / terminalRuns).toFixed(6)),
    failureRate: terminalRuns === 0 ? null : Number((failed / terminalRuns).toFixed(6)),
    pendingRuns: aggregate._count._all - terminalRuns,
    totalCostUsd,
    meanCostPerSuccessfulRun: successfulCost.toFixed(6),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    calls: calls.length,
    byKind: byKind.map((row) => ({
      kind: row.kind,
      runs: row._count._all,
      costUsd: money(row._sum.totalCostUsd),
    })),
    byModel: byModel.map((row) => ({
      model: row.model,
      runs: row._count._all,
      costUsd: money(row._sum.totalCostUsd),
    })),
  });
});

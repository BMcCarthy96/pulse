import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, simulateLabResultsSchema } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const SIMULATOR_BASE_URL = process.env.SIMULATOR_BASE_URL ?? "http://localhost:4001";

export const POST = handleApiError("simulate.lab-results", async (req) => {
  const session = await requireRole("OPS");

  const body = simulateLabResultsSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const connector = await prisma.connector.findFirst({
    where: { key: "lab-results", orgId: session.user.orgId },
  });
  if (!connector) throw ApiError.notFound('connector "lab-results" not found');

  const res = await fetch(`${SIMULATOR_BASE_URL}/labs/emit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: body.data.count, orgSlug: session.user.orgId }),
  });
  if (!res.ok) throw ApiError.internal(`simulator returned ${res.status}`);
  const result = (await res.json()) as { scheduled: number };

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "simulate.lab_results",
    targetType: "connector",
    targetId: connector.id,
    metadata: { count: body.data.count },
  });

  return NextResponse.json(result, { status: 202 });
});

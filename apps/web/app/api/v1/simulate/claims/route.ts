import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, simulateClaimsSchema, QUEUE_NAMES, createTrackedJob } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { claimsSubmitQueue } from "@/lib/queue";

export const POST = handleApiError("simulate.claims", async (req) => {
  const session = await requireRole("OPS");

  const body = simulateClaimsSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const connector = await prisma.connector.findFirst({
    where: { key: "claims", orgId: session.user.orgId },
  });
  if (!connector) throw ApiError.notFound('connector "claims" not found');

  const dbJobIds: string[] = [];
  for (let i = 0; i < body.data.count; i++) {
    const { dbJobId } = await createTrackedJob(prisma, {
      queue: claimsSubmitQueue,
      queueName: QUEUE_NAMES.claimsSubmit,
      type: "claim.submit",
      connectorId: connector.id,
      orgId: connector.orgId,
      payload: { connectorId: connector.id, orgId: connector.orgId },
    });
    dbJobIds.push(dbJobId);
  }

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "simulate.claims",
    targetType: "connector",
    targetId: connector.id,
    metadata: { count: body.data.count },
  });

  return NextResponse.json({ scheduled: dbJobIds.length, dbJobIds }, { status: 202 });
});

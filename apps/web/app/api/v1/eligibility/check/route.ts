import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import {
  ApiError,
  eligibilityCheckSchema,
  QUEUE_NAMES,
  ELIGIBILITY_JOB_OPTS,
  createTrackedJob,
} from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { eligibilityQueue } from "@/lib/queue";

export const POST = handleApiError("eligibility.check", async (req) => {
  const session = await requireRole("OPS");

  const body = eligibilityCheckSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const connector = await prisma.connector.findUnique({ where: { key: "eligibility" } });
  if (!connector) throw ApiError.notFound('connector "eligibility" not found');

  const { dbJobId } = await createTrackedJob(prisma, {
    queue: eligibilityQueue,
    queueName: QUEUE_NAMES.eligibility,
    type: "eligibility.check",
    connectorId: connector.id,
    orgId: connector.orgId,
    payload: {
      connectorId: connector.id,
      orgId: connector.orgId,
      memberId: body.data.memberId,
      payerId: body.data.payerId,
    },
    opts: ELIGIBILITY_JOB_OPTS,
  });

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "eligibility.check",
    targetType: "job",
    targetId: dbJobId,
    metadata: { memberId: body.data.memberId, payerId: body.data.payerId },
  });

  return NextResponse.json({ jobId: dbJobId }, { status: 202 });
});

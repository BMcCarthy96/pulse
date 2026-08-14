import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, retryBulkSchema, retryTrackedJob } from "@pulse/shared";
import { QUEUE_NAMES } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import {
  syncQueue,
  webhookProcessingQueue,
  claimsSubmitQueue,
  eligibilityQueue,
} from "@/lib/queue";

const queueByName = {
  [QUEUE_NAMES.sync]: syncQueue,
  [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
  [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
  [QUEUE_NAMES.eligibility]: eligibilityQueue,
};

export const POST = handleApiError("jobs.retry_bulk", async (req) => {
  const session = await requireRole("OPS");

  const body = retryBulkSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);

  const dead = await prisma.job.findMany({
    where: {
      orgId: session.user.orgId,
      status: "DEAD",
      ...(body.data.connectorKey
        ? { connector: { orgId: session.user.orgId, key: body.data.connectorKey } }
        : {}),
      ...(body.data.ids ? { id: { in: body.data.ids } } : {}),
    },
    // Oldest first so repeated runs drain the backlog instead of re-picking the same head.
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let retried = 0;
  for (const job of dead) {
    await retryTrackedJob(prisma, queueByName, job.id);
    retried++;
  }

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "job.retry_bulk",
    targetType: "job",
    targetId: body.data.connectorKey ?? "bulk",
    metadata: { connectorKey: body.data.connectorKey, count: retried },
  });

  return NextResponse.json({ retried });
});

import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { ApiError, QUEUE_NAMES, retryTrackedJob } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { syncQueue, webhookProcessingQueue, claimsSubmitQueue, eligibilityQueue } from "@/lib/queue";

const queueByName = {
  [QUEUE_NAMES.sync]: syncQueue,
  [QUEUE_NAMES.webhookProcessing]: webhookProcessingQueue,
  [QUEUE_NAMES.claimsSubmit]: claimsSubmitQueue,
  [QUEUE_NAMES.eligibility]: eligibilityQueue,
};

export const POST = handleApiError("jobs.retry", async (_req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) throw ApiError.notFound(`job "${id}" not found`);
  if (job.status !== "DEAD" && job.status !== "FAILED") {
    throw ApiError.conflict(`job status is ${job.status}; only DEAD or FAILED jobs can be retried`);
  }

  const result = await retryTrackedJob(prisma, queueByName, id);

  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "job.retry",
    targetType: "job",
    targetId: id,
    metadata: {},
  });

  return NextResponse.json(result);
});

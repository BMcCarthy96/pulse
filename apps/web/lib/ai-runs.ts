import { prisma } from "@pulse/db";
import {
  INCIDENT_SUMMARY_JOB_OPTS,
  INCIDENT_SUMMARY_PROMPT_VERSION,
  injectTrace,
  currentTraceId,
} from "@pulse/shared";
import { incidentSummaryQueue } from "./queue";

export async function enqueueSummaryRun(args: {
  incidentId: string;
  orgId: string;
  reason: "manual" | "opened" | "resolution";
}) {
  const run = await prisma.aiRun.create({
    data: {
      orgId: args.orgId,
      incidentId: args.incidentId,
      kind: "SUMMARY",
      status: "QUEUED",
      model:
        process.env.ANTHROPIC_SUMMARY_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
      promptVersion: INCIDENT_SUMMARY_PROMPT_VERSION,
      traceId: currentTraceId(),
    },
  });

  try {
    const job = await incidentSummaryQueue.add(
      "incident.summary",
      { incidentId: args.incidentId, runId: run.id, reason: args.reason, ...injectTrace() },
      INCIDENT_SUMMARY_JOB_OPTS,
    );

    return { runId: run.id, bullJobId: job.id };
  } catch (error) {
    await prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: "QUEUE_ENQUEUE_FAILED",
        errorMessage: "summary queue unavailable",
        completedAt: new Date(),
      },
    });
    await prisma.incident
      .update({
        where: { id: args.incidentId },
        data: {
          aiSummaryStatus: "failed",
          aiSummary: {
            error: "summary queue unavailable",
            errorCode: "QUEUE_ENQUEUE_FAILED",
            failedAt: new Date().toISOString(),
            aiRunId: run.id,
          },
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

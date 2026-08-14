import type { Job as BullJob } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import { currentTraceId, INCIDENT_SUMMARY_PROMPT_VERSION } from "@pulse/shared";
import {
  AiNotConfiguredError,
  AiBudgetExceededError,
  AiPermanentError,
  RedactionLeakError,
  AiUnpricedModelError,
  summarizeIncident,
} from "../ai/summarize.js";
import { AiRetryableError } from "../queue-errors.js";
import { log } from "../log.js";
import { costOf } from "@pulse/shared";
import { AiBudgetUnavailableError, reserveAiSpend, settleAiSpend } from "@pulse/shared/ai-budget";

interface IncidentSummaryPayload {
  incidentId: string;
  runId?: string;
  reason?: "opened" | "resolution" | "manual";
}

function modelName() {
  return process.env.ANTHROPIC_SUMMARY_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
}

async function getOrCreateRun(incidentId: string, runId?: string) {
  if (runId) {
    const existing = await prisma.aiRun.findUnique({ where: { id: runId } });
    if (existing) return existing;
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { orgId: true },
  });
  if (!incident) return null;
  return prisma.aiRun.create({
    data: {
      orgId: incident.orgId,
      incidentId,
      kind: "SUMMARY",
      status: "QUEUED",
      model: modelName(),
      promptVersion: INCIDENT_SUMMARY_PROMPT_VERSION,
      traceId: currentTraceId(),
    },
  });
}

function errorDetails(error: Error) {
  if (error instanceof AiBudgetUnavailableError) {
    return {
      retryable: true,
      status: undefined,
      code: "AI_BUDGET_UNAVAILABLE",
      requestId: undefined,
      retryAfterMs: undefined,
    };
  }
  if (error instanceof AiRetryableError) {
    return {
      retryable: true,
      status: error.status,
      code: error.status ? `HTTP_${error.status}` : "AI_TRANSIENT",
      requestId: error.requestId,
      retryAfterMs: error.retryAfterMs,
    };
  }
  if (error instanceof AiPermanentError) {
    return {
      retryable: false,
      status: error.status,
      code: error.code,
      requestId: error.requestId,
      retryAfterMs: undefined,
    };
  }
  return {
    retryable: true,
    status: undefined,
    code: "AI_UNEXPECTED",
    requestId: undefined,
    retryAfterMs: undefined,
  };
}

/** doc 03 §6: queued → generating → ready | failed, with durable attempt telemetry. */
export async function processIncidentSummaryJob(job: BullJob) {
  const { incidentId, runId: payloadRunId, reason = "opened" } = job.data as IncidentSummaryPayload;
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    log.warn({ incidentId }, "incident summary requested for an incident that no longer exists");
    return;
  }

  const run = await getOrCreateRun(incidentId, payloadRunId);
  if (!run) return;
  const attempt = job.attemptsMade + 1;
  const startedAt = Date.now();

  await prisma.$transaction([
    prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        startedAt: run.startedAt ?? new Date(),
        ...(currentTraceId() ? { traceId: currentTraceId() } : {}),
      },
    }),
    prisma.incident.update({ where: { id: incidentId }, data: { aiSummaryStatus: "generating" } }),
  ]);

  try {
    if (process.env.AI_ENABLED !== "true" || !process.env.ANTHROPIC_API_KEY) {
      throw new AiNotConfiguredError();
    }
    const worstCaseCost = costOf({ inputTokens: 12_000, outputTokens: 1_500 }, modelName()) ?? 0.5;
    const reservation = await reserveAiSpend(incident.orgId, worstCaseCost);
    if (!reservation.allowed) throw new AiBudgetExceededError();
    let result;
    try {
      result = await summarizeIncident(incidentId);
      await settleAiSpend(incident.orgId, reservation.reservedUsd, result.costUsd ?? worstCaseCost);
    } catch (error) {
      await settleAiSpend(incident.orgId, reservation.reservedUsd, 0);
      throw error;
    }
    const stored = {
      ...result.summary,
      model: result.model,
      promptVersion: result.promptVersion,
      generatedAt: result.generatedAt,
      reason,
      aiRunId: run.id,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    };

    await prisma.$transaction(async (tx) => {
      await tx.aiCall.create({
        data: {
          runId: run.id,
          sequence: attempt,
          attempt,
          providerRequestId: result.requestId,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cacheCreationInputTokens: result.cacheCreationInputTokens,
          cacheReadInputTokens: result.cacheReadInputTokens,
          pricingVersion: result.pricingVersion,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          status: "OK",
        },
      });
      await tx.aiRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          model: result.model,
          promptVersion: result.promptVersion,
          contextChars: result.contextChars,
          contextTruncated: result.contextTruncated,
          totalInputTokens: result.inputTokens,
          totalOutputTokens: result.outputTokens,
          totalCacheCreationInputTokens: result.cacheCreationInputTokens,
          totalCacheReadInputTokens: result.cacheReadInputTokens,
          totalCostUsd: result.costUsd,
          completedAt: new Date(),
        },
      });
      await tx.incident.update({
        where: { id: incidentId },
        data: { aiSummary: stored as Prisma.InputJsonValue, aiSummaryStatus: "ready" },
      });
      await tx.incidentTimelineEntry.create({
        data: {
          incidentId,
          kind: "ai_summary",
          message: `AI summary generated (${result.model}, prompt ${result.promptVersion})`,
          actor: "system",
        },
      });
    });

    log.info(
      {
        incidentId,
        connectorId: incident.connectorId,
        runId: run.id,
        model: result.model,
        promptVersion: result.promptVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        contextChars: result.contextChars,
        contextTruncated: result.contextTruncated,
      },
      "incident summary ready",
    );
  } catch (caught) {
    const original = caught instanceof Error ? caught : new Error(String(caught));
    const error =
      original instanceof AiRetryableError ||
      original instanceof AiPermanentError ||
      original instanceof AiBudgetUnavailableError
        ? original
        : new AiRetryableError(original.message);
    const details = errorDetails(error);
    const finalAttempt = attempt >= (job.opts.attempts ?? 1);
    const shouldRetry = details.retryable && !finalAttempt;
    const refused =
      error instanceof AiNotConfiguredError ||
      error instanceof RedactionLeakError ||
      error instanceof AiUnpricedModelError;
    const budgetExceeded = error instanceof AiBudgetExceededError;
    const callRefused = refused || budgetExceeded;

    await prisma.$transaction([
      prisma.aiCall.create({
        data: {
          runId: run.id,
          sequence: attempt,
          attempt,
          providerRequestId: details.requestId,
          model: run.model,
          latencyMs: Date.now() - startedAt,
          status: callRefused ? "REFUSED" : "FAILED",
          errorCode: details.code,
          errorMessage: error.message,
        },
      }),
      prisma.aiRun.update({
        where: { id: run.id },
        data: {
          status: shouldRetry
            ? "QUEUED"
            : budgetExceeded
              ? "BUDGET_EXCEEDED"
              : refused
                ? "REFUSED"
                : "FAILED",
          errorCode: details.code,
          errorMessage: error.message,
          completedAt: shouldRetry ? null : new Date(),
        },
      }),
      prisma.incident.update({
        where: { id: incidentId },
        data: {
          aiSummaryStatus: shouldRetry ? "queued" : "failed",
          aiSummary: {
            error: error.message,
            errorCode: details.code,
            failedAt: new Date().toISOString(),
            aiRunId: run.id,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    if (shouldRetry) {
      log.warn(
        {
          incidentId,
          runId: run.id,
          attempt,
          code: details.code,
          retryAfterMs: details.retryAfterMs,
        },
        "incident summary transient failure; retrying",
      );
      throw error;
    }

    log[callRefused ? "warn" : "error"](
      { incidentId, runId: run.id, attempt, code: details.code },
      `incident summary ${refused ? "refused" : budgetExceeded ? "budget exceeded" : "failed"}: ${error.message}`,
    );
  }
}

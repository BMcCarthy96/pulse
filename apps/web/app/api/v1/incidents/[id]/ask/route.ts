import Anthropic from "@anthropic-ai/sdk";
import { prisma, type Prisma } from "@pulse/db";
import {
  ApiError,
  costOf,
  currentTraceId,
  findLeakedIdentifiers,
  MODEL_PRICING_VERSION,
  withSpan,
} from "@pulse/shared";
import { AiBudgetUnavailableError, reserveAiSpend, settleAiSpend } from "@pulse/shared/ai-budget";
import { z } from "zod";
import { handleApiError, requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import {
  COPILOT_MAX_INPUT_TOKENS,
  COPILOT_MAX_OUTPUT_TOKENS,
  COPILOT_MAX_TOOL_RESULT_CHARS,
  COPILOT_MAX_TURNS,
  COPILOT_MAX_WALL_TIME_MS,
  COPILOT_PROMPT_VERSION,
  COPILOT_SYSTEM_PROMPT,
  COPILOT_TOOLS,
  executeCopilotTool,
  loadCopilotScope,
  redactWithIdentifiers,
  type CopilotScope,
  type CopilotToolName,
} from "@/lib/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const askSchema = z.object({ question: z.string().trim().min(1).max(2_000) });
const MODEL =
  process.env.ANTHROPIC_COPILOT_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const configuredMaxCost = Number(process.env.AI_RUN_MAX_COST_USD ?? "0.50");
const MAX_COST_USD =
  Number.isFinite(configuredMaxCost) && configuredMaxCost > 0 ? configuredMaxCost : 0.5;

type SseController = ReadableStreamDefaultController<Uint8Array>;
type CallTelemetry = {
  providerRequestId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  pricingVersion?: string | null;
  costUsd?: number | null;
};

function frame(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function safeError(error: unknown, scope?: CopilotScope) {
  if (error instanceof Anthropic.APIError) {
    return {
      code: error.status === 429 ? "AI_RATE_LIMITED" : `AI_HTTP_${error.status ?? "ERROR"}`,
      message:
        error.status === 429
          ? "The model provider is rate limiting this request."
          : "The model provider rejected the request.",
      requestId: error.requestID ?? null,
    };
  }
  const rawMessage =
    error instanceof Error ? error.message : "Copilot could not complete the request.";
  return {
    code: "AI_COPILOT_FAILED",
    message: scope
      ? redactWithIdentifiers(rawMessage, scope.knownNames, scope.knownIdentifiers)
      : rawMessage,
    requestId: null,
  };
}

function outputLeak(text: string, scope: CopilotScope) {
  return findLeakedIdentifiers(text, scope.knownIdentifiers);
}

async function createFailedCall(
  runId: string,
  sequence: number,
  error: unknown,
  latencyMs: number,
  override?: ReturnType<typeof safeError>,
  telemetry?: CallTelemetry,
  scope?: CopilotScope,
) {
  const details = override ?? safeError(error, scope);
  await prisma.aiCall.create({
    data: {
      runId,
      sequence,
      attempt: sequence,
      model: MODEL,
      providerRequestId: telemetry?.providerRequestId ?? details.requestId,
      inputTokens: telemetry?.inputTokens ?? 0,
      outputTokens: telemetry?.outputTokens ?? 0,
      cacheCreationInputTokens: telemetry?.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: telemetry?.cacheReadInputTokens ?? 0,
      pricingVersion: telemetry?.pricingVersion ?? null,
      costUsd: telemetry?.costUsd ?? null,
      latencyMs,
      status: "FAILED",
      errorCode: details.code,
      errorMessage: details.message,
    },
  });
  return details;
}

function send(controller: SseController, event: string, payload: unknown) {
  controller.enqueue(new TextEncoder().encode(frame(event, payload)));
}

function sendAnswerChunks(controller: SseController, text: string) {
  for (let offset = 0; offset < text.length; offset += 240) {
    send(controller, "answer.delta", { text: text.slice(offset, offset + 240) });
  }
}

async function streamCopilot(
  request: Request,
  runId: string,
  question: string,
  scope: CopilotScope,
) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      const toolEvents: Record<string, unknown>[] = [];
      let answer = "";
      let turns = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationInputTokens = 0;
      let cacheReadInputTokens = 0;
      let totalCost = 0;
      let hasUnknownCost = false;
      let completedStatus: "SUCCEEDED" | "BUDGET_EXCEEDED" | "CANCELLED" = "SUCCEEDED";

      const finalize = async (
        status: "SUCCEEDED" | "BUDGET_EXCEEDED" | "CANCELLED" | "FAILED" | "REFUSED",
        error?: ReturnType<typeof safeError>,
      ) => {
        await prisma.aiRun.update({
          where: { id: runId },
          data: {
            status,
            answer: redactWithIdentifiers(answer, scope.knownNames, scope.knownIdentifiers),
            toolEvents: toolEvents as Prisma.InputJsonValue,
            totalInputTokens: inputTokens,
            totalOutputTokens: outputTokens,
            totalCacheCreationInputTokens: cacheCreationInputTokens,
            totalCacheReadInputTokens: cacheReadInputTokens,
            totalCostUsd: hasUnknownCost ? null : totalCost,
            errorCode: error?.code,
            errorMessage: error?.message,
            completedAt: new Date(),
          },
        });
      };

      try {
        await prisma.aiRun.update({
          where: { id: runId },
          data: { status: "RUNNING", startedAt: new Date() },
        });
        send(controller, "run.started", {
          runId,
          model: MODEL,
          promptVersion: COPILOT_PROMPT_VERSION,
        });

        if (process.env.AI_ENABLED === "false" || !process.env.ANTHROPIC_API_KEY) {
          completedStatus = "CANCELLED";
          const details = {
            code: "AI_NOT_CONFIGURED",
            message: "AI not configured",
            requestId: null,
          };
          await finalize("REFUSED", details);
          send(controller, "run.error", details);
          return;
        }

        const client = new Anthropic({ maxRetries: 0, timeout: 60_000 });
        const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

        while (turns < COPILOT_MAX_TURNS) {
          if (cancelled || request.signal.aborted) {
            completedStatus = "CANCELLED";
            break;
          }
          if (Date.now() - startedAt >= COPILOT_MAX_WALL_TIME_MS) {
            completedStatus = "BUDGET_EXCEEDED";
            break;
          }
          const remainingOutput = COPILOT_MAX_OUTPUT_TOKENS - outputTokens;
          if (remainingOutput <= 0 || inputTokens >= COPILOT_MAX_INPUT_TOKENS) {
            completedStatus = "BUDGET_EXCEEDED";
            break;
          }
          const maxTokens = Math.min(2_000, remainingOutput);
          const worstCaseCost = costOf(
            { inputTokens: Math.max(inputTokens, 1_000), outputTokens: maxTokens },
            MODEL,
          );
          if (worstCaseCost !== null && totalCost + worstCaseCost > MAX_COST_USD && answer) {
            completedStatus = "BUDGET_EXCEEDED";
            break;
          }
          if (
            worstCaseCost === null &&
            process.env.NODE_ENV === "production" &&
            process.env.AI_ALLOW_UNPRICED !== "true"
          ) {
            completedStatus = "BUDGET_EXCEEDED";
            const details = {
              code: "AI_UNKNOWN_PRICING",
              message: "The configured model has no pricing entry.",
              requestId: null,
            };
            await finalize("FAILED", details);
            send(controller, "run.error", details);
            return;
          }

          turns += 1;
          const callStartedAt = Date.now();
          let reservedForTurn = 0;
          let spendSettled = false;
          let callPersisted = false;
          let callTelemetry: CallTelemetry | undefined;
          let turnText = "";
          try {
            const reservation = await reserveAiSpend(scope.orgId, worstCaseCost ?? MAX_COST_USD);
            if (!reservation.allowed) {
              completedStatus = "BUDGET_EXCEEDED";
              turns -= 1;
              break;
            }
            reservedForTurn = reservation.reservedUsd;
            const providerStream = client.messages.stream(
              {
                model: MODEL,
                max_tokens: maxTokens,
                system: COPILOT_SYSTEM_PROMPT,
                tools: COPILOT_TOOLS as unknown as Anthropic.Tool[],
                messages,
              },
              { signal: request.signal },
            );
            providerStream.on("text", (delta) => {
              turnText += delta;
            });
            const message = await withSpan(
              "ai.copilot.model",
              { "ai.model": MODEL, "ai.prompt_version": COPILOT_PROMPT_VERSION, "ai.turn": turns },
              async (span) => {
                const finalMessage = await providerStream.finalMessage();
                span.setAttributes({
                  "ai.input_tokens": finalMessage.usage.input_tokens,
                  "ai.output_tokens": finalMessage.usage.output_tokens,
                  "ai.cache_creation_input_tokens":
                    finalMessage.usage.cache_creation_input_tokens ?? 0,
                  "ai.cache_read_input_tokens": finalMessage.usage.cache_read_input_tokens ?? 0,
                  "ai.provider_request_id": providerStream.request_id ?? "",
                  "ai.cost_usd":
                    costOf(
                      {
                        inputTokens: finalMessage.usage.input_tokens,
                        outputTokens: finalMessage.usage.output_tokens,
                        cacheCreationInputTokens:
                          finalMessage.usage.cache_creation_input_tokens ?? 0,
                        cacheReadInputTokens: finalMessage.usage.cache_read_input_tokens ?? 0,
                      },
                      MODEL,
                    ) ?? "unknown",
                  "ai.outcome": "ok",
                });
                return finalMessage;
              },
            );
            const usage = message.usage;
            inputTokens += usage.input_tokens;
            outputTokens += usage.output_tokens;
            cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
            cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
            const callCost = costOf(
              {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
              },
              MODEL,
            );
            callTelemetry = {
              providerRequestId: providerStream.request_id,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
              cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
              pricingVersion: callCost === null ? null : MODEL_PRICING_VERSION,
              costUsd: callCost,
            };
            if (callCost === null) hasUnknownCost = true;
            else totalCost += callCost;
            await settleAiSpend(scope.orgId, reservedForTurn, callCost ?? MAX_COST_USD);
            spendSettled = true;
            const leaks = outputLeak(turnText, scope);
            if (leaks.length > 0)
              throw new Error(`model output contained protected identifiers (${leaks.join(", ")})`);
            await prisma.aiCall.create({
              data: {
                runId,
                sequence: turns,
                attempt: turns,
                providerRequestId: providerStream.request_id,
                model: MODEL,
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
                pricingVersion: callCost === null ? null : MODEL_PRICING_VERSION,
                costUsd: callCost,
                latencyMs: Date.now() - callStartedAt,
                status: "OK",
              },
            });
            callPersisted = true;
            if (cancelled || request.signal.aborted) {
              completedStatus = "CANCELLED";
              break;
            }

            if (turnText) {
              answer += turnText;
              sendAnswerChunks(
                controller,
                redactWithIdentifiers(turnText, scope.knownNames, scope.knownIdentifiers),
              );
            }

            const toolUses = message.content.filter(
              (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
            );
            if (toolUses.length === 0 || message.stop_reason !== "tool_use") break;

            messages.push({ role: "assistant", content: message.content });
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const toolUse of toolUses) {
              if (cancelled || request.signal.aborted) break;
              const name = toolUse.name as CopilotToolName;
              const argumentLeaks = outputLeak(JSON.stringify(toolUse.input), scope);
              if (argumentLeaks.length > 0) {
                throw new Error(
                  `tool arguments contained protected identifiers (${argumentLeaks.join(", ")})`,
                );
              }
              send(controller, "tool.started", { name, turn: turns });
              const result = await withSpan(
                "ai.copilot.tool",
                { "ai.tool": name, "ai.turn": turns },
                () => executeCopilotTool(scope, name, toolUse.input),
              );
              if (result.text.length > COPILOT_MAX_TOOL_RESULT_CHARS + 40) {
                result.text = `${result.text.slice(0, COPILOT_MAX_TOOL_RESULT_CHARS)}\n[tool result truncated]`;
              }
              toolEvents.push({
                name,
                turn: turns,
                summary: result.summary,
                rowCount: result.rowCount,
              });
              await prisma.aiRun.update({
                where: { id: runId },
                data: { toolEvents: toolEvents as Prisma.InputJsonValue },
              });
              send(controller, "tool.completed", {
                name,
                turn: turns,
                summary: result.summary,
                rowCount: result.rowCount,
              });
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: result.text,
              });
            }
            if (toolResults.length === 0) break;
            messages.push({ role: "user", content: toolResults });
          } catch (error) {
            if (!spendSettled) await settleAiSpend(scope.orgId, reservedForTurn, 0);
            if (cancelled || request.signal.aborted) {
              const details = {
                code: "AI_CANCELLED",
                message: "Copilot request cancelled.",
                requestId: null,
              };
              if (!callPersisted)
                await createFailedCall(
                  runId,
                  turns,
                  new Error(details.message),
                  Date.now() - callStartedAt,
                  details,
                  callTelemetry,
                  scope,
                );
              await finalize("CANCELLED", details);
              return;
            }
            if (error instanceof AiBudgetUnavailableError) {
              const details = {
                code: "AI_BUDGET_UNAVAILABLE",
                message: "AI budget protection is temporarily unavailable.",
                requestId: null,
              };
              await finalize("FAILED", details);
              send(controller, "run.error", details);
              return;
            }
            const details = callPersisted
              ? safeError(error, scope)
              : await createFailedCall(
                  runId,
                  turns,
                  error,
                  Date.now() - callStartedAt,
                  undefined,
                  callTelemetry,
                  scope,
                );
            await finalize("FAILED", details);
            send(controller, "run.error", details);
            return;
          }
        }

        if (cancelled || request.signal.aborted) completedStatus = "CANCELLED";
        if (completedStatus === "BUDGET_EXCEEDED") {
          const label = "\n\n[Response truncated: copilot budget reached.]";
          answer += label;
          sendAnswerChunks(controller, label);
        }
        if (completedStatus === "CANCELLED") {
          const label = "\n\n[Response cancelled.]";
          answer += label;
          if (!request.signal.aborted) sendAnswerChunks(controller, label);
        }
        await finalize(completedStatus);
        if (!request.signal.aborted) {
          send(controller, "run.completed", {
            runId,
            status: completedStatus,
            turns,
            inputTokens,
            outputTokens,
            costUsd: hasUnknownCost ? null : totalCost.toFixed(6),
            toolEvents,
          });
        }
      } catch (error) {
        if (cancelled || request.signal.aborted) {
          const details = {
            code: "AI_CANCELLED",
            message: "Copilot request cancelled.",
            requestId: null,
          };
          await finalize("CANCELLED", details).catch(() => undefined);
          return;
        }
        const details = safeError(error, scope);
        await finalize("FAILED", details).catch(() => undefined);
        if (!request.signal.aborted) send(controller, "run.error", details);
      } finally {
        if (!request.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      void prisma.aiRun
        .update({ where: { id: runId }, data: { status: "CANCELLED", completedAt: new Date() } })
        .catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST = handleApiError("incidents.copilot_ask", async (req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;
  const scope = await loadCopilotScope(id, session.user.orgId);
  if (!scope) throw ApiError.notFound(`incident "${id}" not found`);

  const parsed = askSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw ApiError.validation(parsed.error.message);
  const question = redactWithIdentifiers(
    parsed.data.question,
    scope.knownNames,
    scope.knownIdentifiers,
  );
  const leaks = outputLeak(question, scope);
  if (leaks.length > 0) throw ApiError.validation("question contains protected identifiers");

  let run;
  try {
    run = await prisma.$transaction(
      async (tx) => {
        const active = await tx.aiRun.findFirst({
          where: {
            orgId: session.user.orgId,
            userId: session.user.id,
            incidentId: id,
            kind: "COPILOT",
            status: { in: ["QUEUED", "RUNNING"] },
          },
          select: { id: true },
        });
        if (active) throw ApiError.conflict("a copilot run is already active for this incident");
        return tx.aiRun.create({
          data: {
            orgId: session.user.orgId,
            incidentId: id,
            userId: session.user.id,
            kind: "COPILOT",
            status: "QUEUED",
            model: MODEL,
            promptVersion: COPILOT_PROMPT_VERSION,
            question,
            traceId: currentTraceId(),
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      throw ApiError.conflict("a copilot run is already active for this incident");
    }
    throw error;
  }
  await writeAudit({
    orgId: session.user.orgId,
    userId: session.user.id,
    action: "incident.copilot_ask",
    targetType: "incident",
    targetId: id,
    metadata: { runId: run.id },
  });
  return streamCopilot(req, run.id, question, scope);
});

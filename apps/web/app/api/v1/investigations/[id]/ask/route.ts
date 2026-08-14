import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { getInvestigation, runInvestigation } from "@/lib/investigations";

const askSchema = z.object({ question: z.string().trim().min(1).max(2_000) });

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const POST = handleApiError("investigation_ask", async (req, ctx) => {
  const session = await requireRole("OPS");
  const { id } = await ctx.params;
  const body = askSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw ApiError.validation(body.error.message);
  const investigation = await getInvestigation(session.user.orgId, id);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(frame(event, data)));
      try {
        await runInvestigation(
          {
            orgId: session.user.orgId,
            userId: session.user.id,
            investigationId: investigation.id,
            question: body.data.question,
          },
          (event) => send(event.event, event.data),
        );
      } catch (error) {
        const providerRequestId =
          error instanceof Error && "providerRequestId" in error
            ? (error as Error & { providerRequestId?: string }).providerRequestId
            : null;
        send("run.error", {
          code: error instanceof ApiError ? error.code : "INVESTIGATION_FAILED",
          message: error instanceof ApiError ? error.message : "Investigation failed",
          requestId: providerRequestId,
        });
      } finally {
        controller.close();
      }
    },
  });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

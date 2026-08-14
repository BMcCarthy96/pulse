import { NextResponse } from "next/server";
import { ApiError } from "@pulse/shared";
import { handleApiError, requireRole } from "@/lib/authz";
import { resetDemoSession } from "@/lib/demo-session";
import { enforceRateLimit, RateLimitExceededError } from "@/lib/rate-limit";

export const POST = handleApiError("demo.reset", async () => {
  const session = await requireRole("OPS");
  if (!session.user.demoSessionId)
    throw ApiError.forbidden("demo reset is only available in a demo session");
  try {
    await enforceRateLimit({
      key: `demo:${session.user.demoSessionId}:reset`,
      capacity: 3,
      refillPerMinute: 1,
      failClosed: true,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError)
      throw ApiError.rateLimited(error.retryAfterSeconds, "Demo reset is temporarily rate limited");
    throw error;
  }
  const reset = await resetDemoSession(session.user.orgId, session.user.id);
  if (!reset) throw ApiError.notFound("demo session expired");
  return NextResponse.json({ ok: true, resetAt: new Date().toISOString() });
});

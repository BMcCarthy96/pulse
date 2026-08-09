import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ApiError, roleAtLeast, type RoleName } from "@pulse/shared";
import { log } from "./log";
import { currentTraceId, withSpan } from "@pulse/shared";
import {
  enforceAuthenticatedRateLimit,
  enforceCopilotQuotas,
  enforceSummaryQuotas,
  RateLimitExceededError,
  RateLimitUnavailableError,
} from "./rate-limit";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw ApiError.unauthorized();
  return session;
}

export async function requireRole(minRole: RoleName) {
  const session = await requireSession();
  if (!roleAtLeast(session.user.role, minRole)) {
    throw ApiError.forbidden(`${minRole} role required`);
  }
  return session;
}

type RouteHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export function handleApiError(routeName: string, fn: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const start = Date.now();
    let userId: string | undefined;
    let routeTraceId: string | undefined;
    try {
      const session = await auth();
      userId = session?.user?.id;
      if (session?.user?.id) {
        const paid = routeName.includes("copilot_ask") || routeName.includes("summary_regenerate");
        try {
          await enforceAuthenticatedRateLimit(session.user.id, paid);
          if (routeName.includes("copilot_ask")) {
            await enforceCopilotQuotas(session.user.id, session.user.orgId);
          } else if (routeName.includes("summary_regenerate")) {
            await enforceSummaryQuotas(session.user.id, session.user.orgId);
          }
        } catch (error) {
          if (error instanceof RateLimitExceededError) {
            throw ApiError.rateLimited(error.retryAfterSeconds);
          }
          if (error instanceof RateLimitUnavailableError) {
            throw ApiError.rateLimited(60, "AI protection is temporarily unavailable");
          }
          throw error;
        }
      }
      const res = await withSpan(
        `api:${routeName}`,
        { "http.method": req.method, "http.route": routeName },
        (span) => {
          const traceId = span.spanContext().traceId;
          if (traceId !== "00000000000000000000000000000000") routeTraceId = traceId;
          return fn(req, ctx);
        },
      );
      log.info(
        {
          route: routeName,
          method: req.method,
          userId,
          status: res.status,
          durationMs: Date.now() - start,
          traceId: routeTraceId,
        },
        "api request",
      );
      return res;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : ApiError.internal();
      if (!(err instanceof ApiError)) {
        log.error(
          { route: routeName, method: req.method, userId, traceId: routeTraceId, err },
          "unhandled api error",
        );
      }
      log.info(
        {
          route: routeName,
          method: req.method,
          userId,
          status: apiError.status,
          durationMs: Date.now() - start,
          outcome: apiError.code,
          traceId: routeTraceId,
        },
        "api request",
      );
      const headers = apiError.retryAfterSeconds
        ? { "Retry-After": String(apiError.retryAfterSeconds) }
        : undefined;
      return NextResponse.json(apiError.toBody(routeTraceId ?? currentTraceId()), {
        status: apiError.status,
        headers,
      });
    }
  };
}

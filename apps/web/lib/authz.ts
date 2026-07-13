import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ApiError, roleAtLeast, type RoleName } from "@pulse/shared";
import { log } from "./log";

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

type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function handleApiError(routeName: string, fn: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const start = Date.now();
    let userId: string | undefined;
    try {
      const session = await auth();
      userId = session?.user?.id;
      const res = await fn(req, ctx);
      log.info(
        { route: routeName, method: req.method, userId, status: res.status, durationMs: Date.now() - start },
        "api request",
      );
      return res;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : ApiError.internal();
      if (!(err instanceof ApiError)) {
        log.error({ route: routeName, method: req.method, userId, err }, "unhandled api error");
      }
      log.info(
        {
          route: routeName,
          method: req.method,
          userId,
          status: apiError.status,
          durationMs: Date.now() - start,
          outcome: apiError.code,
        },
        "api request",
      );
      return NextResponse.json(apiError.toBody(), { status: apiError.status });
    }
  };
}

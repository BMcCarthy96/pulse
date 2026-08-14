import { NextResponse } from "next/server";
import { withSpan } from "@pulse/shared";
import { ingestWebhook, readWebhookHeaders } from "@/lib/ingest-webhook";
import {
  enforceRateLimit,
  rateLimitClientKey,
  RateLimitExceededError,
  RateLimitUnavailableError,
} from "@/lib/rate-limit";

/**
 * Thin adapter over `ingestWebhook()`. Deliberately holds no logic of its own: the pipeline it
 * calls is unit- and integration-tested directly (phase 9), and anything that lived here would
 * only be reachable through an HTTP server.
 *
 * Note this route is *not* wrapped in `handleApiError` and returns bare bodies rather than the
 * doc-04 error envelope — it is an inbound machine-to-machine endpoint for upstream vendors,
 * not part of the authenticated `/api/v1` surface the dashboard consumes.
 */
export async function POST(req: Request, { params }: { params: Promise<{ connector: string }> }) {
  const { connector: connectorKey } = await params;
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "tenant-scoped webhook route required" }, { status: 410 });
  }
  const rawBody = await req.text();
  return withSpan(
    "api:webhook.ingest",
    { "http.method": req.method, "http.route": "/api/webhooks/:connector" },
    async () => {
      try {
        await enforceRateLimit({
          key: `webhook:legacy:${connectorKey}:${rateLimitClientKey(req.headers)}`,
          capacity: 30,
          refillPerMinute: 120,
          failClosed: true,
        });
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          return NextResponse.json(
            { error: "rate limited" },
            { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
          );
        }
        if (error instanceof RateLimitUnavailableError) {
          return NextResponse.json(
            { error: "webhook protection unavailable" },
            { status: 503, headers: { "Retry-After": "30" } },
          );
        }
        throw error;
      }

      const result = await ingestWebhook({
        connectorKey,
        rawBody,
        ...readWebhookHeaders(req.headers),
      });

      switch (result.outcome) {
        case "unknown-connector":
          return NextResponse.json({ error: "unknown connector" }, { status: 404 });
        case "invalid-signature":
          return NextResponse.json({ error: "invalid signature" }, { status: 401 });
        case "duplicate":
          return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
        case "accepted":
          return NextResponse.json({ received: true }, { status: 202 });
      }
    },
  );
}

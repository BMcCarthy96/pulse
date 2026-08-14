import { NextResponse } from "next/server";
import { withSpan } from "@pulse/shared";
import { ingestWebhook, readWebhookHeaders } from "@/lib/ingest-webhook";
import {
  enforceRateLimit,
  rateLimitClientKey,
  RateLimitExceededError,
  RateLimitUnavailableError,
} from "@/lib/rate-limit";

/** Tenant-aware webhook contract: /api/webhooks/tenant/{orgSlug}/{connectorKey}. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgSlug: string; connector: string }> },
) {
  const { orgSlug, connector: connectorKey } = await params;
  const rawBody = await req.text();
  return withSpan(
    "api:webhook.ingest.tenant",
    { "http.method": req.method, "http.route": "/api/webhooks/tenant/:orgSlug/:connector" },
    async () => {
      try {
        await enforceRateLimit({
          key: `webhook:${orgSlug}:${connectorKey}:${rateLimitClientKey(req.headers)}`,
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
        orgSlug,
        connectorKey,
        rawBody,
        ...readWebhookHeaders(req.headers),
      });
      if (result.outcome === "unknown-connector")
        return NextResponse.json({ error: "unknown connector" }, { status: 404 });
      if (result.outcome === "invalid-signature")
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
      if (result.outcome === "duplicate")
        return NextResponse.json({ received: true, duplicate: true });
      return NextResponse.json({ received: true }, { status: 202 });
    },
  );
}

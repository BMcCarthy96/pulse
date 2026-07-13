# Phase 5 — Webhook Ingestion & Event Pipeline

**Goal:** Inbound webhooks from the simulator land in the web app, get signature-verified,
deduped, persisted as `IntegrationEvent`s, and processed asynchronously by the worker.

**Prereqs:** Phase 4. **Read first:** doc 03 §3 (contract — implement exactly), §2 (emission side).

## Tasks

1. `apps/web/app/api/webhooks/[connector]/route.ts`:
   - Raw-body HMAC verification (constant-time compare). No session auth. Follow doc 03 §3
     steps 1–4 precisely, including status codes (401 invalid sig, 200 duplicate, 202 accepted).
   - Resolve connector by URL segment against the registry; unknown → 404.
   - Enqueue `webhook-processing` job via a web-side producer `apps/web/lib/queue.ts`
     (BullMQ Queue instances only — web never runs Workers). Reuse `createTrackedJob` logic —
     move it into `packages/shared` (accepting a prisma + queue instance) so web and worker
     share one implementation.
2. **Webhook processor** (`apps/worker/src/processors/webhook.ts`):
   - `lab.result.created`: zod-validate payload (schemas from phase 3 task 4) → INVALID on
     failure; simulate domain work (50–200ms); mark PROCESSED.
   - `claim.ack`: validate; find originating claim `Job` by `claimId` and append ack outcome to
     its payload/result; rejected acks mark the event PROCESSED but write a WARN log (business
     rejection ≠ pipeline failure — note this distinction, it's a good interview line).
   - Processor failures follow standard retry policy; event stuck in PROCESSING past attempts →
     FAILED.
3. End-to-end wiring check: labs `POST /labs/emit` (simulator) → web route → queue → processor →
   PROCESSED events.
4. Duplicate + malformed handling verified against chaos coupling (DEGRADED double-send →
   DUPLICATE; BAD_PAYLOAD → INVALID).
5. Commit: `feat(webhooks): signed ingestion, dedupe, async processing (phase 5)`.

## Acceptance criteria

- [ ] `curl` the simulator's `/labs/emit {count:10}` → 10 IntegrationEvents reach PROCESSED;
      logs show the full path
- [ ] Tampered signature → 401 and an INVALID event row with headers captured
- [ ] Re-POST an identical delivery id → 200, original event untouched, no second processing job
- [ ] Labs BAD_PAYLOAD chaos → events land INVALID with the zod error in `error`
- [ ] Submit claims (phase 4 script) → acks arrive as webhooks → originating Jobs updated with
      ack outcome; a rejected ack produces a WARN log
- [ ] Claims connector OUTAGE does not break lab ingestion (isolation between connectors)

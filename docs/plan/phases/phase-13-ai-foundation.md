# Phase 13 — AI Execution Foundation, Reliability & Cost

**Goal:** Make every model call observable, priced, redaction-safe, and retried exactly once by the queue policy.

**Prereqs:** Phase 12 complete.

## Tasks

1. Move the redactor to `packages/shared` and preserve Node-only subpath exports and coverage claims.
2. Add `AiRun`/`AiCall` persistence, versioned pricing, usage aggregation, and summary-card/settings surfaces.
3. Extract a provider-injected summary operation and implement explicit API error classification.
4. Disable SDK retries, add BullMQ retry-after backoff, terminal-error handling, and attempt telemetry.
5. Document measured prompt-caching applicability and update schema/OpenAPI/reference docs together.

## Acceptance criteria

- [x] Successful, retrying, permanent-failure, refused, and unpriced calls have durable `AiRun`/`AiCall` records and terminal classifications.
- [x] 429 honors `Retry-After`; transient summary work owns four total BullMQ attempts; permanent failures stop immediately.
- [x] Usage API and Settings UI aggregate persisted calls/runs with fixed six-decimal money strings.
- [x] Redactor and provider seams remain covered; targeted unit, integration, coverage, and build gates pass.

Prompt caching remains disabled intentionally: the summary prefix is too small for a useful
single-turn cache, while cache token counters are persisted so a live copilot run can prove a
read before enabling it. Live provider generation and cost reconciliation remain a credential-owned
smoke check.

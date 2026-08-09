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

- [ ] Successful, retrying, permanent-failure, refused, and unpriced calls have correct durable records.
- [ ] 429 honors `Retry-After`; transient failures retry four total attempts; permanent failures stop after one.
- [ ] Usage API and UI totals match persisted call data and serialize money safely.
- [ ] Redactor and provider seams remain fully covered.

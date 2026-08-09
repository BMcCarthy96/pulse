# Phase 16 — Tracing, Abuse Controls & Production Hardening

**Goal:** Make the public demo observable, resistant to replay/abuse, and recoverable without hiding failures.

**Prereqs:** Phase 15 copilot and tests complete.

## Tasks

1. Add server-side OpenTelemetry and W3C propagation through BullMQ, with local Jaeger export.
2. Add atomic Redis rate limits, daily AI budget reservation, and `RATE_LIMITED` API contracts.
3. Add headers, route error boundaries, versioned timestamped webhook signatures, and deployment sequencing.
4. Remove stale worker state, add batched retention pruning, and auto-reset demo chaos in production mode.
5. Enable the production AI key only after the final smoke and spend checks pass.

## Acceptance criteria

- [x] OTLP Next/worker spans and W3C queue propagation cover API/enqueue/queue/worker/provider boundaries without prompt or tool content; trace IDs are persisted where configured.
- [x] Paid endpoints fail closed when Redis protection is unavailable, return `RATE_LIMITED` with `Retry-After`, and reserve/settle the daily budget atomically.
- [x] Timestamped webhook signatures, security headers, route boundaries, batched retention, and replaceable demo reset jobs are implemented and covered by local gates.
- [x] Reports, README, phase docs, and PROGRESS evidence are current; final production smoke is explicitly pending account access.

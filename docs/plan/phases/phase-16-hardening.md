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

- [ ] A trace spans web enqueue, Redis/BullMQ, worker, and provider; no sensitive content is exported.
- [ ] Paid endpoints fail closed without protection, return `Retry-After`, and respect the daily budget.
- [ ] Timestamp skew/replay, headers, boundaries, pruning, and demo recovery are tested.
- [ ] Final production smoke, screenshots, reports, README, and PROGRESS evidence are current.

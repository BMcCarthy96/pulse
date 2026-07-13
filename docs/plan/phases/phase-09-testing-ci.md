# Phase 9 — Testing & CI/CD

**Goal:** Meaningful test coverage on the load-bearing logic, an e2e smoke of the demo flow,
and a CI pipeline that runs it all. Quality over coverage numbers — every test here maps to a
claim the README makes.

**Prereqs:** Phase 8.

## Tasks

1. **Vitest setup**: workspace config; `packages/*` and `apps/worker` unit tests run with no
   services; integration tests (tagged/dir `test/integration`) expect Docker Postgres+Redis
   using a dedicated `pulse_test` database (setup script creates + migrates + truncates between
   suites).
2. **Unit tests (highest value, in priority order):**
   - `health/rules.ts`: table-driven cases for every rule branch in doc 03 §4, incl. boundary
     values (errorRate exactly 0.1/0.5, 4 vs 5 consecutive failures, empty window carry-forward,
     paused short-circuit)
   - `ai/redact.ts`: patterns, idempotency, nested JSON, non-matching text untouched
   - Backoff math / queue-config: eligibility Retry-After honoring (mock the header)
   - Webhook signature verify helper: valid, tampered body, tampered sig, replayed delivery
   - `ai/context.ts`: chaos mode never present; truncation cap respected
   - Prompt fixture snapshot: render V1 prompt with a fixed context → snapshot file (prompt
     drift breaks CI intentionally)
3. **Integration tests (worker, real DB+Redis, simulator in-process):**
   - Sync happy path: run completes, records counted, job rows mirrored
   - OUTAGE → retries → DEAD → manual retry helper → SUCCEEDED (assert errorHistory shape)
   - Webhook pipeline: emit → (call the web route handler directly as a function, or spin
     `next start`? — simpler: extract signature-verify + persist + enqueue into a lib function
     `ingestWebhook()` used by the route, and integration-test that) → dedupe + INVALID paths
   - Incident lifecycle: seed failing window → tick → incident opens once; recovery → MONITORING
     → RESOLVED (use shrunk config)
4. **API route tests** (Vitest, calling route handlers with mocked session): role gates (401/403
   envelopes), zod validation errors, retry 409 guard, audit rows written.
5. **Playwright e2e** (`apps/web/e2e/`): the doc 05 demo flow, exactly, against
   `pnpm dev`-style processes with `HEALTH_TICK_SEC=5`, `INCIDENT_STABILITY_MIN=0` (or force
   transitions via API), and **no ANTHROPIC key** (assert graceful "AI not configured" state).
   One spec file, ~8 steps, generous timeouts. Plus a tiny auth spec (login/logout/role gate).
6. **CI** (`.github/workflows/ci.yml`) jobs:
   - `lint-typecheck` → `unit` (no services) → `integration` (Postgres+Redis service
     containers) → `build` → `e2e` (services + built apps + seeded db; upload Playwright report
     artifact on failure)
   - Cache pnpm store. Badge in README (phase 11).
7. Fix everything the tests find (expect real bugs here — budget time for it).
8. Commit(s): `test: unit + integration coverage (phase 9)` / `ci: full pipeline`.

## Acceptance criteria

- [ ] `pnpm test` green locally with only Docker services running
- [ ] `pnpm test:e2e` green locally from a fresh seed
- [ ] CI green on GitHub for the full pipeline; Playwright report artifact appears on a forced
      failure (verify once, then revert)
- [ ] Coverage output shows `health/rules.ts` and `ai/redact.ts` at 100% branch coverage
      (these two specifically — they're the README claims)
- [ ] Prompt snapshot test fails when the prompt text is edited without bumping version
      (verify once, revert)

# Phase 3 — Upstream Simulator & Chaos

**Goal:** The four simulated healthcare upstreams running inside the worker's Hono server, with
chaos behavior driven by connector DB state, plus webhook emission with HMAC signatures.

**Prereqs:** Phase 1 (schema). **Read first:** doc 03 §2 (simulator spec — implement exactly).

## Tasks

1. `apps/worker/src/simulator/chaos.ts`:
   - `getChaosState(connectorKey)` reading `Connector.chaosMode`/`chaosConfig` with a 5s
     in-memory cache.
   - `applyChaos(state, c)` Hono middleware-style helper implementing the doc-03 behavior table
     (latency jitter, failure dice-roll, 503/429/401 responses, 30s stall for TIMEOUT).
   - Deterministic randomness option: accept an injectable RNG so tests can force outcomes.
2. Upstream modules, each mounting routes on the Hono app and using `applyChaos`:
   - `ehr.ts` — `GET /ehr/fhir/Patient` + `/Appointment`: 3–5 pages of faker-generated
     FHIR-ish bundles (`{resourceType:"Bundle", entry:[...], link:{next?}}`), `_page`/`_count`
     params, stable ids per process run.
   - `clearinghouse.ts` — `POST /clearinghouse/claims`: validate minimal claim shape, return
     `{claimId, status:"accepted"}`, then `setTimeout(5–20s)` → emit `claim.ack` webhook
     (accepted/rejected 85/15).
   - `eligibility.ts` — `POST /eligibility/check` → `{eligible, plan, copayCents}`; this
     connector's RATE_LIMIT chaos is its signature failure mode.
   - `labs.ts` — `POST /labs/emit {count}`: emit N `lab.result.created` webhooks over a few
     seconds (ORU-ish JSON payload: patientRef `PAT-####`, LOINC-ish code, value, unit,
     abnormalFlag).
3. `apps/worker/src/simulator/webhooks.ts` — `emitWebhook(connectorKey, eventType, payload)`:
   - POST `${WEBHOOK_TARGET_URL}/api/webhooks/{connector}` with `x-pulse-signature`
     (HMAC-SHA256 of raw body), `x-pulse-delivery` uuid, `x-pulse-event`.
   - Chaos coupling per doc 03: DEGRADED sometimes double-sends (same delivery id);
     BAD_PAYLOAD sends malformed body. Log each emission (pino, and DB log via the phase-4
     logger once it exists — for now pino only).
   - Fire-and-forget with 5s timeout; failures logged, not retried (upstreams are flaky, that's
     the point — our inbound dedupe handles it).
4. Shared payload zod schemas for lab results / claim acks / eligibility responses go in
   `packages/shared/src/payloads.ts` (web validates against these in phase 5).
5. Manual test aid: `apps/worker/scripts/poke-simulator.ts` (tsx script) that hits each endpoint
   and prints results — used in acceptance below.
6. Commit: `feat(simulator): four upstreams with chaos + signed webhooks (phase 3)`.

## Acceptance criteria

- [ ] `poke-simulator` against HEALTHY connectors: EHR pages paginate to an end; claim accepted;
      eligibility responds; labs emit logs show attempted webhook POSTs (404/refused is fine —
      web route doesn't exist until phase 5)
- [ ] Flip `ehr-fhir` chaos to OUTAGE via direct DB update → EHR endpoints return 503 within 5s
      (cache expiry); RATE_LIMIT → 429 with Retry-After; TIMEOUT → client abort at 10s
- [ ] BAD_PAYLOAD on labs emits schema-invalid bodies (verify by logging)
- [ ] All simulator responses under HEALTHY have 50–300ms latency (spot-check timing)

# Phase 4 — Worker Core: Queues, Retries, Structured Logging

**Goal:** BullMQ queues live; EHR scheduled sync works end-to-end against the simulator with
retry/backoff and DB-mirrored job state; claims + eligibility processors; DB-backed structured
logging.

**Prereqs:** Phase 3. **Read first:** doc 03 §1 (queue topology + retry policy — implement exactly).

## Tasks

1. `apps/worker/src/log.ts` — logger facade: pino to stdout **and** async insert into `LogEntry`
   (batched, non-blocking, swallow-with-console-warn on DB failure). Signature:
   `log.info({connectorId, jobId, syncRunId, incidentId, context}, message)`.
   Export for reuse by processors; web app gets its own thin variant in `apps/web/lib/log.ts`
   (route logging only).
2. `apps/worker/src/queues.ts` — queue + Worker instances for `sync`, `webhook-processing`,
   `claims-submit`, `eligibility` (health/incident/AI queues come later), using
   `DEFAULT_JOB_OPTS` from `packages/shared/src/queue-config.ts` (create it per doc 03).
   Central event wiring: on `active`/`completed`/`failed` update the mirrored DB `Job` row
   (status, attempts, errorHistory append, timestamps); attempts exhausted → `DEAD`.
3. **DB job mirroring helper** `createTrackedJob(queue, type, connectorId, payload, opts?)`:
   creates the DB `Job` row first, then enqueues BullMQ job with `{dbJobId}` merged into payload;
   returns both ids. All producers use this.
4. **Sync processor** (`processors/sync.ts`) for `ehr-fhir`:
   - Job types: `sync.start` (creates `SyncRun`, enqueues first `sync.page`) and `sync.page`
     (fetch page from simulator with 10s timeout, count records — no need to persist domain
     records, update `recordsFetched`, enqueue next page or finalize run).
   - Failure semantics: page job failures retry per policy; run marked FAILED when a page job
     dies, PARTIAL when some records were fetched before death.
   - Repeatable scheduling: on boot, register/refresh a repeatable `sync.start` per poll
     connector using `syncIntervalSec` (skip when `paused`). Also handle `trigger:"manual"`.
5. **Claims processor** (`processors/claim.ts`): `claim.submit` POSTs a faker claim to the
   simulator; success stores `claimId` in job payload result; the ack arrives later via webhook
   (phase 5 links them by `claimId` — just make sure `claimId` lands in the job row now).
6. **Eligibility processor** (`processors/eligibility.ts`): `eligibility.check` POSTs to
   simulator; on 429 read `Retry-After` and fail with a custom backoff delay honoring it
   (BullMQ custom backoff strategy); attempts 3.
7. Boot sequence in `index.ts`: prisma check → start simulator → start workers → register
   repeatables → log ready. Graceful shutdown closes workers then queues then redis.
8. Commit: `feat(worker): queues, tracked jobs, sync/claims/eligibility processors (phase 4)`.

## Acceptance criteria

- [ ] Boot worker → within `syncIntervalSec` (temporarily set 30s locally) an EHR `SyncRun`
      completes SUCCEEDED with recordsFetched > 0; `Job` rows show QUEUED→ACTIVE→SUCCEEDED
- [ ] Set `ehr-fhir` chaos OUTAGE → next run: page jobs retry with visibly exponential delays
      (check errorHistory timestamps: ~2/4/8/16/32s), then DEAD; run FAILED; ERROR LogEntries
      written with connectorId + jobId
- [ ] Set chaos HEALTHY, manually re-enqueue a DEAD job via a quick tsx script (the API comes in
      phase 6) → it SUCCEEDs and errorHistory is preserved
- [ ] Eligibility under RATE_LIMIT chaos: retry delay ≈ Retry-After (15s), not exponential
- [ ] Enqueue 5 `claim.submit` via script → all succeed, claimIds recorded
- [ ] No unhandled rejection/crash during any of the above; shutdown is clean (Ctrl+C)

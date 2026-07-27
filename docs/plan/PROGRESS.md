# Build Progress

Update this file at every phase completion. One section per phase; check off acceptance
criteria with a one-line verification note. Deviations from reference docs get logged here too.

| Phase | Status | Completed | Notes |
|---|---|---|---|
| 00 scaffold | done | 2026-07-13 | `pnpm dev` boots web (:3000) + worker (:4001/healthz); lint/typecheck/build clean; CI workflow added |
| 01 database | done | 2026-07-13 | Schema pushed + migration committed (`prisma migrate resolve --applied`); `pnpm db:seed` run twice, idempotent, counts printed |
| 02 auth | done | 2026-07-13 | Verified live in browser: 3 demo logins, wrong-password error, role-gated Settings link, sign-out, `/` redirect when signed out, `curl :3010/api/v1/health`, temp admin-gated route returned FORBIDDEN envelope to a VIEWER session (route removed after) |
| 03 simulator | done | 2026-07-13 | `poke-simulator` run against HEALTHY connectors (EHR paginates 4 pages, claim accepted, eligibility responds, 3 lab webhooks delivered — 404 expected pre-phase-5); chaos verified live: OUTAGE→503, RATE_LIMIT→429+Retry-After 15, TIMEOUT→client abort at 10s, BAD_PAYLOAD→malformed webhook body logged; HEALTHY latency spot-checked at 51-224ms |
| 04 worker queues | done | 2026-07-13 | Verified live (syncIntervalSec temporarily 30s): SyncRun SUCCEEDED w/ recordsFetched=120, Job QUEUED→ACTIVE→SUCCEEDED; OUTAGE→exponential backoff 2/4/8/16s across 5 attempts→DEAD, run FAILED, 5 ERROR LogEntries w/ connectorId+jobId; manual retry of DEAD job succeeded w/ errorHistory preserved; eligibility RATE_LIMIT→~15s retry delay (not exponential), DEAD at 3/3; 5 claim.submit all SUCCEEDED w/ claimIds; no unhandled rejections; no stuck ACTIVE jobs after process kill |
| 05 webhooks | done | 2026-07-14 | Verified live: 10 labs/emit events reached PROCESSED; tampered signature → 401 + INVALID row w/ headers captured; replayed delivery id → 200, original untouched (dedupe confirmed by row count); BAD_PAYLOAD → INVALID w/ full zod error in `error`; rejected claim.ack → WARN log + Job payload ackStatus updated; claims OUTAGE did not block lab-results ingestion (isolation confirmed) |
| 06 dashboard UI | done | 2026-07-27 | Verified live across all three roles. Overview: 4 tiles w/ 15m error rate + last activity, KPIs (63 dead / 0 open incidents / 10 events 1h / 91 jobs 1h), 24h per-connector error-rate chart, 2 seeded RESOLVED CRITICAL incidents. EHR "Run sync now" → SUCCEEDED run (120 fetched) in Sync History within one poll. As ADMIN: chaos → OUTAGE via confirm dialog quoting `connector.chaos_change {from,to}`, matching AuditEntry; as VIEWER: chaos panel + all action buttons absent, direct `POST /chaos` → `{"error":{"code":"FORBIDDEN","message":"ADMIN role required"}}` 403. OUTAGE sync → attempts ticked 1/5…5/5 → DEAD, sidebar bubble incremented. Single retry ("Job re-queued") + "Retry all matching" w/ confirm, both audited (`job.retry`, `job.retry_bulk meta.count`). "Simulate incoming results" → 5 PROCESSED events, detail sheet shows payload + `x-pulse-signature`. Eligibility modal → job SUCCEEDED. `/logs`: level filter (ERROR → 30/30 ERROR rows), connector filter (Northside only), free-text (`sync.page`), row → sheet w/ context JSON. Empty states hit on /jobs (status QUEUED), /events (VerifyMed+INVALID), /logs (no-match `q`); DataTable skeletons on first load. `pnpm lint`/`typecheck`/`build` clean (26 routes); fresh-tab console clean on /jobs, /logs, /connectors/[key] |
| 07 health + incidents | not started | | |
| 08 AI + audit | not started | | |
| 09 testing + CI | not started | | |
| 10 deployment | not started | | |
| 11 docs + polish | not started | | |

## Deviation log

- **Phase 0**: `create-next-app@latest` resolved Next 16 by default; pinned `next`/`react`/
  `react-dom` back to the 15.x/19.x lines to match the locked stack table.
- **Phase 1**: Initial migration was created via `prisma migrate diff --from-empty` +
  `prisma migrate resolve --applied` instead of `prisma migrate dev`. Reason: `migrate dev`
  detected drift against the already-seeded local dev DB (created via an earlier `db push`)
  and required `migrate reset`, which Prisma's own safety guard blocked without explicit user
  consent for a destructive action — and it would have discarded the freshly seeded demo data
  for no benefit. The diff+resolve approach produces an identical committed migration file
  without any data loss.
- **Phase 1**: Seed produces ~60 DEAD jobs (vs. the doc's "20-30") because job failures inside
  the two bad-afternoon clusters independently roll a chance of exhausting retries, on top of
  the 20-30 explicitly-seeded DEAD jobs. Still well within "failed-job queue is non-empty on
  first login"; not adjusted further.
- **Phase 2**: Web dev server is pinned to `:3010` (`next dev -p 3010`) instead of the doc's
  `:3000`. This machine has an unrelated personal-site dev server permanently squatting on
  `:3000`; rather than fight over the port on every session, Pulse's web app owns a fixed port
  of its own. `AUTH_URL`/`WEBHOOK_TARGET_URL` and `.env.example` updated to match. Production
  (Vercel) is unaffected — Vercel assigns its own port/URL.
- **Phase 2/3**: Split `apps/web/auth.ts` into an Edge-safe `auth.config.ts` (session/JWT
  callbacks + pages, no providers) used by `middleware.ts`, and `auth.ts` (adds the Credentials
  provider: bcrypt + Prisma) used by route handlers/server components. The original single-file
  config pulled bcrypt/Prisma into the Edge-runtime middleware bundle — `next build` warned
  about unsupported Node APIs (`process.nextTick`, `setImmediate`), which would very likely hard
  -fail on Vercel's actual Edge runtime. This is the standard NextAuth v5 pattern for this
  situation, not a deviation from intent, but worth recording since doc 04/phase-02 didn't
  anticipate it. Middleware bundle dropped from 150 kB to 85 kB after the split.
- **Phase 3**: `packages/shared`'s internal re-exports keep explicit `.js` extensions (required
  for `apps/worker`'s production `tsc -p tsconfig.build.json` build under `moduleResolution:
  NodeNext`). `apps/web/next.config.ts` instead adds `transpilePackages` + a webpack
  `resolve.extensionAlias` (`.js` → `.ts`/`.tsx`/`.js`) so Next's bundler resolves the same
  `.js`-suffixed specifiers to the `.ts` source. Both `pnpm build` (web + worker) and `pnpm dev`
  verified clean after this fix.
- **Phase 6**: Added an opt-in `?withTotal=1` → `{ total }` to the doc-04 pagination envelope
  (doc 04 §Conventions updated in the same commit). Needed because `/jobs`' header button
  "Retry all matching (N)" was counting only the loaded page — it read 25 while
  `POST /jobs/retry-bulk` re-queued all 63 matching DEAD jobs, so the confirm dialog understated
  what the user was about to do. The count now comes from its own COUNT query scoped to the
  connector filter (and deliberately *not* the status filter, since bulk retry only ever touches
  DEAD). `retry-bulk` also gained `orderBy: createdAt asc` so its 100-row cap drains the backlog
  oldest-first across repeated runs instead of re-picking the same head.
- **Phase 6**: `StatusBadge` now takes the status *and* an optional display `label`, and its
  colour map covers `RunStatus`/`JobStatus`/`LogLevel` alongside `ConnectorStatus`. Before this,
  `/logs` mapped levels onto connector statuses to borrow the colours, so the Level column
  literally rendered "HEALTHY" for an INFO log and "DOWN" for an ERROR — unreadable, and against
  doc 05's "level chip". Job/run statuses also fell through the map and rendered uncoloured.
- **Phase 6**: Local demo DB was re-seeded on 2026-07-27. The seed anchors its 14 days of
  history to wall-clock "now", so the data written on 2026-07-13 had aged out of every 24h
  window (`HealthSnapshot` had 2688 rows but 0 within 24h → health strip and overview chart
  rendered their empty states). Same faker seed 42, so the demo is unchanged in shape.
- **Phase 5**: Removed `pino-pretty` from `apps/web` (added in phase 2). Its worker-thread
  transport intermittently threw `Error: the worker has exited` from unrelated route handlers
  under Next.js dev-mode Fast Refresh (Next's own compilation workers appear to race with
  pino-pretty's transport thread on file-change reloads) — cosmetic in that requests still
  succeeded, but alarming and worth avoiding. `apps/web/lib/log.ts` now emits plain JSON via
  pino with no transport; `apps/worker`'s pino-pretty is unaffected (long-running process, no
  Fast Refresh) and unchanged.

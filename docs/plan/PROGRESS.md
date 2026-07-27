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
| 07 health + incidents | done | 2026-07-27 | Walked with `HEALTH_TICK_SEC=15`, `INCIDENT_STABILITY_MIN=1`. All healthy: 4 connectors × 6 snapshots per 2 min, all HEALTHY, no status drift. EHR OUTAGE + manual sync → DOWN → **one** CRITICAL incident (`Mercy General EHR (FHIR R4) is DOWN`, `aiSummaryStatus: queued`), still a single row after ~30 further ticks; timeline had `opened` + `health_transition`. Incident visible in sidebar bubble (1→2), `/incidents` list, overview tile link, and connector-detail banner; detail page rendered the AI card's "queued" state, timeline, and context panel (failed jobs 1, error logs 4, both pre-filtered links). Acknowledge as Marcus (OPS) → ACKNOWLEDGED + `status_change` + note entries + AuditEntry `incident.acknowledge {from: OPEN}`. As Priya (VIEWER): only "Sign out" rendered, no note box, and acknowledge/resolve/notes each returned `{"error":{"code":"FORBIDDEN","message":"OPS role required"}}` 403. Chaos → HEALTHY + bulk retry (45 jobs) → MONITORING, flapped back to **ACKNOWLEDGED** (not OPEN — `preMonitoringStatus` reads `acknowledgedAt`), re-entered MONITORING, then RESOLVED at 14:51:30 with `resolvedAt` set and the complete 9-entry timeline. Sustained DEGRADED (`failureRate 0.4`) on ClearPath → WARNING incident after the sustained window. `computeStatus`/`buildWindow` spot-checks: 16/16 pass via `apps/worker/src/scripts/check-health-rules.ts`, including the three doc 03 §4 cases (5 consecutive → DOWN, errorRate 0.12 → DEGRADED, empty window carries previous). lint/typecheck/build clean |
| 08 AI + audit | **blocked** — 5 of 6 criteria verified; needs a real `ANTHROPIC_API_KEY` | | Verified without a key: redaction spot-checks 24/24 (`scripts/check-redaction.ts` — identifiers, DOB vs. operational timestamps, names, known-names list, nested JSON, idempotency); outgoing context contains **zero** `PAT-`/`CLM-`/`APT-` tokens and zero seeded names (`scripts/dump-incident-context.ts`, exits non-zero if either leaks); no-key path → `queued → generating → failed` with `{"error":"AI not configured"}`, WARN log, job completes without burning its retry, and the card renders the message plus the `ANTHROPIC_KEY` hint; regenerate → 202 + `incident.summary_regenerate` audit; edit → status `edited`, `editedBy: Dana Alvarez`, machine original preserved under `aiSummary.original`, `incident.summary_edit {firstEdit:true}` audit; `/settings` audit log shows the full session history with correct actors, action filter, and a metadata sheet, users table read-only with role badges; as OPS both `/api/v1/audit` and `/api/v1/users` → 403 `ADMIN role required` and Settings is absent from the nav. lint/typecheck/build clean (30 routes). **Not verified:** the live generation criterion (card → `ready`, footer showing model + prompt v1 + timestamp) — `ANTHROPIC_API_KEY` is empty locally and supplying one is the user's call |
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
- **Phase 8**: Upgraded `@anthropic-ai/sdk` from the phase-0 `^0.68` pin to `^0.115`. doc 03 §6
  specifies `client.messages.parse()` with `zodOutputFormat()` and `output_config.format`; 0.68
  has none of them (only `betaZodTool`), so the documented call was unimplementable as written.
  doc 01's stack table already says `@anthropic-ai/sdk | latest`, so this restores the intended
  version rather than changing the plan.
- **Phase 8**: `zodOutputFormat()` accepts only `zod/v4` schemas while the repo is on zod 3's
  classic API. zod 3.25 ships both under one install, so `packages/shared/src/prompts.ts` now
  exports `IncidentSummaryAiSchema` built with `zod/v4` alongside the existing v3
  `IncidentSummarySchema` — one contract, two views, no second dependency. The `.describe()`
  calls live on the v4 schema because they are prompt surface: they reach the model as JSON
  Schema field descriptions.
- **Phase 8**: The SDK install re-resolved the lockfile and dropped `eslint-plugin-import`,
  which `eslint-config-next` requires — `apps/web` lint failed until it was added explicitly.
  Worth noting for phase 9: `apps/web` pins `eslint-config-next@16.2.10` against `next@15.5.20`.
  That mismatch predates this phase and currently works, but CI should align them.
- **Phase 8**: Context builder collapses consecutive identical log/job lines into one with a
  `(×N)` count. A retry storm writes the same message dozens of times in the same second; sent
  verbatim it spent the 8K budget on repetition and pushed the incident timeline out of the
  context entirely. The EHR incident's context went from 6327 to 2770 chars with no information
  lost.
- **Phase 7**: The pure core lives in `apps/worker/src/health/rules.ts` as the phase file
  specifies, but the tunable constants stayed in the existing `packages/shared/src/health-rules.ts`
  rather than a new `health-config.ts` — same package, same export surface, one file instead of
  two that would have to be kept in step. `getHealthConfig()` there resolves the env overrides.
- **Phase 7**: **A job row is not a call.** `loadCalls` originally counted each `Job` once, so a
  sync page that burned five retries against a dead upstream registered as *one* failure. A total
  outage then produced one failing call per sync run (every 300s), the
  `consecutiveFailures >= 5` rule needed ~25 minutes to trip, and the 15-minute window — which
  holds ~225 seeded successes — diluted the error rate to 0.9%. doc 03 §4 and the phase file both
  say "treat DEAD/FAILED **attempts** as calls", so `jobToCalls` now expands a job into one call
  per attempt using `errorHistory` (which already carries a timestamp and duration per failed
  attempt), plus a final successful call for jobs that recovered. Failed calls in the EHR window
  went from 2 to 15 and detection landed where the acceptance criterion expects it. This is the
  specified rule implemented correctly, not a loosened threshold.
- **Phase 7**: Added `HEALTH_WINDOW_MIN` alongside `HEALTH_TICK_SEC`/`INCIDENT_STABILITY_MIN`.
  doc 05's e2e flow already anticipated this ("test can force-resolve via API or shortened window
  config"): recovery is only visible once failures roll out of the rolling window, so with the
  production 15-minute window the resolve leg of the demo takes 15 real minutes no matter how
  fast the tick is. The auto-resolve leg above was observed with the window shrunk to 2 minutes;
  every rule and threshold was unchanged. Production default stays 15.
- **Phase 7**: Repeatable jobs are now fully cleared and rebuilt on every worker boot. Matching
  the previous entry by `id` did not reliably remove it, so changing `HEALTH_TICK_SEC` left the
  old scheduler running next to the new one — a 60s and a 15s health tick both firing, writing
  two snapshots on the minute (caught in the data: two rows 21 ms apart).
- **Phase 7**: Worker shutdown now awaits the simulator's HTTP server close *first*. It used to
  call `server.close()` without awaiting and then drain the queues, so a `tsx watch` reload raced
  its own replacement for `:4001` and died on `EADDRINUSE`. Reloads are cleaner, though an
  orphaned process can still win the race occasionally — if the worker dies on EADDRINUSE, kill
  the process holding 4001 and restart `pnpm dev`.
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

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
| 08 AI + audit | done | 2026-07-28 | **Live generation verified 2026-07-28** with a real key: the ClearPath WARNING incident's card went `failed → queued → generating → ready` on Regenerate, footer read "Generated by claude-opus-4-8 · prompt v1", confidence chip "medium", and a `✨ AI summary generated (claude-opus-4-8, prompt v1)` timeline entry was written. The summary correctly identified the HTTP 500s and the ~7-minute window, **separated them from the unrelated "missing prior authorization" claim rejections in the same window**, and stated that "the underlying trigger of the 500s is not shown" — i.e. it reasoned from symptoms without being told the chaos mode, which is exactly what excluding it from the context is meant to force. Previously verified without a key: redaction spot-checks 24/24 (`scripts/check-redaction.ts` — identifiers, DOB vs. operational timestamps, names, known-names list, nested JSON, idempotency); outgoing context contains **zero** `PAT-`/`CLM-`/`APT-` tokens and zero seeded names (`scripts/dump-incident-context.ts`, exits non-zero if either leaks); no-key path → `queued → generating → failed` with `{"error":"AI not configured"}`, WARN log, job completes without burning its retry, and the card renders the message plus the `ANTHROPIC_KEY` hint; regenerate → 202 + `incident.summary_regenerate` audit; edit → status `edited`, `editedBy: Dana Alvarez`, machine original preserved under `aiSummary.original`, `incident.summary_edit {firstEdit:true}` audit; `/settings` audit log shows the full session history with correct actors, action filter, and a metadata sheet, users table read-only with role badges; as OPS both `/api/v1/audit` and `/api/v1/users` → 403 `ADMIN role required` and Settings is absent from the nav. lint/typecheck/build clean (30 routes). **Not verified:** the live generation criterion (card → `ready`, footer showing model + prompt v1 + timestamp) — `ANTHROPIC_API_KEY` is empty locally and supplying one is the user's call |
| 09 testing + CI | done | 2026-07-28 | See the phase-9 section below |
| 10 deployment | **code done; live deploy is the user's step** | 2026-07-28 | Prod-readiness pass + runbook complete; the five acceptance criteria all require account access (Railway/Vercel) and cannot be met from the repo |
| 11 docs + polish | done except screenshots + Loom | 2026-07-28 | README case study, OpenAPI + `/docs/api`, metrics script, positioning, Loom script. Screenshots and the recording are user tasks |
| 12 credibility + baseline | code complete; deploy pending | 2026-08-09 | pnpm pin/lockfile, lint alignment, format gate, Prisma silent logging, license, README quickstart, and all local gates pass; Railway/Vercel account smoke remains user-authenticated |
| 13 AI foundation | planned | — | Phase specification added; implementation pending |
| 14 evals | planned | — | Phase specification added; implementation pending |
| 15 copilot | planned | — | Phase specification added; implementation pending |
| 16 hardening | planned | — | Phase specification added; implementation pending |

## Phase 9 — acceptance criteria

- [x] **`pnpm test` green locally with only Docker services running** — 178 unit tests (9 files,
      no services) + 51 integration tests (3 files, real Postgres + Redis) all pass.
      `test:unit` needs nothing but Node; `test:integration` creates and migrates a dedicated
      `pulse_test` database via its own global setup and truncates every table between tests.
- [x] **`pnpm test:e2e` green locally from a fresh seed** — 7/7 pass in 2.4 min, including the
      full doc-05 demo flow (2.2 min) end to end: chaos OUTAGE → sync → retries → DEAD → DOWN →
      incident opens → AI degrades cleanly with no key → chaos HEALTHY → bulk retry → recovery →
      MONITORING → RESOLVED → audit log shows the chaos change and retries attributed to Dana.
      `scripts/prepare-e2e-db.mjs` creates, migrates, truncates and seeds `pulse_e2e` first.
- [x] **CI green on GitHub for the full pipeline** — repo published at
      `github.com/BMcCarthy96/pulse` on 2026-07-29; the first push went green on all five jobs,
      first try:
      lint-typecheck 51s · unit + coverage 19s · integration 54s · build 67s · e2e 4m28s
      ([run 30452059391](https://github.com/BMcCarthy96/pulse/actions/runs/30452059391)).
      The e2e job runs the full demo flow against a production build with real Postgres and Redis
      service containers, so the slowest and most integration-heavy part of the suite is covered
      in CI rather than only locally.

      The artifact-on-failure clause was verified separately by forcing an e2e assertion to fail
      on a throwaway branch (PR #1, closed unmerged, branch deleted — `main`'s history is clean):
      the four preceding jobs passed, the e2e job failed, and `playwright-report` (1.6 MB)
      uploaded as designed
      ([run 30452689576](https://github.com/BMcCarthy96/pulse/actions/runs/30452689576)).
- [x] **Coverage shows `health/rules.ts` and `ai/redact.ts` at 100% branch** — both at 100% on
      statements, branches, functions and lines. Vitest's per-file thresholds fail the run on
      regression, and `scripts/check-coverage-claims.mjs` prints the numbers, because the text
      reporter omits files that are fully covered — the two files the README makes claims about
      were precisely the two it would never print.
- [x] **Prompt snapshot fails when the prompt is edited without a version bump** — verified by
      editing `INCIDENT_SUMMARY_PROMPT_V1` and re-running: the snapshot assertion failed as
      designed. Reverted.

### Phase 9 — bugs the tests found

Nine real defects, all fixed in the same phase:

1. **Phone redaction left punctuation outside the token.** `\b` cannot open a pattern whose first
   character may be `+` or `(`, so `(555) 867-5309` redacted to `([REDACTED:phone]`. Replaced with
   a `(?<!\w)` lookbehind.
2. **Known-name redaction silently failed for names ending in punctuation.** Same root cause —
   `\b` requires a word character on the inside of the boundary, so `Kessler (Ops)` never matched
   at all. Now uses lookarounds.
3. **`INCIDENT_STABILITY_MIN=0` was treated as unset.** `n > 0 ? n : fallback` substituted the
   10-minute production default, which made the e2e configuration documented in `.env.example`
   and the phase-9 file impossible to actually run. Zero is now allowed for the stability windows
   and still rejected for the tick interval and window length, where it would be meaningless.
4. **`Retry-After` parsing could produce `NaN`.** `Number(header ?? "15")` on a non-numeric header
   yields `NaN`, and a `NaN` delay makes BullMQ retry immediately — turning a rate-limit response
   into a tight loop against an upstream that just asked for backoff. Extracted
   `parseRetryAfterMs` with a fallback, a 5-minute clamp, and RFC 7231 HTTP-date support.
5. **`Date.parse` accepted garbage as a date.** `Date.parse("Someday, 32 Jul")` returns a valid
   far-future timestamp via V8's lenient fallback parser, so a malformed header was read as a
   genuine 5-minute throttle. Now matched strictly against IMF-fixdate first.
6. **Incidents opened with `aiSummaryStatus: "none"`** while a summary job was already enqueued,
   so the card claimed no summary had been requested for as long as the worker was busy or down.
   Now opens as `queued`.
7. **The health rules' injection seam could not inject.** `StatusRules` was
   `Pick<typeof HEALTH_RULES, ...>`; because `HEALTH_RULES` is `as const`, the picked types were
   literals (`5`, `0.5`, …) and the `rules` parameter accepted only the default values. Widened to
   an explicit interface.
8. **A stale module-level org-id cache in `apps/web/lib/log.ts`** was never invalidated, so it
   outlived the row it pointed at and turned every subsequent `logToDb` into a silent foreign-key
   failure inside its own catch. Removed; the lookup is indexed and only runs on WARN/ERROR.
9. **`node:crypto` reached the browser bundle.** Re-exporting the new `webhook-signature` module
   from `packages/shared`'s barrel broke `next build` with
   `UnhandledSchemeError: Reading from "node:crypto"`, because the barrel is reachable from the
   login page. Moved to a `@pulse/shared/webhook-signature` subpath export.

## Phase 10 — status

The prod-readiness pass (task 1) and the runbook (task 7) are complete:

- `apps/worker/Dockerfile` — multi-stage, builds from the repo root with pnpm workspace pruning,
  `NODE_ENV=production`, non-root user, and a healthcheck against the simulator's `/healthz`
  (which only listens once Postgres and Redis are connected, making it a real readiness signal).
- `railway.json` — Dockerfile builder, healthcheck path, restart policy, `numReplicas: 1` (the
  health tick is a singleton; two replicas would double every snapshot).
- Migrations run at boot via `prisma migrate deploy` in the start command; the migration files
  ship inside the image so no repository checkout is needed.
- `docs/deployment.md` — full runbook: env tables for both platforms, the Vercel root-directory
  trap, the public-vs-internal Railway endpoint trap, the circular `WEBHOOK_TARGET_URL`
  dependency and its ordering, the one-time `SEED_FORCE=1` seed, a smoke-test checklist, restart
  resilience checks, uptime monitoring, cost breakdown, and a troubleshooting table.

**All five acceptance criteria are blocked on account access** (public URL, live demo flow,
Railway restart behaviour, redeploy-from-zero verification, cost confirmation). The phase file
anticipates this — it is marked human-in-the-loop for "account creation, tokens, and dashboard
clicks". Nothing further can be verified from the repository.

## Phase 11 — status

Done:

- **README** rewritten as an engineering case study: problem statement, why the failure modes are
  simulated, mermaid architecture + event-flow + incident-state diagrams, retry/backoff table,
  health rules with the two decisions that matter, AI design (redaction boundary, why the model
  cannot see the chaos flag, structured output, prompt versioning, degradation, cost), real
  metrics, testing strategy, security and RBAC matrix, quickstart, env table, tradeoffs.
- **Metrics are real and reproducible** — `pnpm --filter @pulse/db metrics` prints each figure
  with the SQL that produced it. Error rate 16.58% (697/4,203 attempts), retry success 75.16%
  (478/636), MTTD 30s, MTTR 127m over 4 incidents, 15.8 jobs/hour over 201h.
- **OpenAPI** — `docs/openapi.yaml` documents all 27 operations, served at `/api/v1/openapi` (YAML, or
  JSON with `?format=json`) and rendered at `/docs/api`. The smoke test does more than parse: it
  walks `app/api/v1` and asserts the spec and the implementation agree in **both** directions.
  It immediately caught the `/openapi` route itself as undocumented.
- **`docs/loom-script.md`** and **`docs/positioning.md`** written.

- **Tag `v1.0.0`** — annotated tag `v1.0.0` points at `5d13f60`, pushed to the published repo.
  CI run [30453432114](https://github.com/BMcCarthy96/pulse/actions/runs/30453432114) on that
  exact commit is green across all five jobs (lint-typecheck, unit + coverage, integration,
  build, e2e). Note the workflow triggers on `push: branches: [main]` and `pull_request`, not on
  tag refs, so pushing the tag did not start a second run — the criterion is met by the tagged
  commit's own run rather than by a tag-triggered one.

- **All five screenshots** are in `docs/media/` and embedded in the README at the point each one
  illustrates, rather than dumped in a gallery: overview (hero), connector + chaos panel, DEAD
  job queue, incident with its Claude summary, audit log. They are **generated, not hand-framed**
  — `pnpm --filter @pulse/web screenshots` runs
  [`apps/web/scripts/capture-screenshots.mjs`](../../apps/web/scripts/capture-screenshots.mjs)
  against a running stack, signs in as the admin persona, and picks the incident to shoot by
  querying for one with a finished AI summary. Pinned viewport (1440px, ~1.6x GitHub's content
  column), locale and timezone, and Recharts left to settle first.

  Regeneration is stable in *framing*, not byte-identical: relative timestamps ("5m ago") and the
  live 1h counters move while the worker is ticking, so re-running it against a live stack
  rewrites four of the five files with the same layout and newer numbers. Worth knowing before
  anyone treats an image diff as a regression.

  I had previously recorded this criterion as needing a human. That was wrong — scripting it is
  both possible and better, because "consistent seeded state" (phase 11 task 3) is a property a
  script can actually hold and a human cannot.

  Two things checked while capturing, both worth recording:
  - The Next dev-tools bubble floats over the bottom-left of every page under `pnpm dev` and
    landed in the first set of captures. The script now hides `<nextjs-portal>` per navigation,
    rather than disabling `devIndicators` globally and degrading normal development.
  - The 24-hour error-rate chart is **flat on fresh seed data**, and that is correct, not a bug:
    `docs/plan/05-ui-spec.md:35` specifies a 24h window and the seed's two failure clusters sit
    at 2 and 5 days back. Verified before changing anything — a re-seed would not have altered
    it, since the seed builds those windows relative to `NOW`. The README says so under the hero
    instead of implying the chart is normally empty.

Outstanding, and genuinely a user task:

- **The Loom recording** — script is written and rehearsable against the local app.

## Known issues

- **`pnpm format:check` fails on 117 files** (105 code, 12 markdown) and always has — Prettier is
  configured and the script is advertised in the README, but the codebase was never run through
  it. CI does not run it, which is why it went unnoticed.

  Deliberately **not** fixed in a bulk pass, for two reasons found by actually running it:
  Prettier pads markdown tables to the width of the widest cell, which turns the phase table at
  the top of this file into 400-character lines; and `prettier-plugin-tailwindcss` reorders
  `className` strings across every component, which is a change to rendered CSS ordering, however
  low-risk, and not something to land unreviewed on the same day as the `v1.0.0` tag.

  The fix is a decision, not a task: either add `**/*.md` to `.prettierignore`, run
  `pnpm format` over the code, and add `format:check` to CI so it stays true — or drop the script
  and the Prettier config. Leaving an advertised command that fails is the one option worse than
  both.

## Post-v1.0.0 fixes

- **The worker image had never been built, and did not work** (fixed 2026-07-31). Phase 10 was
  recorded as "code done"; the Dockerfile, `railway.json` and runbook were all written, and the
  runbook called them "production-ready". Attempting the actual deployment turned up **four**
  independent defects, each fatal to a Railway deploy, discovered strictly one at a time because
  each one masked the next:

  1. **No `.dockerignore`.** The build context included pnpm's symlink farm; Docker refused it
     before pulling a layer — `invalid file request apps/worker/node_modules/@anthropic-ai/sdk`.
  2. **No `prisma` CLI in the runtime image.** A devDependency of `packages/db`, correctly
     stripped by `pnpm --prod deploy`, but the container boots with `npx prisma migrate deploy` —
     which would have downloaded the CLI from npm on every start, against a 60s healthcheck and
     `restartPolicyMaxRetries: 5`. Moved to `apps/worker`'s runtime dependencies.
  3. **`packages/shared` and `packages/db` published raw TypeScript.** Fine under Next
     (`transpilePackages`), tsx and vitest; fatal under `node dist/index.js`, which cannot strip
     types inside `node_modules` — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Both packages
     now have `tsconfig.build.json` + a `build` script and expose `dist/*.js` under the `default`
     export condition, while `types` still points at source so `pnpm typecheck` and editors need
     no build. The vitest configs alias `@pulse/*` back to source, so the suites neither require
     a build nor drift off the `packages/shared/src/**` paths the coverage thresholds name.
     (Chosen by the user over bundling with esbuild, which would have added a dependency outside
     doc 01's stack table.)
  4. **The generated Prisma client did not survive the prune.** `pnpm deploy` rebuilds
     `node_modules` from the store, so `@pulse/db generate`'s output was left behind —
     *"@prisma/client did not initialize yet"*. Generation now runs inside `/prune`, from a
     schema copied in beside it; pointing `--schema` back at `/app` silently regenerates into the
     wrong tree, because Prisma resolves its output relative to the schema. `@prisma/client` also
     had to become a direct worker dependency, or pnpm's strict layout leaves it unhoisted and
     the generator tries to `npm i` it mid-build.

  Verified by running it: image builds, boots against real Postgres and Redis, applies the
  migration to an empty database, connects to both stores, starts all six queues, and answers
  `/healthz` with `{"ok":true}` — container reports `healthy`.

  A **`Worker image` CI job** now builds the image and asserts it boots and goes healthy on every
  push. `pnpm build` proved nothing about the deployable artifact; three of these four defects
  would have been caught by that job on day one. 178 unit / 51 integration / 7 e2e all still
  green after the restructure.

  Still outstanding and genuinely the user's: the deploy itself needs Railway and Vercel account
  access.


- **`HealthStrip` width tracked the health tick rate** (fixed 2026-07-30, commit `91b43ea`).
  It rendered one segment per `HealthSnapshot`, and `gap-px` contributes 1px of min-content
  width per segment — a flex container's automatic minimum size is its min-content width, so
  `w-full` could not shrink it back. At doc 03's 60s tick that is 1,440 segments; at the 15s
  tick this machine uses for walkthroughs it was 5,756, which stretched every ancestor and made
  the connector page 6,059px wide inside a 1,440px viewport.

  It hid well: `overflow-hidden` on the card clipped the strip itself, so the page looked
  correct while carrying a horizontal scrollbar, and the chaos panel's radios sat 3,161px
  off-screen — unreachable by mouse at any normal window size. Found by trying to drive the
  phase-7 outage walkthrough through the UI rather than through scripts, which is the one thing
  none of the 229 tests did: the e2e suite drives the panel by role selector, and a selector
  does not care that its target is off-screen.

  Now a fixed 96 buckets (15-minute resolution over the 24h the API returns), aggregated
  worst-wins so a brief outage cannot average away. Pure logic split into
  `apps/web/lib/health-strip-buckets.ts`, mirroring `health/rules.ts` vs `health/engine.ts`;
  7 unit tests, verified failing (4 of 7) with the bucketing disabled.

## Deviation log

- **Phase 9**: Added `@playwright/test` (already in doc 01's stack table) and **`yaml`**
  (not in the stack table). The parser is needed for phase 11's two OpenAPI deliverables — the
  `/docs/api` page and the "smoke test that the YAML parses" that doc 04 §OpenAPI requires. It is
  a zero-dependency package and there is no way to satisfy those tasks without one. Flagging it
  here per CLAUDE.md rule 5 rather than treating it as free.
- **Phase 9**: `packages/shared`'s barrel deliberately does **not** re-export
  `webhook-signature.ts`; it is reached at `@pulse/shared/webhook-signature` via a subpath export.
  The module imports `node:crypto`, and the barrel is reachable from client components (the login
  page imports `APP_NAME`), so re-exporting it fails `next build` with
  `UnhandledSchemeError: Reading from "node:crypto"`. Left as a subpath rather than splitting the
  package.
- **Phase 9**: The webhook route handler's logic moved into `apps/web/lib/ingest-webhook.ts`, as
  phase 9 task 3 suggested ("extract signature-verify + persist + enqueue into a lib function
  `ingestWebhook()` used by the route, and integration-test that"). The route is now a thin
  status-code adapter.
- **Phase 9**: The e2e database is prepared by `apps/web/scripts/prepare-e2e-db.mjs` running
  *before* Playwright, not by Playwright's `globalSetup`. Playwright starts its `webServer`
  processes before global setup runs, so the worker booted against a database that did not exist
  yet and exited.
- **Phase 9**: Root `package.json` gained `@pulse/db` and `@pulse/shared` as workspace
  devDependencies so the shared integration-test harness under `test/integration/` can import
  them. pnpm only links workspace packages into the packages that declare them.
- **Phase 10**: `railway.json` pins `numReplicas: 1`. The health tick is a singleton by design —
  two replicas would each register the repeatable and write two snapshots per interval, which is
  the same class of bug as the duplicate-scheduler problem found in phase 7.

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

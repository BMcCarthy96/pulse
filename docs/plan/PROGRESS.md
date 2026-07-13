# Build Progress

Update this file at every phase completion. One section per phase; check off acceptance
criteria with a one-line verification note. Deviations from reference docs get logged here too.

| Phase | Status | Completed | Notes |
|---|---|---|---|
| 00 scaffold | done | 2026-07-13 | `pnpm dev` boots web (:3000) + worker (:4001/healthz); lint/typecheck/build clean; CI workflow added |
| 01 database | done | 2026-07-13 | Schema pushed + migration committed (`prisma migrate resolve --applied`); `pnpm db:seed` run twice, idempotent, counts printed |
| 02 auth | done | 2026-07-13 | Verified live in browser: 3 demo logins, wrong-password error, role-gated Settings link, sign-out, `/` redirect when signed out, `curl :3010/api/v1/health`, temp admin-gated route returned FORBIDDEN envelope to a VIEWER session (route removed after) |
| 03 simulator | not started | | |
| 04 worker queues | not started | | |
| 05 webhooks | not started | | |
| 06 dashboard UI | not started | | |
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

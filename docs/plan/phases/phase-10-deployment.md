# Phase 10 — Deployment

**Goal:** Live system: web on Vercel, worker + Postgres + Redis on Railway, seeded demo data,
webhooks flowing Railway → Vercel. Target spend ≤ ~$10/mo (Railway hobby).

**Prereqs:** Phase 9 (deploy a tested system). **Human-in-the-loop:** this phase needs the user
for account creation, tokens, and dashboard clicks — the implementing model prepares configs and
gives exact instructions rather than guessing at UI steps.

## Tasks

1. **Prod-readiness pass** (code, before any account work):
   - Worker `Dockerfile` (or Railway nixpacks config) building from repo root with pnpm
     workspace pruning; `NODE_ENV=production`; healthcheck hitting simulator `/healthz`.
   - Next.js: confirm no build-time env access that breaks Vercel; `next.config` output
     defaults fine.
   - Seed guard already exists (phase 1) — add `SEED_FORCE=1` documented path for the one-time
     prod seed.
   - `prisma migrate deploy` step wired into worker boot (or a Railway release command).
2. **Railway** (user does clicks, model supplies exact values):
   - Project with Postgres + Redis plugins + worker service from the GitHub repo.
   - Env vars per architecture doc (DATABASE_URL/REDIS_URL from plugin references;
     `WEBHOOK_TARGET_URL` = Vercel URL — set after step 3; `ANTHROPIC_API_KEY`; shrunk
     `HEALTH_TICK_SEC=30` is fine in prod).
   - One-time seed via `railway run pnpm db:seed` (with SEED_FORCE).
3. **Vercel**: import repo, root `apps/web`, env vars (AUTH_SECRET, AUTH_URL, DATABASE_URL,
   REDIS_URL, WEBHOOK_SIGNING_SECRET, NEXT_PUBLIC_DEMO_PASSWORD). Note: Vercel must reach
   Railway Postgres/Redis over their **public** endpoints — use those connection strings.
4. Circular config note: deploy Vercel first with a placeholder `WEBHOOK_TARGET_URL` on Railway,
   then update Railway with the real Vercel URL and redeploy worker.
5. **Smoke the live system** (the phase-6/7 walkthroughs, abbreviated): login, chaos OUTAGE,
   sync fails, incident opens, AI summary generates, recover, resolve. Confirm webhooks arrive
   cross-cloud (lab simulate button).
6. **Ops touches** (cheap but high-signal):
   - UptimeRobot (or similar free) pinging `/api/v1/health` — screenshot for README.
   - Vercel + Railway log retention noted in README's "operations" section.
7. Document every step taken in `docs/deployment.md` (real commands, real gotchas hit).
8. Commit: `chore(deploy): production configs + deployment runbook (phase 10)`.

## Acceptance criteria

- [ ] Public URL: demo login works for all three personas
- [ ] Full demo flow passes on prod (incl. cross-cloud webhook delivery and a real AI summary)
- [ ] Worker survives a Railway restart: repeatables re-register, no duplicate incidents
- [ ] `docs/deployment.md` is complete enough that redeploying from zero is mechanical
- [ ] Costs verified: Railway plan + expected usage documented

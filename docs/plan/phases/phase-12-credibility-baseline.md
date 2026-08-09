# Phase 12 — Credibility, Reproducibility & Safe Baseline

**Goal:** Make the repository reproducible and deploy the existing system with AI disabled by default.

**Prereqs:** Phase 11 complete; production account authentication remains human-in-the-loop.

## Tasks

1. Pin pnpm and align the lint/package toolchain; remove stale dependencies and false-green test scripts.
2. Silence intentional Prisma test errors and make `format:check` pass without formatting the progress ledger.
3. Add the MIT license, remove obsolete placeholders, and restructure the README around the live demo.
4. Add Phase 13–16 plan documents and update the progress ledger with evidence checkpoints.
5. Deploy to Railway/Vercel with `ANTHROPIC_API_KEY` unset, then run every deployment smoke step.

## Acceptance criteria

- [ ] `pnpm install --frozen-lockfile` uses the pinned package manager and CI has no floating pnpm version.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, and `pnpm build` pass.
- [ ] README, license, dependency, and test-script hygiene changes are reviewed separately from formatting churn.
- [ ] Production dashboard and webhook smoke tests pass with AI degrading honestly and no paid model calls.

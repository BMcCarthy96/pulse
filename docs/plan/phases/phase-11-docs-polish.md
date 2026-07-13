# Phase 11 — Documentation, Polish & Portfolio Packaging

**Goal:** Convert a working system into a portfolio asset: README that reads like an
engineering case study, OpenAPI docs, metrics, screenshots, Loom script, resume bullets.

**Prereqs:** Phase 10 (live URLs and real metrics to cite).

## Tasks

1. **README.md** (the single most-read artifact — budget real effort). Structure:
   1. One-paragraph problem statement + hero screenshot + live demo link + demo credentials
   2. "Why the failure modes are simulated" (chaos panel as a feature; reproducible demos)
   3. Architecture diagram (mermaid from doc 01, verified against reality) + deployment topology
   4. Event flow diagram: chaos → failing sync → retries → DEAD → health engine → incident →
      AI summary → recovery (mermaid sequence)
   5. Retry & backoff policy table (from doc 03 §1, as implemented)
   6. Health rules + incident lifecycle (state diagram)
   7. AI design: context building, **PHI redaction boundary**, structured output, prompt
      versioning, graceful degradation, why the model can't see the chaos flag
   8. **Metrics** (compute from real seeded+live data): error rate definition, retry success
      rate, MTTD, MTTR, job throughput — with the SQL/queries used
   9. Testing strategy (what's unit vs integration vs e2e and why) + CI badge
   10. Security notes: HMAC webhooks, RBAC matrix, audit coverage, synthetic-data statement
   11. Local dev quickstart + env table
   12. Tradeoffs & next steps (polling vs SSE, single-org vs multi-tenant, hand-written OpenAPI,
       rollup tables) — honest, specific
2. **OpenAPI** `docs/openapi.yaml` per doc 04 §OpenAPI + `/docs/api` page + parse smoke test.
3. **Screenshots/GIFs** into `docs/media/`: overview, connector w/ chaos panel, failing jobs,
   incident with AI summary, audit log. Consistent seeded state (re-seed first).
4. **Polish pass** (timebox: 1–2 days):
   - Empty/loading/error states audit on every page
   - Copy audit against doc 05 vocabulary rules
   - Favicon + title metadata; login page niceties
   - Lighthouse sanity on overview (no perf work beyond obvious wins)
5. **Loom script** `docs/loom-script.md` (2:30 target):
   - 0:00 problem + who it's for (healthcare ops teams flying blind on integrations)
   - 0:20 overview dashboard tour
   - 0:45 chaos → outage → watch retries/backoff live in jobs view
   - 1:20 incident auto-opens → AI summary (call out redaction + prompt versioning)
   - 1:50 recovery: retry queue, health restores, incident resolves, audit trail
   - 2:15 architecture slide + tests/CI proof → close
6. **Resume/LinkedIn snippets** `docs/positioning.md`: the bullet from doc 00, a 2-sentence
   LinkedIn project blurb, and per-role emphasis notes (internal tools vs AI solutions vs
   integration engineer).
7. Optional stretch (only if all above done): `erx` connector, alert thresholds, runbook pages.
8. Final commit + tag `v1.0.0`.

## Acceptance criteria

- [ ] A stranger can clone → `docker compose up -d && pnpm install && pnpm db:push && pnpm db:seed
      && pnpm dev` → working app, from README alone
- [ ] README metrics are real numbers with reproducible queries, not invented
- [ ] All five screenshots current; diagrams match implemented reality (cross-check queue names,
      routes, statuses)
- [ ] `/docs/api` renders the OpenAPI spec; spec covers every doc-04 route
- [ ] Loom recorded and linked (user task) — script rehearsed against live site
- [ ] Tag `v1.0.0` pushed; CI green on the tag

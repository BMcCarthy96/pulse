# Pulse — Integration Health Dashboard for Healthcare Operations

## What this is

**Pulse** is a monitoring console for a healthcare organization's third-party integrations —
EHR syncs, lab result feeds, claims submissions, and eligibility checks. It shows operations
staff which integrations are healthy, surfaces failures with structured logs and retry
controls, auto-opens incidents when a connector degrades, and drafts AI-generated incident
summaries for the ops team (with PHI redaction before anything reaches the LLM).

All upstream systems are **simulated in-repo** with a chaos-injection control panel, so every
failure mode is reproducible on demand — that is a feature of the demo, not a shortcut.

## Why it exists (portfolio context)

This is portfolio project #2 from a hiring-signal analysis. It proves the signals a marketing
site cannot: background jobs, retry/backoff, queues, structured logging, observability,
incident handling, testing, CI/CD, and deployment discipline. Target roles: Internal Tools
Engineer, AI Solutions Engineer, Integration Developer, Full-Stack AI, Customer Engineer.

The healthcare theming leverages the builder's healthcare documentation/workflow background
and differentiates against generic CRM-sync demos.

**Resume bullet this project must be able to back up:**

> Built a monitoring console for healthcare integrations with job queues, retry logic,
> structured logs, sync health views, and AI-generated incident summaries (with PHI
> redaction) for failed workflows — Next.js/TypeScript, PostgreSQL, Redis/BullMQ,
> deployed on Vercel + Railway with CI, unit, and e2e tests.

## Personas (seeded users)

| Persona      | Role     | What they see/do                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------------------ |
| Dana Alvarez | `ADMIN`  | Everything: connector config, chaos panel, user list, audit log                      |
| Marcus Webb  | `OPS`    | Dashboard, retry failed jobs, acknowledge/resolve incidents, regenerate AI summaries |
| Priya Nair   | `VIEWER` | Read-only dashboards and incident history (a compliance/leadership view)             |

Login screen has one-click "demo as…" buttons for each persona (credentials are still real
email/password under the hood — the buttons just prefill and submit).

## The five simulated connectors

| Key           | Display name                      | Pattern it demonstrates                                             |
| ------------- | --------------------------------- | ------------------------------------------------------------------- |
| `ehr-fhir`    | Mercy General EHR (FHIR R4)       | Scheduled polling sync (repeatable jobs, pagination, checkpointing) |
| `lab-results` | Northside Labs (HL7v2 ORU)        | Inbound webhooks (signature verification, dedupe, async processing) |
| `claims`      | ClearPath Clearinghouse (X12 837) | Outbound jobs + async acknowledgment webhooks (two-phase workflow)  |
| `eligibility` | VerifyMed Eligibility (270/271)   | On-demand request/response, upstream rate limiting (429 + backoff)  |
| `erx`         | ScriptLine e-Prescribing (NCPDP)  | **Stretch only** — build if time allows, phase 11                   |

Every connector's upstream is a simulated HTTP service (see [01-architecture.md](01-architecture.md))
with per-connector chaos config: `healthy`, `degraded`, `outage`, `timeout`, `rate_limit`,
`bad_payload`, `auth_failure`.

## Core features (must ship)

1. **Overview dashboard** — health tiles per connector, error-rate chart, throughput, open incidents.
2. **Connector detail** — sync history, recent jobs, event feed, health timeline, chaos panel (admin).
3. **Failed job queue** — filterable list, per-job detail (payload, attempts, errors), manual retry, bulk retry.
4. **Event viewer** — inbound/outbound webhook log with payload inspector and processing status.
5. **Structured log explorer** — filter by level/connector/job/time.
6. **Health engine** — rolling-window status computation (healthy/degraded/down) + history snapshots.
7. **Incidents** — auto-open on degradation, timeline, acknowledge/resolve, auto-resolve on recovery.
8. **AI incident summaries** — Claude-drafted summary + probable cause + suggested runbook steps, generated from redacted logs/events; regenerate + edit; prompt version recorded.
9. **Audit log** — every human action (retry, chaos change, incident ack/resolve, summary edit) recorded.
10. **Auth + roles** — credentials auth, three roles, role-gated UI and API.

## Stretch features (only after phase 11)

- Alert thresholds + email/Slack notification stubs
- `erx` fifth connector
- Runbook markdown pages linked from incidents
- Org/tenant switcher (schema is already tenant-ready via `orgId`)
- Metrics rollup table for faster charts at scale

## Explicit non-goals

- No real PHI, ever. All patient-like data is synthetic (faker-generated).
- No real third-party API accounts. Everything upstream is simulated.
- No multi-org UI (single seeded org; schema carries `orgId` everywhere).
- No RAG/chatbot. The only LLM use is structured incident summarization.
- No mobile-specific UI (responsive enough to not embarrass, desktop-first).

## Definition of done (project level)

- [ ] All 11 phases complete, acceptance criteria checked
- [ ] Live URL (Vercel) + worker running (Railway) with seeded demo data
- [ ] Demo flow works end-to-end: log in → inject outage via chaos panel → watch health degrade →
      incident auto-opens → AI summary drafts → retry failed jobs → health recovers → incident resolves
- [ ] CI green: lint, typecheck, unit tests, e2e smoke
- [ ] README with architecture diagram, event-flow diagram, retry policy, metrics definitions, screenshots
- [ ] 2–3 minute Loom recorded following `docs/plan/11-*` script

## How to use this plan

Phases live in `docs/plan/phases/phase-XX-*.md` and are strictly ordered — each declares its
prerequisites. An implementing agent should load **CLAUDE.md + the current phase file only**
(plus the reference docs the phase points at). Do not read all phases at once; do not skip
acceptance criteria. Reference docs:

- [01-architecture.md](01-architecture.md) — system layout, stack, repo structure, env vars
- [02-data-model.md](02-data-model.md) — full Prisma schema, enums, seed spec
- [03-queues-events-health.md](03-queues-events-health.md) — queue topology, retry policy, webhook contracts, chaos spec, health rules, incident lifecycle
- [04-api-spec.md](04-api-spec.md) — REST surface, auth rules, error envelope
- [05-ui-spec.md](05-ui-spec.md) — pages, components, states, role gating

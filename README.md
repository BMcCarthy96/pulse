# Pulse — Integration Health Dashboard

> **Status: planning complete, build not started.** This README is a placeholder; the real one
> is written in phase 11. See [docs/plan/00-overview.md](docs/plan/00-overview.md) for what this
> project is and [docs/plan/PROGRESS.md](docs/plan/PROGRESS.md) for build status.

Pulse is a monitoring console for a healthcare organization's third-party integrations — EHR
syncs, lab result feeds, claims submissions, eligibility checks — with job queues, retry logic,
structured logs, health scoring, auto-opened incidents, and AI-drafted (PHI-redacted) incident
summaries. All upstream systems are simulated in-repo with a chaos-injection panel so every
failure mode is reproducible on demand.

Stack: Next.js 15 · TypeScript · PostgreSQL/Prisma · Redis/BullMQ · Anthropic API · Vitest ·
Playwright · Vercel + Railway.

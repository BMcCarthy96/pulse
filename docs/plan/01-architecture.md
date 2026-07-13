# Architecture & Stack

## System diagram

```mermaid
flowchart LR
    subgraph Vercel
        WEB["apps/web\nNext.js 15 (App Router)\nUI + API routes + Auth.js"]
    end

    subgraph Railway
        WORKER["apps/worker\nNode + BullMQ processors\nhealth engine (cron)\nAI summarizer"]
        SIM["Simulator (Hono HTTP server,\nruns inside worker process, port 4001)\nMercy EHR / Northside Labs /\nClearPath / VerifyMed"]
        PG[(PostgreSQL 16)]
        REDIS[(Redis 7)]
    end

    ANTHROPIC["Anthropic API\n(incident summaries)"]

    WEB -- Prisma --> PG
    WEB -- "enqueue (BullMQ)" --> REDIS
    WORKER -- Prisma --> PG
    WORKER -- "consume/produce" --> REDIS
    WORKER -- "HTTP (sync pulls, claim submits,\neligibility checks)" --> SIM
    SIM -- "webhooks (lab results, claim acks)" --> WEB
    WORKER -- "redacted context" --> ANTHROPIC
```

Key decisions and the *why* (these appear in the README later — keep them honest):

| Decision | Rationale |
|---|---|
| Separate worker service (not Vercel functions) | Long-running consumers, repeatable jobs, and backoff timers don't fit serverless timeouts. This separation *is* one of the portfolio signals. |
| Simulator runs **in the worker process** but is called **over real HTTP** | Real network layer (timeouts, 5xx, connection resets are genuine) without a third deployment to manage. |
| Simulator sends webhooks to the **web app's** public URL | Demonstrates real inbound webhook handling (signature verification, dedupe) on the deployed system. |
| BullMQ over pg-boss/cron | Industry-standard Redis queues; recruiters recognize it; gives retry/backoff/DLQ semantics for free. |
| Prisma over Drizzle | Most-documented ORM = lowest error rate for the implementing model; migration story is one command. |
| Jobs mirrored into Postgres (not only Redis) | The dashboard needs durable, queryable job history with attempt-level errors; Redis entries are pruned. |
| Health status computed by worker on a 60s repeatable job | Deterministic, testable pure function over DB rows; UI just reads. |

## Stack (locked — do not substitute)

| Layer | Choice | Version target |
|---|---|---|
| Monorepo | pnpm workspaces (no turborepo) | pnpm ≥ 9 |
| Web | Next.js (App Router) + TypeScript strict | Next 15.x, TS 5.x |
| Styling | Tailwind CSS + shadcn/ui | Tailwind v4 |
| Charts | Recharts | latest |
| Auth | Auth.js (next-auth v5 beta) credentials provider, JWT sessions, bcryptjs | v5 |
| ORM | Prisma | latest |
| DB | PostgreSQL 16 | Docker local / Railway prod |
| Queue | BullMQ + ioredis | latest |
| Worker HTTP (simulator) | Hono + @hono/node-server | latest |
| Validation | zod (shared package) | v3 |
| Logging | pino (worker + web API routes) + DB log sink | latest |
| AI | @anthropic-ai/sdk | latest |
| Unit/integration tests | Vitest | latest |
| E2E | Playwright | latest |
| CI | GitHub Actions | — |
| Fake data | @faker-js/faker (seed + simulator) | latest |
| Deploy | Vercel (web) + Railway (worker, Postgres, Redis) | — |

## Repository layout

```
integrationHealth/
├── package.json                 # workspace root: scripts, devDeps (prettier, eslint)
├── pnpm-workspace.yaml
├── docker-compose.yml           # postgres:16 + redis:7 for local dev
├── .env.example
├── .github/workflows/ci.yml
├── CLAUDE.md
├── README.md
├── docs/
│   ├── plan/                    # this plan (kept in repo, honest artifact)
│   ├── diagrams/                # mermaid sources exported for README
│   └── openapi.yaml             # written in phase 11
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── page.tsx                    # overview
│   │   │   │   ├── connectors/[key]/page.tsx
│   │   │   │   ├── jobs/page.tsx
│   │   │   │   ├── events/page.tsx
│   │   │   │   ├── incidents/page.tsx
│   │   │   │   ├── incidents/[id]/page.tsx
│   │   │   │   ├── logs/page.tsx
│   │   │   │   └── settings/                   # users, audit log (admin)
│   │   │   └── api/
│   │   │       ├── auth/[...nextauth]/route.ts
│   │   │       ├── webhooks/[connector]/route.ts
│   │   │       └── v1/...                      # REST per 04-api-spec.md
│   │   ├── components/
│   │   ├── lib/                                # auth helpers, api client, queue producer
│   │   └── e2e/                                # Playwright specs
│   └── worker/
│       ├── src/
│       │   ├── index.ts                        # boots queues + simulator + health cron
│       │   ├── queues.ts                       # queue/worker definitions, backoff config
│       │   ├── processors/                     # sync.ts, webhook.ts, claim.ts, eligibility.ts, incident-summary.ts
│       │   ├── health/engine.ts                # pure status computation + snapshot writer
│       │   ├── incidents/lifecycle.ts
│       │   ├── ai/summarize.ts                 # Anthropic call + zod schema
│       │   ├── ai/redact.ts                    # PHI redaction (pure, heavily unit-tested)
│       │   └── simulator/                      # hono app: one module per upstream system
│       └── test/
├── packages/
│   ├── db/                                     # prisma/schema.prisma, seed.ts, exported client
│   └── shared/                                 # zod schemas, enums, constants, health rules config
```

## Environment variables

Single `.env.example` at root; each app documents which it reads.

| Var | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | web, worker, db | `postgresql://pulse:pulse@localhost:5432/pulse` locally |
| `REDIS_URL` | web, worker | `redis://localhost:6379` locally |
| `AUTH_SECRET` | web | `openssl rand -base64 32` |
| `AUTH_URL` | web | `http://localhost:3000` locally; Vercel URL in prod |
| `ANTHROPIC_API_KEY` | worker | user supplies |
| `ANTHROPIC_MODEL` | worker | default `claude-opus-4-8` ($5/$25 per MTok). Summaries are short (~1–2K in, ~500 out), so cost is cents; set `claude-haiku-4-5` ($1/$5) if minimizing spend. |
| `SIMULATOR_PORT` | worker | default `4001` |
| `SIMULATOR_BASE_URL` | worker | `http://localhost:4001` (worker calls its own simulator over HTTP) |
| `WEBHOOK_TARGET_URL` | worker (simulator) | Where the simulator POSTs webhooks: `http://localhost:3000` locally, Vercel URL in prod |
| `WEBHOOK_SIGNING_SECRET` | web, worker | HMAC secret for simulated webhook signatures |
| `SEED_DEMO_PASSWORD` | db | password for the three demo users (default `pulse-demo-2026`) |

## Local dev workflow

```bash
docker compose up -d          # postgres + redis
pnpm install
pnpm db:push && pnpm db:seed  # scripts defined in root package.json (phase 1)
pnpm dev                      # concurrently: web (3000) + worker (incl. simulator on 4001)
```

Root `package.json` scripts to create in phase 0 (finalized in later phases):
`dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:push`, `db:migrate`, `db:seed`, `format`.

## Deployment topology (phase 10)

- **Railway project**: Postgres plugin, Redis plugin, `worker` service (root `apps/worker`,
  build via pnpm from repo root, `node dist/index.js`). Simulator port not publicly exposed —
  worker reaches it via localhost.
- **Vercel project**: root `apps/web`, framework Next.js. Env vars point at Railway Postgres/Redis
  public connection strings.
- Webhooks in prod: simulator (Railway) POSTs to Vercel URL — a genuinely distributed webhook path.

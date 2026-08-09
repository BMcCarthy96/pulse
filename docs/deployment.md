# Deployment runbook

Pulse deploys as two services against two managed data stores:

| Piece                                            | Where              | Why there                                                                 |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------- |
| `apps/web` (dashboard, API, webhook receiver)    | **Vercel**         | Next.js App Router; zero-config, free tier                                |
| `apps/worker` (queues, health engine, simulator) | **Railway**        | Needs a long-running process; Vercel functions cannot host BullMQ workers |
| Postgres                                         | **Railway plugin** | Same network as the worker; public endpoint for Vercel                    |
| Redis                                            | **Railway plugin** | BullMQ's backing store                                                    |

Target spend: Railway Hobby (~$5/mo + usage), Vercel Hobby (free). See [Costs](#costs).

> **Status:** the live deployment has **not been performed** — it needs Railway and Vercel
> account access, so it is the reader's step. Everything in this document is written to be
> executed top to bottom without improvisation.
>
> The worker image, however, is no longer merely _written_ — it is **built and booted** on every
> CI run (the `Worker image` job), against real Postgres and Redis containers, asserting that it
> migrates from an empty database, starts all six queues, and answers `/healthz`.
>
> That job exists because an earlier version of this document called the Dockerfile "complete and
> production-ready" when the image had never once been built. It contained four independent
> defects, each of which would have failed the Railway deploy:
>
> 1. **No `.dockerignore`** — the build context included pnpm's symlink farm and Docker refused
>    it outright: `invalid file request apps/worker/node_modules/@anthropic-ai/sdk`.
> 2. **No `prisma` CLI in the runtime image** — it was a devDependency of `packages/db`, so
>    `pnpm --prod deploy` stripped it, leaving `npx prisma migrate deploy` to download the CLI
>    from npm on every boot, against a 60s healthcheck and a 5-retry restart policy.
> 3. **Raw TypeScript package entry points** — `@pulse/shared` and `@pulse/db` published `.ts`
>    files, so `node dist/index.js` died with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
>    They now compile to `dist/` and expose it under the `default` export condition.
> 4. **Prisma client lost in the prune** — `pnpm deploy` rebuilds `node_modules` from the store,
>    so the generated client did not come along: _"@prisma/client did not initialize yet"_.
>    Generation now runs inside the pruned tree, from a schema copied in beside it.
>
> The lesson generalises past this repo: a Dockerfile that has never been built is not
> configuration, it is a guess.

---

## 0. Prerequisites

- A GitHub repository containing this monorepo (see [Push the repo](#push-the-repo)).
- A Railway account and a Vercel account, both connected to that GitHub account.
- `openssl` (or any way to generate a random 32-byte secret).

Generate the two secrets you will need up front and keep them somewhere safe:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # WEBHOOK_SIGNING_SECRET
```

Both must be **identical** everywhere they appear. `WEBHOOK_SIGNING_SECRET` in particular is
shared between the worker (which signs outbound webhooks) and the web app (which verifies them) —
if they drift, every inbound delivery lands as `INVALID` with "signature verification failed".

### Push the repo

```bash
git remote add origin https://github.com/<you>/pulse.git
git push -u origin main
```

---

## 1. Railway — data stores and the worker

### 1a. Create the project and plugins

1. Railway → **New Project** → **Deploy from GitHub repo** → select the repo.
2. In the project, **+ New** → **Database** → **Add PostgreSQL**.
3. **+ New** → **Database** → **Add Redis**.

### 1b. Configure the worker service

Railway will detect [`railway.json`](../railway.json) at the repo root, which points at
`apps/worker/Dockerfile` and sets the healthcheck to `/healthz`. Confirm under the service's
**Settings → Build** that the builder is `Dockerfile` and the path is `apps/worker/Dockerfile`.

The Dockerfile builds from the **repository root** as context — the worker depends on two
workspace packages, so building from `apps/worker` alone cannot resolve `workspace:*` links.

### 1c. Worker environment variables

Set these under the worker service → **Variables**. The two `${{...}}` values are Railway
plugin references — type them exactly; Railway resolves them at deploy time.

| Variable                 | Value                                                      |
| ------------------------ | ---------------------------------------------------------- |
| `DATABASE_URL`           | `${{Postgres.DATABASE_URL}}`                               |
| `REDIS_URL`              | `${{Redis.REDIS_URL}}`                                     |
| `WEBHOOK_SIGNING_SECRET` | the `openssl rand -hex 32` value from step 0               |
| `WEBHOOK_TARGET_URL`     | `https://placeholder.invalid` — **corrected in step 3**    |
| `SIMULATOR_PORT`         | `4001`                                                     |
| `SIMULATOR_BASE_URL`     | `http://localhost:4001`                                    |
| `ANTHROPIC_API_KEY`      | your key, or leave unset for the graceful-degradation path |
| `ANTHROPIC_MODEL`        | `claude-opus-4-8` (or `claude-haiku-4-5` to cut cost)      |
| `HEALTH_TICK_SEC`        | `30`                                                       |
| `HEALTH_WINDOW_MIN`      | `15`                                                       |
| `INCIDENT_STABILITY_MIN` | `10`                                                       |
| `NODE_ENV`               | `production`                                               |

`WEBHOOK_TARGET_URL` is a placeholder because of a genuine circular dependency: the worker needs
the Vercel URL, and Vercel needs the Railway database. Deploy the worker first with the
placeholder, then come back in step 3.

### 1d. Seed the demo data (once)

The seed refuses to run against production without an explicit override — that guard exists so a
misfired CI job cannot wipe a live database:

```bash
railway link                       # select the project
railway run --service worker sh -c "SEED_FORCE=1 npx tsx prisma/seed.ts"
```

Expect roughly: 1 organization, 3 users, 4 connectors, ~500 sync runs, ~2300 jobs (~60 DEAD),
~1500 events, ~2500 log entries, ~2700 health snapshots, 2 incidents.

The seed is anchored to wall-clock "now" and uses faker seed **42**. Do not change that seed —
the screenshots and tests depend on it.

---

## 2. Vercel — the dashboard

1. Vercel → **Add New** → **Project** → import the same repo.
2. **Root Directory: `apps/web`.** This is the single most common way to get a broken Next.js
   deploy from a monorepo — the default (repo root) produces
   `Couldn't find any 'pages' or 'app' directory`.
3. Framework preset: Next.js. Build and install commands: leave as detected.

### Vercel environment variables

Vercel reaches Railway over the **public** endpoints. In the Railway Postgres/Redis plugin,
open **Connect** and copy the _public_ connection string (the one with a `*.proxy.rlwy.net`
host), not the internal `*.railway.internal` one — Vercel cannot resolve internal hosts.

| Variable                    | Value                                                            |
| --------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`              | Railway Postgres **public** connection string                    |
| `REDIS_URL`                 | Railway Redis **public** connection string                       |
| `AUTH_SECRET`               | the `openssl rand -base64 32` value from step 0                  |
| `AUTH_URL`                  | `https://<your-project>.vercel.app`                              |
| `WEBHOOK_SIGNING_SECRET`    | **the same value as the worker**                                 |
| `NEXT_PUBLIC_DEMO_PASSWORD` | `pulse-demo-2026` (must match `SEED_DEMO_PASSWORD` used at seed) |

Deploy. Note the resulting URL.

---

## 3. Close the loop

Back in Railway → worker service → Variables:

- `WEBHOOK_TARGET_URL` = the real Vercel URL from step 2.

Redeploy the worker. Inbound webhooks (lab results, claim acks) now flow Railway → Vercel.

---

## 4. Smoke test the live system

Work through the demo flow against the public URL:

1. **Login** — all three demo personas (`dana@`, `marcus@`, `priya@lakeviewhealth.example`,
   password `pulse-demo-2026`). Confirm Settings is visible to Dana only.
2. **Chaos** — as Dana, open the EHR connector → chaos panel → `OUTAGE` → Apply.
3. **Failure** — "Run sync now". Watch attempts climb `1/5 … 5/5` and the job land in `DEAD`.
4. **Detection** — within ~2 health ticks the connector goes `DOWN` and an incident opens
   (sidebar bubble increments).
5. **AI summary** — open the incident; with a key set, the card goes queued → generating →
   ready with a model/prompt-version footer. Without one it shows "AI not configured", which is
   the intended degradation, not a failure.
6. **Cross-cloud webhooks** — open the lab connector → "Simulate incoming results" → 5 events
   reach `PROCESSED`. This is the step that proves Railway → Vercel delivery and the shared
   signing secret; if these land `INVALID`, the two `WEBHOOK_SIGNING_SECRET` values differ.
7. **Recovery** — chaos back to `HEALTHY`, retry the dead jobs from `/jobs`, watch health
   recover and the incident go `MONITORING` → `RESOLVED`.
8. **Audit** — Settings → audit log shows the chaos change and the retries, attributed to Dana.

### Restart resilience

Restart the worker service from the Railway dashboard, then confirm:

- the boot log shows `registered repeatable sync` and `health engine: tick registered`;
- **no second incident** opened for a connector that already had an active one;
- health snapshots resume at one row per connector per tick, not two.

Repeatable schedules are cleared and rebuilt on every boot precisely so a restart cannot leave
two schedulers running side by side.

---

## 5. Operations

### Uptime monitoring

Point a free UptimeRobot (or similar) HTTP monitor at:

```
https://<your-project>.vercel.app/api/v1/health
```

That route is deliberately outside the auth middleware (`PUBLIC_API_PREFIXES` in
`apps/web/middleware.ts`), so it can be probed without credentials.

### Logs

- **Vercel** — Deployments → Runtime Logs. Hobby retention is short (about a day); the
  application also writes its own `LogEntry` rows, which is what `/logs` reads.
- **Railway** — service → Deployments → Logs. The worker logs JSON via pino in production.
- **In-app** — `/logs` is the durable record: every worker log is persisted with its
  connector/job/incident id, and it outlives both platforms' retention.

### Costs

| Item      | Plan          | Expected                                                                                                                                                                           |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Railway   | Hobby         | $5/mo credit; worker + Postgres + Redis at this size sits within it                                                                                                                |
| Vercel    | Hobby         | $0                                                                                                                                                                                 |
| Anthropic | pay-as-you-go | Summaries only fire on incident open/resolve. Each call sends ≤8K characters of context and caps at 1500 output tokens — pennies per incident. `claude-haiku-4-5` cuts it further. |

The AI spend is bounded by design: the context builder caps at 8,000 characters, collapses
repeated log lines, and summaries are generated per incident rather than per tick.

---

## Troubleshooting

| Symptom                                                  | Cause                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Couldn't find any 'pages' or 'app' directory` on Vercel | Root Directory is not `apps/web`                                                              |
| Every inbound webhook is `INVALID`                       | `WEBHOOK_SIGNING_SECRET` differs between Vercel and Railway                                   |
| Web loads but all data is empty                          | `DATABASE_URL` on Vercel points at the internal Railway host; use the public one              |
| Worker boot-loops on Railway                             | Migrations failed — check `prisma migrate deploy` output in the deploy log                    |
| Two health snapshots per tick                            | Two worker replicas. Keep `numReplicas: 1`; the health tick is a singleton                    |
| AI card stuck on `queued`                                | The worker is down or cannot reach Redis — the summary job never got picked up                |
| Incident never resolves                                  | `INCIDENT_STABILITY_MIN` is the wait in minutes; `0` means "resolve on the next healthy tick" |

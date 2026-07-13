# Phase 1 — Database Schema & Seed

**Goal:** Full Prisma schema migrated into local Postgres; idempotent seed producing the demo
dataset; typed client exported from `packages/db`.

**Prereqs:** Phase 0. **Read first:** `docs/plan/02-data-model.md` (copy schema verbatim).

## Tasks

1. `packages/db/prisma/schema.prisma` — exactly the schema in doc 02.
2. `packages/db/src/index.ts` — export a singleton `prisma` client (global-cached for Next.js
   dev hot reload) and re-export all Prisma enums/types.
3. `packages/shared`: re-export enum value constants + zod enums mirroring Prisma enums
   (`z.nativeEnum(...)`), and the connector registry:
   ```ts
   export const CONNECTORS = [
     { key: "ehr-fhir", displayName: "Mercy General EHR (FHIR R4)", kind: "poll_sync", syncIntervalSec: 300, ... },
     ...
   ] as const;
   ```
   (description strings included — write believable one-liners).
4. Wire root scripts: `db:push` (`prisma db push`), `db:migrate` (`prisma migrate dev`),
   `db:seed` (`tsx seed.ts`). Use `migrate dev` to create the initial migration (committed) —
   migrations history is itself a portfolio artifact.
5. `packages/db/seed.ts` per doc 02 §Seed specification. Structure it as small composable
   generators (`seedUsers`, `seedConnectors`, `seedHistoryForConnector(...)`) — phase 9 reuses
   pieces as test fixtures. Fixed faker seed. Idempotent: wipe-and-recreate history tables is
   acceptable (guard: refuse to run if `NODE_ENV === "production"` unless `SEED_FORCE=1`).
6. Update worker boot to do a real `prisma.$queryRaw\`SELECT 1\`` check.
7. Commit: `feat(db): schema, migrations, demo seed (phase 1)`.

## Acceptance criteria

- [ ] `pnpm db:migrate` creates DB from scratch; migration files committed
- [ ] `pnpm db:seed` runs twice without error (idempotent) and prints the counts table
- [ ] Counts roughly match doc 02 (±20%): ~500 sync runs, ~2000 jobs (20–30 DEAD), ~1500 events,
      snapshots for 7d, 2 resolved incidents with timelines, 3 users, 4 connectors
- [ ] `pnpm typecheck` passes; web + worker both import `@pulse/db` without error
- [ ] Two distinct "bad afternoon" failure clusters visible in seeded data (query snapshots:
      errorRate > 0.3 rows exist in exactly two time bands)

# Phase 0 — Repo Scaffold & Tooling

**Goal:** A running empty monorepo: web app boots, worker boots, DB + Redis up via Docker,
lint/typecheck/format wired, CI skeleton green.

**Read first:** `docs/plan/01-architecture.md` (repo layout, stack table, env vars).

## Tasks

1. **Workspace root**
   - `pnpm-workspace.yaml` covering `apps/*`, `packages/*`.
   - Root `package.json` (`private: true`) with scripts:
     `dev` (run web + worker concurrently — use `concurrently`), `build`, `lint`, `typecheck`,
     `format`, `test`, `test:e2e`, `db:push`, `db:migrate`, `db:seed` (db scripts delegate to
     `packages/db`; test scripts can be placeholders that exit 0 until phase 9).
   - Prettier config + `.editorconfig`. ESLint flat config at root (typescript-eslint,
     next plugin scoped to `apps/web`).
   - `.gitignore` (node_modules, .next, dist, .env*, !.env.example).
   - `.nvmrc` / `engines`: Node 22.
2. **docker-compose.yml**: `postgres:16` (user/pass/db `pulse`, port 5432, named volume) and
   `redis:7` (port 6379). Healthchecks on both.
3. **`.env.example`**: every var from architecture doc §Environment variables, with local values
   and one-line comments.
4. **apps/web**: `create-next-app` equivalent (App Router, TS, Tailwind v4, src-less `app/`
   layout per architecture doc). Install shadcn/ui and generate `button card badge table tabs
dialog dropdown-menu input label select skeleton sonner tooltip sheet`. Placeholder home page
   rendering "Pulse" with a shadcn Button to prove the pipeline.
5. **apps/worker**: TS package with `tsx watch src/index.ts` dev script and `tsc` build.
   `src/index.ts` logs "worker booted", connects to Redis (ioredis ping) and Postgres
   (placeholder — prisma comes in phase 1), starts an empty Hono server on `SIMULATOR_PORT`
   responding `GET /healthz` → `{ok:true}`. Graceful shutdown on SIGINT/SIGTERM.
6. **packages/shared**: TS package exporting a placeholder `export const APP_NAME = "Pulse"`.
   Both apps import it to prove workspace linking.
7. **packages/db**: package stub (prisma installed, schema in phase 1).
8. **CI skeleton** `.github/workflows/ci.yml`: on push/PR → pnpm install (with cache),
   `lint`, `typecheck`, `build`. (Tests/e2e jobs added in phase 9.)
9. Commit: `chore: scaffold monorepo (phase 0)`.

## Acceptance criteria

- [ ] `docker compose up -d` then `pnpm dev` → web on :3000 renders styled placeholder;
      worker logs boot + Redis ping ok; `curl :4001/healthz` → `{"ok":true}`
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass from clean checkout
- [ ] `packages/shared` import works in both apps
- [ ] CI workflow passes on the commit (or would — run the same commands locally if no remote yet)

## Notes for the implementing model

- Do not add turborepo, husky, or any tool not in the stack table.
- Pin nothing to exact versions except where the stack table demands a major (Tailwind v4,
  next-auth v5 later). Let pnpm resolve latest minors.
- Windows dev machine: scripts must work in PowerShell (avoid bash-only syntax in npm scripts;
  use `concurrently`, not `&`).

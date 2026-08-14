# Pulse — Integration Health Dashboard (healthcare)

Monorepo: pnpm workspaces. `apps/web` (Next.js 15 dashboard + API + webhooks), `apps/worker`
(BullMQ processors + health engine + upstream simulator + AI summarizer), `packages/db`
(Prisma), `packages/shared` (zod schemas, enums, config constants, prompts).

## The plan is the source of truth

This project is built from a phased plan in `docs/plan/`. Working rules:

1. Find the current phase: the lowest-numbered `docs/plan/phases/phase-*.md` whose acceptance
   criteria are not yet met (check `docs/plan/PROGRESS.md`).
2. Load **only**: this file + the current phase file + the reference docs that phase names.
   Do not read other phase files.
3. Implement the phase's tasks in order. Specs marked "implement exactly" are not suggestions.
4. Before declaring a phase done, walk every acceptance criterion and check it off in
   `docs/plan/PROGRESS.md` with a one-line note (how it was verified). If a criterion can't be
   met, stop and ask the user — do not silently reinterpret it.
5. If implementation forces a deviation from a reference doc (schema field, route shape, rule),
   update that doc in the same commit and note it in PROGRESS.md.
6. Commit at the end of each phase (or at the phase's stated checkpoints) with the message the
   phase specifies.

## Conventions

- TypeScript strict everywhere; no `any` without a comment explaining why.
- All cross-boundary validation with zod schemas from `packages/shared` — never duplicate a
  schema in web and worker.
- API routes: always the `handleApiError` wrapper, role gate first line, error envelope from
  `docs/plan/04-api-spec.md`. Every mutation writes an AuditEntry.
- Worker: never `console.log` — use the `log` facade (pino + DB sink). Every log tied to a
  connector/job/incident id when one exists.
- UI: shadcn/ui components; status colors only via `StatusBadge`; every list has loading,
  empty, and error states. Copy vocabulary per `docs/plan/05-ui-spec.md` — no marketing tone.
- Money/PHI discipline: all data is synthetic; anything sent to the Anthropic API must pass
  through `packages/shared/src/redact.ts` first.
- Windows host: npm scripts must run under PowerShell (use `concurrently`, cross-env style
  patterns; no bash-isms).

## Commands (after phase 0)

```
docker compose up -d       # postgres + redis
pnpm dev                   # web :3010 + worker (+ simulator :4001)
pnpm lint | typecheck | build | test | test:e2e
pnpm db:push | db:migrate | db:seed
```

## Things NOT to do

- Don't add dependencies outside the stack table in `docs/plan/01-architecture.md` without
  asking.
- Don't build stretch features before phase 11 acceptance is met.
- Don't weaken retry/health/incident rules to make tests pass — fix the code or flag the rule.
- Don't put secrets in the repo; `.env.example` carries names + local defaults only.
- Don't regenerate the seed with a different faker seed (screenshots and tests depend on 42).

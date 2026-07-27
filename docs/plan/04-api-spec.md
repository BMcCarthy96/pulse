# API Specification

All app APIs live under `apps/web/app/api/v1/` (Next.js route handlers) except auth
(`/api/auth/[...nextauth]`) and webhooks (`/api/webhooks/[connector]`, contract in
[03-queues-events-health.md](03-queues-events-health.md) §3).

## Conventions

- **Auth**: every `/api/v1/*` route requires a session. Role gates below. A shared helper
  `requireRole(req, "OPS")` returns the session or throws a typed 401/403.
- **Validation**: zod-parse query/body; schemas live in `packages/shared` so worker + web + tests
  share them.
- **Error envelope** (uniform):
  ```json
  { "error": { "code": "FORBIDDEN", "message": "OPS role required" } }
  ```
  Codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INTERNAL`.
- **Pagination**: `?cursor=<id>&limit=<n≤100>` → `{ data: [...], nextCursor: string | null }`.
  Add `?withTotal=1` for `{ ..., total: number }` — a COUNT of all matching rows, opt-in because
  the extra query is only earned where the UI states a total (today: `/jobs`, whose
  "Retry all matching (N)" must agree with what `retry-bulk` will actually re-queue).
- **Mutations** write an `AuditEntry` (action names in 02-data-model.md) — no exceptions.
- Every route handler logs a structured line (pino) with route, userId, duration, outcome.

## Routes

| Method & path | Role | Description |
|---|---|---|
| `GET /v1/overview` | VIEWER | Dashboard aggregate: per-connector `{status, errorRate, lastActivity, openIncidentId}`, totals `{deadJobs, openIncidents, eventsLastHour, jobsLastHour}` |
| `GET /v1/connectors` | VIEWER | List with current status + sparkline data (last 24h snapshots, downsampled) |
| `GET /v1/connectors/:key` | VIEWER | Detail: connector, recent runs (10), snapshots (24h), open incident |
| `PATCH /v1/connectors/:key` | ADMIN | Update `paused`, `syncIntervalSec`. Audit. |
| `POST /v1/connectors/:key/chaos` | ADMIN | Body `{mode, config?}`. Sets chaos mode. Audit with `{from, to}`. |
| `POST /v1/connectors/:key/sync` | OPS | Manual sync trigger (enqueue `sync` job, `trigger: "manual"`). Audit. 409 if already RUNNING. |
| `POST /v1/simulate/lab-results` | OPS | Proxy to simulator `/labs/emit` `{count}` — "Simulate incoming results" demo button |
| `POST /v1/simulate/claims` | OPS | Enqueue `{count}` claim submissions — demo button |
| `POST /v1/eligibility/check` | OPS | Body `{memberId, payerId}` → enqueues eligibility job, returns `{jobId}`; UI polls job |
| `GET /v1/jobs` | VIEWER | Filter `status`, `connectorKey`, `queue`, time range; cursor-paginated |
| `GET /v1/jobs/:id` | VIEWER | Full job incl. payload + errorHistory |
| `POST /v1/jobs/:id/retry` | OPS | Manual retry per §1 of doc 03. 409 unless status DEAD/FAILED. Audit. |
| `POST /v1/jobs/retry-bulk` | OPS | Body `{connectorKey?, ids?}` retry all matching DEAD jobs (cap 100). Audit with count. |
| `GET /v1/events` | VIEWER | Filter `connectorKey`, `direction`, `status`; paginated |
| `GET /v1/events/:id` | VIEWER | Full payload + headers |
| `GET /v1/logs` | VIEWER | Filter `level`, `connectorKey`, `jobId`, `incidentId`, `q` (message ILIKE), time range; paginated |
| `GET /v1/incidents` | VIEWER | Filter `status`, `connectorKey`; paginated |
| `GET /v1/incidents/:id` | VIEWER | Incident + timeline + connector |
| `POST /v1/incidents/:id/acknowledge` | OPS | → ACKNOWLEDGED. Timeline + audit. |
| `POST /v1/incidents/:id/resolve` | OPS | Manual resolve. Timeline + audit. |
| `POST /v1/incidents/:id/notes` | OPS | Body `{message}` → timeline entry `kind: "note"` |
| `POST /v1/incidents/:id/summary/regenerate` | OPS | Re-enqueue `incident-summary`. Audit. 409 if `generating`. |
| `PATCH /v1/incidents/:id/summary` | OPS | Edited summary body; keep original per doc 03 §6.6. Audit. |
| `GET /v1/audit` | ADMIN | Paginated audit log, filter by `action`, `userId` |
| `GET /v1/users` | ADMIN | List org users (read-only; no user management UI in scope) |
| `GET /v1/health` | public | Liveness: `{ok: true, db: true, redis: true}` — used by uptime checks + e2e |

## Realtime-ish updates

No websockets in scope. Dashboard pages poll their endpoints every 10s via a small
`usePolling(fetcher, 10_000)` hook (SWR with `refreshInterval` is fine). Document this as a
deliberate scope decision (polling is honest and simple; note SSE as a "next iteration" item).

## OpenAPI

`docs/openapi.yaml` is hand-written in **phase 11** to match this table (info, auth scheme,
schemas for the main entities, all routes). Serve it read-only at `/api/v1/openapi` and render
with a minimal docs page (`/docs/api` using `swagger-ui-react` or a simple table). Keeping it
hand-written is acceptable; the CI check is a smoke test that the YAML parses.

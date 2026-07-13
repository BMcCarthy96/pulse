# Phase 6 — Dashboard UI Core

**Goal:** The main product surfaces: overview, connector detail (incl. chaos panel + action
buttons), failed job queue with retry, event viewer, log explorer — all backed by the real API.

**Prereqs:** Phase 5. **Read first:** doc 05 (UI spec) + doc 04 (API spec). This is the largest
phase; work API-first, page-second, in the order below.

## Tasks

1. **API foundation** (`apps/web/app/api/v1/...`): implement these doc-04 routes with zod
   validation, role gates, error envelope, audit writes, cursor pagination:
   `GET overview`, `GET/PATCH connectors(+/:key)`, `POST connectors/:key/chaos`,
   `POST connectors/:key/sync`, `POST simulate/lab-results`, `POST simulate/claims`,
   `POST eligibility/check`, `GET jobs(+/:id)`, `POST jobs/:id/retry`, `POST jobs/retry-bulk`,
   `GET events(+/:id)`, `GET logs`.
   (Incident routes are phase 7; audit/users routes phase 8.)
   - Manual retry implements doc 03 §1 exactly (new BullMQ job, same DB row, audit).
   - Chaos route updates connector row; worker's 5s cache picks it up.
   - `simulate/lab-results` proxies to the simulator over HTTP (`SIMULATOR_BASE_URL`).
2. **Client data layer**: typed `apiFetch` wrapper + SWR hooks with `refreshInterval: 10_000`
   for list/overview pages (doc 04 §Realtime-ish).
3. **Component inventory** from doc 05 (StatusBadge, DataTable, JsonViewer, Timestamp, etc.).
4. **Pages**, in order: Overview → Connector detail (with chaos panel, action buttons, health
   strip fed by seeded snapshots, tabs) → Jobs → Events → Logs. Follow doc 05 per-page specs,
   including loading/empty/error states and role gating.
5. Sidebar count bubbles now live (from overview endpoint).
6. Commit after each page group; final: `feat(ui): dashboard core (phase 6)`.

## Acceptance criteria

Walk this as OPS (Marcus) unless noted:

- [ ] Overview: seeded data renders tiles, KPIs, 24h chart, recent incidents (seeded resolved ones)
- [ ] Connector detail (EHR): "Run sync now" → run appears in Sync History within one poll cycle
- [ ] As ADMIN: chaos panel sets OUTAGE (confirm dialog mentions audit); as VIEWER: chaos panel
      and action buttons are absent; direct `POST .../chaos` as VIEWER → 403 envelope
- [ ] With OUTAGE active, trigger sync → jobs visibly retry in `/jobs` (attempts tick up on
      poll), then DEAD; dead-count bubble increments
- [ ] `/jobs`: retry a DEAD job (chaos back to HEALTHY first) → succeeds; "Retry all matching"
      works with confirm; both produce AuditEntries (check DB — UI for audit is phase 8)
- [ ] "Simulate incoming results" button → events appear in `/events` and process; detail sheet
      shows payload + signature headers
- [ ] Eligibility modal runs a check and shows the outcome (poll the job row)
- [ ] `/logs` filters by level + connector + free text; row expands to context JSON
- [ ] Every list page has working empty state (test by filtering to nothing) and skeletons
- [ ] `pnpm build` passes (no static/dynamic rendering errors); no console errors in happy path

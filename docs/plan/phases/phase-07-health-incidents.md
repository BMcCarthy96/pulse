# Phase 7 — Health Engine & Incidents

**Goal:** Automatic health computation with snapshots; incident auto-open/auto-resolve
lifecycle; incident UI (list + detail with timeline and actions). AI summary card ships as a
stub state ("queued") — real generation is phase 8.

**Prereqs:** Phase 6. **Read first:** doc 03 §4–5 (rules — implement exactly), doc 05 (incident
pages), doc 04 (incident routes).

## Tasks

1. **Pure core** `apps/worker/src/health/rules.ts`: `computeStatus(window)` exactly per doc 03
   §4, plus `buildWindow(jobs, events, now)` that derives
   `{totalCalls, failedCalls, consecutiveFailures, p95LatencyMs}` from rows. No I/O — these two
   functions get the densest unit tests in phase 9, so keep them pure and exported.
   Durations for p95 come from job `startedAt→finishedAt`; treat DEAD/FAILED attempts as calls.
2. **Engine tick** `health/engine.ts` on a repeatable `health-tick` job (60s): per active
   connector, load last-15-min rows → compute → write `HealthSnapshot` → on change update
   `Connector.status` + log + invoke lifecycle. Make window length + thresholds constants in
   `packages/shared/src/health-config.ts`, overridable via env (`HEALTH_TICK_SEC`,
   `INCIDENT_STABILITY_MIN`) — e2e tests shrink them.
3. **Incident lifecycle** `incidents/lifecycle.ts` exactly per doc 03 §5 table, transactional
   single-active-incident guarantee, timeline entries for every transition, and enqueue of
   `incident-summary` jobs (processor stub in this phase: mark `aiSummaryStatus: "queued"` and
   return — phase 8 replaces the body).
4. **API routes** (doc 04): `GET incidents`, `GET incidents/:id`, `acknowledge`, `resolve`,
   `notes`. (Summary regenerate/edit are phase 8.)
5. **UI**: `/incidents` list + `/incidents/[id]` detail per doc 05 — timeline, ack/resolve/note
   actions, context panel with pre-filtered links, AI summary card rendering the
   none/queued/failed states (ready/edited states coded but reachable only after phase 8;
   seeded incidents exercise "ready" via their canned summaries).
6. Overview + connector pages: wire open-incident links and live health strip to real snapshots
   (they existed from seed; now they update every tick).
7. Commit: `feat(health): status engine, incident lifecycle + UI (phase 7)`.

## Acceptance criteria

Set `HEALTH_TICK_SEC=15`, `INCIDENT_STABILITY_MIN=1` locally for this walkthrough:

- [ ] All healthy: statuses stay HEALTHY across ticks; snapshots accumulate (check chart moves)
- [ ] EHR OUTAGE + trigger sync → within ~2 ticks connector DOWN; CRITICAL incident auto-opens
      exactly once (no duplicates over further ticks); timeline has "opened" + health transition
- [ ] Incident visible in sidebar bubble, list, and connector tile link; detail shows AI card
      in "queued" state
- [ ] Acknowledge as OPS → status + timeline + AuditEntry; as VIEWER buttons hidden and API 403s
- [ ] Chaos HEALTHY + retry dead jobs → next ticks: connector HEALTHY, incident → MONITORING,
      then RESOLVED after stability window; `resolvedAt` set; timeline complete
- [ ] Sustained DEGRADED (failureRate 0.4) ≥ 2 ticks 10min-equivalent (with shrunk config) opens
      a WARNING incident
- [ ] Unit-sanity: `computeStatus` spot-checks from doc 03 §4 (5 consecutive failures → DOWN;
      errorRate 0.12 → DEGRADED; empty window → carries previous)

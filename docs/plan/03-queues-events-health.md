# Queues, Events, Chaos, Health & Incidents

The operational core of the project. Everything here must be implemented exactly — this is
where the portfolio signal lives.

## 1. Queue topology (BullMQ)

| Queue | Producer | Processor | Concurrency | Purpose |
|---|---|---|---|---|
| `sync` | Repeatable job (per poll connector) + manual trigger API | `processors/sync.ts` | 2 | Pull pages from simulator EHR, upsert records, checkpoint cursor |
| `webhook-processing` | Web app webhook route (after persisting `IntegrationEvent`) | `processors/webhook.ts` | 5 | Validate + process inbound lab results / claim acks |
| `claims-submit` | API (`POST /v1/claims/submit-batch` demo trigger) + seed | `processors/claim.ts` | 3 | Submit claims to simulator; ack arrives later as webhook |
| `eligibility` | API on-demand | `processors/eligibility.ts` | 3 | Request/response check against rate-limited upstream |
| `incident-summary` | Incident lifecycle | `processors/incident-summary.ts` | 1 | Generate AI summary (redact → Claude → store) |
| `health-tick` | Repeatable, every 60s | `health/engine.ts` | 1 | Compute statuses, write snapshots, drive incident lifecycle |

### Retry policy (uniform default, per-queue overrides)

```ts
// packages/shared/src/queue-config.ts
export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },   // 2s, 4s, 8s, 16s, 32s
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};
// eligibility queue: attempts 3, and honor Retry-After header when present (custom backoff)
// incident-summary: attempts 2 (an LLM failure should surface fast, not thrash)
```

Rules:
- Every attempt appends `{attempt, at, message, durationMs}` to `Job.errorHistory` and writes an
  ERROR `LogEntry`.
- BullMQ `failed` event with attempts exhausted → mark DB `Job.status = DEAD`. DEAD jobs are the
  "failed job queue" in the UI.
- **Manual retry** = create a *new* BullMQ job with the same payload, link it to the same DB Job
  row (reset status to QUEUED, keep errorHistory), write an AuditEntry.
- HTTP calls to the simulator use a 10s timeout (AbortController). Timeouts are failures like any
  other — the point is to demonstrate they're handled.
- Idempotency: sync upserts by external id; webhook processing is guarded by the
  `(connectorId, dedupeKey)` unique constraint, so a retried processor run cannot double-apply.

## 2. Simulator spec (`apps/worker/src/simulator/`)

Hono app on `SIMULATOR_PORT`. Each upstream is a module. On every request, first consult the
connector's chaos state (read from DB, cached 5s) and apply:

| ChaosMode | Behavior |
|---|---|
| `HEALTHY` | Normal response, 50–300ms jittered latency |
| `DEGRADED` | `chaosConfig.failureRate` (default 0.4) of requests → 500; survivors +2–8s latency |
| `OUTAGE` | Always 503 `{"error":"upstream unavailable"}` |
| `TIMEOUT` | Sleep 30s (client aborts at 10s) |
| `RATE_LIMIT` | 429 with `Retry-After: 15` |
| `BAD_PAYLOAD` | 200 with schema-invalid JSON (missing required fields) |
| `AUTH_FAILURE` | 401 `{"error":"invalid credentials"}` |

Endpoints:

```
GET  /ehr/fhir/Patient?_page=&_count=      # paginated synthetic FHIR-ish bundles (3–5 pages)
GET  /ehr/fhir/Appointment?_page=&_count=
POST /clearinghouse/claims                 # accepts claim, returns {claimId, status:"accepted"};
                                           # schedules an ack webhook 5–20s later
POST /eligibility/check                    # {memberId, payerId} -> {eligible, plan, copay}
POST /labs/emit                            # internal trigger: emit N lab-result webhooks (used by
                                           # "Simulate incoming results" button and e2e tests)
```

Webhook emission (labs + claim acks): POST to
`${WEBHOOK_TARGET_URL}/api/webhooks/{lab-results|claims}` with headers
`x-pulse-signature: hex(hmacSHA256(rawBody, WEBHOOK_SIGNING_SECRET))`,
`x-pulse-delivery: <uuid>` (this is the dedupe key), `x-pulse-event: <eventType>`.
Chaos also affects emission: `DEGRADED` occasionally sends duplicate deliveries (same delivery id —
exercises dedupe) and `BAD_PAYLOAD` sends malformed bodies (exercises INVALID handling).

Payload generators use faker with synthetic identifiers (`PAT-####`, `CLM-######`, LOINC-like
codes). Keep them small — believability over completeness.

## 3. Inbound webhook contract (web app)

`POST /api/webhooks/[connector]` (no auth session — signature is the auth):

1. Read raw body; verify HMAC against `x-pulse-signature`. Fail → 401 + persist
   `IntegrationEvent{status: INVALID}` + WARN log.
2. Dedupe: try insert with `dedupeKey = x-pulse-delivery`. Unique violation → 200 (ack) + mark
   attempt as `DUPLICATE` in logs. (Return 200 so a real upstream wouldn't re-deliver.)
3. Persist `IntegrationEvent{status: RECEIVED}`, enqueue `webhook-processing` job, return 202.
4. Processor validates payload against zod schema (INVALID on failure), simulates domain work,
   sets `PROCESSED`/`FAILED` + `processedAt`.

## 4. Health engine (`apps/worker/src/health/engine.ts`)

Runs every 60s. **Pure function core** (unit-testable, no I/O):

```
computeStatus(window: {totalCalls, failedCalls, consecutiveFailures, p95LatencyMs}): ConnectorStatus
```

Rules over a **rolling 15-minute window** of Jobs + IntegrationEvents per connector:
- `DOWN` if consecutiveFailures ≥ 5, or errorRate ≥ 0.5 with totalCalls ≥ 4
- `DEGRADED` if errorRate ≥ 0.1, or p95LatencyMs ≥ 5000
- else `HEALTHY`
- `PAUSED` short-circuits (connector.paused = true)
- No activity in window → keep previous status (a silent connector is not "healthy" — carry forward; the UI shows "no recent activity" separately)

Each tick, per connector: compute → write `HealthSnapshot` → if status changed, update
`Connector.status`, write INFO/WARN log, and call the incident lifecycle.

## 5. Incident lifecycle (`apps/worker/src/incidents/lifecycle.ts`)

State machine driven by health transitions + human actions:

| Trigger | Action |
|---|---|
| Transition → `DOWN` | If no non-RESOLVED incident for connector: open `Incident{severity: CRITICAL}`, timeline "opened", enqueue `incident-summary` |
| Transition → `DEGRADED` sustained ≥ 10 min (two+ consecutive degraded snapshots ≥10min apart) | Same but `severity: WARNING` |
| Transition → `HEALTHY` while incident OPEN/ACKNOWLEDGED | Incident → `MONITORING`, timeline entry |
| `MONITORING` and healthy for 10 more min | → `RESOLVED`, `resolvedAt`, timeline entry, enqueue summary refresh ("resolution note") |
| `MONITORING` and unhealthy again | → back to previous status (OPEN/ACKNOWLEDGED), timeline entry |
| Human: acknowledge / resolve / add note | Status change + timeline + AuditEntry (API, phase 7) |

Only one active (non-RESOLVED) incident per connector — enforce in code with a transaction.

**Demo metrics** (computed in phase 11 docs, backed by this data): MTTD = openedAt − first failing
snapshot windowStart; MTTR = resolvedAt − openedAt; retry success rate = retried jobs that
eventually SUCCEEDED / total manual retries.

## 6. AI incident summary (`apps/worker/src/ai/`)

Processor flow for `incident-summary` jobs:

1. Gather context: incident row, connector, last 50 relevant `LogEntry`s, last 20 failed job
   errors, last 10 events, current chaos mode **excluded** (the AI shouldn't cheat by reading
   the chaos flag — it must reason from symptoms; note this in the README, it's a good story).
2. **Redact** (`ai/redact.ts`, pure function): strip/replace synthetic PHI-like tokens before the
   payload leaves the system — patterns for `PAT-\d+`, `CLM-\d+`, member ids, names, DOBs →
   `[REDACTED:patient-ref]` etc. Unit-test heavily. This mirrors real PHI-boundary discipline.
3. Call Anthropic with structured output:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const IncidentSummary = z.object({
  summary: z.string(),            // 2-3 sentences, plain ops language
  probableCause: z.string(),
  impact: z.string(),             // what downstream workflows are affected
  suggestedSteps: z.array(z.string()).max(5),
  confidence: z.enum(["low", "medium", "high"]),
});

const client = new Anthropic(); // ANTHROPIC_API_KEY from env
const response = await client.messages.parse({
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
  max_tokens: 1500,
  system: SYSTEM_PROMPT,          // versioned constant PROMPT_V1 in packages/shared
  messages: [{ role: "user", content: redactedContextAsMarkdown }],
  output_config: { format: zodOutputFormat(IncidentSummary) },
});
// response.parsed_output is the validated object (null if parsing failed -> job failure path)
```

4. Store into `Incident.aiSummary` with `model`, `promptVersion`, `generatedAt`;
   `aiSummaryStatus: ready`; timeline entry `kind: "ai_summary"`.
5. Failure path: `aiSummaryStatus: failed` + ERROR log; UI shows "Summary unavailable — retry".
   **Missing `ANTHROPIC_API_KEY` must degrade gracefully** (status `failed`, message "AI not
   configured") — the app must fully function without the key.
6. Human actions (phase 8 API): regenerate (re-enqueue, audit) and edit (store edited copy,
   `aiSummaryStatus: edited`, keep original in `aiSummary.original`, audit).

Prompt versioning: prompts are exported constants `INCIDENT_SUMMARY_PROMPT_V1` with a semver-ish
tag stored on every summary. A prompt fixture test (phase 9) snapshots the rendered prompt for a
fixed context so prompt drift shows up in CI diffs.

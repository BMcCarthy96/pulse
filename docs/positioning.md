# Positioning

Copy for a résumé, LinkedIn, and interview conversations. Everything here is backed by something
in the repo — if a claim below cannot be demonstrated in the running app or pointed at in the
code, it does not belong.

---

## Résumé bullet (primary)

> Built a monitoring console for healthcare integrations with job queues, retry logic, structured
> logs, sync health views, and AI-generated incident summaries (with PHI redaction) for failed
> workflows — Next.js/TypeScript, PostgreSQL, Redis/BullMQ, deployed on Vercel + Railway with CI,
> unit, and e2e tests.

### Shorter variant (one line, for a dense résumé)

> Healthcare integration monitoring console — BullMQ job queues with retry/backoff, rolling-window
> health scoring, auto-opened incidents, and PHI-redacted AI incident summaries. Next.js,
> Postgres, Redis, Vercel + Railway, 229 tests across unit/integration/e2e.

### Supporting bullets (pick two, matched to the role)

- Designed a rolling-window health engine that scores each integration on error rate, consecutive
  failures, and p95 latency, auto-opening and auto-resolving incidents with flap protection —
  the rules are a pure function held at 100% branch coverage.
- Built a PHI redaction boundary for LLM context with an independent leak check that fails the
  job rather than sending unredacted identifiers; deliberately withheld ground-truth fault
  injection from the model so summaries are earned from symptoms, not restated.
- Implemented HMAC-signed webhook ingestion with database-enforced replay protection, capturing
  rejected deliveries as inspectable records instead of dropping them.
- Wrote a chaos-injection panel simulating seven upstream failure modes (outage, timeout, rate
  limiting, malformed payloads, auth failure), making every failure path reproducible in seconds
  and drivable from the automated e2e suite.

---

## LinkedIn blurb (2 sentences)

> Pulse is a monitoring console for a healthcare organisation's third-party integrations — EHR
> syncs, lab feeds, claims submissions, eligibility checks — with job queues, retry and backoff,
> structured logs, rolling-window health scoring, and auto-opened incidents. Every upstream is
> simulated with a chaos panel so any failure mode is reproducible on demand, and incident
> summaries are drafted by Claude from PHI-redacted context with a leak check behind it.

---

## Per-role emphasis

### Internal Tools Engineer

Lead with **the operator's experience**. This is a tool for someone on call at 2 a.m.

- Every list has loading, empty, and error states; every destructive action has a confirm dialog
  that states what will actually happen.
- The "Retry all matching (N)" bug is the story to tell: the button counted the loaded page while
  the endpoint re-queued everything matching. A dialog that lies about its own blast radius is
  worse than no dialog.
- Role-gating is enforced server-side first, then reflected in the UI — a VIEWER does not see
  buttons they cannot use, *and* the API refuses them.
- Audit coverage is total: every mutation writes an entry with actor, action, target, metadata.

### AI Solutions Engineer

Lead with **the redaction boundary and the evaluation honesty**.

- Redaction runs on the assembled context, not per field, so a new log shape cannot route around
  it. Ordered most-specific-first, idempotent, 100% branch coverage.
- The summarizer re-scans the payload for raw identifiers and throws rather than sending — the
  redactor is not trusted on its own.
- The model is not told the chaos mode. That is the ground-truth answer; feeding it in would make
  the summaries look brilliant and prove nothing. Have the transcript ready where the model says
  the trigger "is not shown."
- Structured outputs via zod, not prose parsing. Prompt versioned, stored with every summary, and
  snapshot-tested so drift fails CI.
- Graceful degradation without a key is a tested path, not a claim — the e2e suite runs that way.
- Cost is bounded by construction: 8K context cap, repeated log lines collapsed to `(×N)`,
  generation per incident rather than per tick.

### Integration Developer / Integration Engineer

Lead with **the four integration patterns and the retry semantics**.

- Four connectors, four deliberately different shapes: scheduled polling with pagination and
  cursor checkpointing; inbound signed webhooks with dedupe; outbound submission with async
  acknowledgement; on-demand request/response against a rate-limited upstream.
- `Retry-After` is honoured on 429 instead of exponential backoff — the upstream told us how long
  to wait. And parsing it is defensive: `Number("soon")` is `NaN`, and a `NaN` delay turns a
  rate-limit response into a tight retry loop.
- Idempotency at both ends: sync upserts by external id, webhook processing is guarded by a
  unique `(connectorId, dedupeKey)` index so a retried processor cannot double-apply.
- The healthcare formats are named honestly — FHIR R4, HL7v2 ORU, X12 837, 270/271 — as simulated
  shapes, not as claimed production experience.

### Full-Stack / Customer Engineer

Lead with **the whole system existing and being demonstrable in three minutes**.

- One person, planned in phases, every phase's acceptance criteria verified and recorded —
  including the deviations, which is the part worth reading.
- Two-service deployment with a real reason for the split (BullMQ needs a live process).
- 229 tests across three layers, chosen by what each layer can actually prove.
- The demo is the pitch: break something, watch it get detected, watch it recover.

---

## Questions to be ready for

**"Isn't the AI just a wrapper around an API call?"**
The API call is the least interesting part. What is interesting is what gets sent: the context
builder decides what evidence matters, redacts it, verifies the redaction, deliberately withholds
the answer, constrains the output to a schema, versions the prompt, and degrades to a working
product when the key is absent.

**"Why simulate the upstreams instead of integrating something real?"**
Because a monitoring tool is only interesting when something is broken, and no real vendor will
produce a 429 storm on demand. Simulation makes every failure mode reproducible in ten seconds —
in the demo *and* in CI.

**"What was the hardest bug?"**
Counting job rows as calls instead of attempts. A sync page that burned five retries against a
dead upstream registered as one failure, so a total outage produced one failing call per sync
run — detection needed twenty-five minutes and the error rate diluted to 0.9%. The fix was to
expand each job into one call per attempt from `errorHistory`. Failed calls in the outage window
went from 2 to 15.

**"What would you do differently?"**
Server-sent events instead of 10-second polling; generate the OpenAPI spec from the zod schemas
rather than maintaining it by hand; and incident correlation across connectors, since one vendor
outage realistically hits several integrations at once.

**"Is any of this real patient data?"**
No. Every record is faker-generated against a fixed seed, the organisation and vendors are
fictional, and the redaction layer exists as a design discipline rather than because real PHI is
present. Saying so unprompted is the right instinct in this domain.

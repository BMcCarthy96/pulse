# Data Model

Authoritative Prisma schema. Implementing model: copy this into `packages/db/prisma/schema.prisma`
in phase 1 and keep it as the single source of truth — if a later phase needs a field change,
update this doc in the same commit.

Conventions: cuid ids, `createdAt`/`updatedAt` on mutable entities, every domain table carries
`orgId` (single org today, tenant-ready), enums live here and are re-exported through
`packages/shared`.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Identity ────────────────────────────────────────────────

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  users     User[]
  connectors Connector[]
}

enum Role {
  ADMIN
  OPS
  VIEWER
}

model User {
  id           String   @id @default(cuid())
  orgId        String
  org          Organization @relation(fields: [orgId], references: [id])
  email        String   @unique
  name         String
  passwordHash String
  role         Role     @default(VIEWER)
  createdAt    DateTime @default(now())
  auditEntries AuditEntry[]
}

// ── Connectors & health ─────────────────────────────────────

enum ConnectorStatus {
  HEALTHY
  DEGRADED
  DOWN
  PAUSED
}

enum ChaosMode {
  HEALTHY
  DEGRADED      // failureRate% of requests fail 500, latency +2–8s
  OUTAGE        // all requests 503
  TIMEOUT       // no response until client timeout
  RATE_LIMIT    // 429 with Retry-After
  BAD_PAYLOAD   // 200 but schema-invalid body
  AUTH_FAILURE  // 401
}

model Connector {
  id          String   @id @default(cuid())
  orgId       String
  org         Organization @relation(fields: [orgId], references: [id])
  key         String   @unique      // "ehr-fhir" | "lab-results" | "claims" | "eligibility" | "erx"
  displayName String                // "Mercy General EHR (FHIR R4)"
  description String
  kind        String                // "poll_sync" | "inbound_webhook" | "outbound_async" | "request_response"
  status      ConnectorStatus @default(HEALTHY)
  paused      Boolean  @default(false)
  chaosMode   ChaosMode @default(HEALTHY)
  chaosConfig Json     @default("{}")   // { failureRate?: number, latencyMs?: number }
  syncIntervalSec Int?               // poll connectors only
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  syncRuns    SyncRun[]
  jobs        Job[]
  events      IntegrationEvent[]
  incidents   Incident[]
  snapshots   HealthSnapshot[]
  logs        LogEntry[]
}

model HealthSnapshot {
  id            String   @id @default(cuid())
  connectorId   String
  connector     Connector @relation(fields: [connectorId], references: [id])
  status        ConnectorStatus
  errorRate     Float               // 0..1 over the window
  p95LatencyMs  Int?
  totalCalls    Int
  failedCalls   Int
  windowStart   DateTime
  windowEnd     DateTime
  createdAt     DateTime @default(now())

  @@index([connectorId, createdAt])
}

// ── Sync runs & jobs ────────────────────────────────────────

enum RunStatus {
  RUNNING
  SUCCEEDED
  FAILED
  PARTIAL       // completed with some record-level failures
}

model SyncRun {
  id             String    @id @default(cuid())
  connectorId    String
  connector      Connector @relation(fields: [connectorId], references: [id])
  status         RunStatus @default(RUNNING)
  trigger        String    // "schedule" | "manual"
  startedAt      DateTime  @default(now())
  finishedAt     DateTime?
  recordsFetched Int       @default(0)
  recordsFailed  Int       @default(0)
  cursor         String?   // pagination checkpoint
  error          String?
  jobs           Job[]

  @@index([connectorId, startedAt])
}

enum JobStatus {
  QUEUED
  ACTIVE
  SUCCEEDED
  FAILED        // attempts remain — BullMQ will retry
  DEAD          // attempts exhausted — needs human retry (the "failed job queue")
}

model Job {
  id           String    @id @default(cuid())
  orgId        String
  connectorId  String
  connector    Connector @relation(fields: [connectorId], references: [id])
  syncRunId    String?
  syncRun      SyncRun?  @relation(fields: [syncRunId], references: [id])
  queue        String            // "sync" | "webhook-processing" | "claims-submit" | "eligibility" | "incident-summary"
  type         String            // e.g. "sync.page", "lab.process-result", "claim.submit"
  bullJobId    String?           // link back to BullMQ
  status       JobStatus @default(QUEUED)
  attempts     Int       @default(0)
  maxAttempts  Int       @default(5)
  payload      Json
  lastError    String?
  errorHistory Json      @default("[]")   // [{attempt, at, message, durationMs}]
  scheduledFor DateTime?
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([connectorId, status, createdAt])
  @@index([status, createdAt])
}

// ── Events (webhooks in/out) ────────────────────────────────

enum EventDirection {
  INBOUND
  OUTBOUND
}

enum EventStatus {
  RECEIVED
  PROCESSING
  PROCESSED
  FAILED
  DUPLICATE
  INVALID       // failed signature or schema validation
}

model IntegrationEvent {
  id          String   @id @default(cuid())
  orgId       String
  connectorId String
  connector   Connector @relation(fields: [connectorId], references: [id])
  direction   EventDirection
  eventType   String            // "lab.result.created", "claim.ack", ...
  dedupeKey   String?
  status      EventStatus @default(RECEIVED)
  payload     Json
  headers     Json?             // captured inbound headers (signature etc.)
  error       String?
  receivedAt  DateTime @default(now())
  processedAt DateTime?

  @@unique([connectorId, dedupeKey])
  @@index([connectorId, receivedAt])
}

// ── Logs ────────────────────────────────────────────────────

enum LogLevel {
  DEBUG
  INFO
  WARN
  ERROR
}

model LogEntry {
  id          String   @id @default(cuid())
  orgId       String
  level       LogLevel
  source      String            // "worker" | "web" | "simulator"
  connectorId String?
  connector   Connector? @relation(fields: [connectorId], references: [id])
  jobId       String?
  syncRunId   String?
  incidentId  String?
  message     String
  context     Json     @default("{}")
  createdAt   DateTime @default(now())

  @@index([connectorId, createdAt])
  @@index([level, createdAt])
}

// ── Incidents ───────────────────────────────────────────────

enum IncidentStatus {
  OPEN
  ACKNOWLEDGED
  MONITORING    // recovered, waiting out the stability window
  RESOLVED
}

enum IncidentSeverity {
  CRITICAL      // connector DOWN
  WARNING       // connector DEGRADED
}

model Incident {
  id            String   @id @default(cuid())
  orgId         String
  connectorId   String
  connector     Connector @relation(fields: [connectorId], references: [id])
  status        IncidentStatus @default(OPEN)
  severity      IncidentSeverity
  title         String
  openedAt      DateTime @default(now())
  acknowledgedAt DateTime?
  resolvedAt    DateTime?
  detectionSource String @default("health-engine")   // vs "manual"
  aiSummary     Json?    // { summary, probableCause, suggestedSteps[], model, promptVersion, generatedAt }
  aiSummaryStatus String @default("none")            // none | queued | generating | ready | failed | edited
  timeline      IncidentTimelineEntry[]

  @@index([connectorId, status])
}

model IncidentTimelineEntry {
  id         String   @id @default(cuid())
  incidentId String
  incident   Incident @relation(fields: [incidentId], references: [id])
  kind       String   // "opened" | "status_change" | "note" | "ai_summary" | "health_transition" | "retry_burst"
  message    String
  actor      String   // "system" | userId
  createdAt  DateTime @default(now())

  @@index([incidentId, createdAt])
}

// ── Audit ───────────────────────────────────────────────────

model AuditEntry {
  id         String   @id @default(cuid())
  orgId      String
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  action     String   // "job.retry" | "job.retry_bulk" | "connector.chaos_change" | "connector.pause" |
                      // "incident.acknowledge" | "incident.resolve" | "incident.note" |
                      // "incident.summary_regenerate" | "incident.summary_edit" | "sync.trigger_manual"
  targetType String   // "job" | "connector" | "incident" | "sync_run"
  targetId   String
  metadata   Json     @default("{}")   // e.g. { from: "HEALTHY", to: "OUTAGE" }
  createdAt  DateTime @default(now())

  @@index([orgId, createdAt])
}
```

## Seed specification (`packages/db/seed.ts`)

Seed must be **idempotent** (upsert by unique keys) and produce a believable, demo-ready state:

1. **Org**: "Lakeview Health Partners" (`slug: lakeview`).
2. **Users**: the three personas from 00-overview.md, password = `SEED_DEMO_PASSWORD`, bcrypt-hashed.
3. **Connectors**: the 4 core connectors (`erx` omitted unless stretch phase built), all `HEALTHY`,
   `ehr-fhir.syncIntervalSec = 300`.
4. **History (past 7 days, generated with faker + deterministic seed):**
   - ~500 `SyncRun`s for `ehr-fhir` (mostly SUCCEEDED, ~6% FAILED/PARTIAL clustered into two "bad afternoons")
   - ~2,000 `Job`s across connectors matching run outcomes; 20–30 currently `DEAD` so the failed-job
     queue is non-empty on first login
   - ~1,500 `IntegrationEvent`s for `lab-results` and `claims` (a few DUPLICATE and INVALID)
   - `LogEntry`s consistent with the above (INFO for successes, ERROR entries matching failed jobs)
   - `HealthSnapshot`s every 15 min for 7 days per connector, consistent with the failure clusters
   - 2 RESOLVED `Incident`s (one per bad afternoon) with timelines and a canned `aiSummary`
     (marked `promptVersion: "seed"` so it is honest that it wasn't generated live)
   - A handful of `AuditEntry`s (Marcus retried jobs, Dana changed chaos mode)
5. Print a summary table of counts when done.

Faker must use a fixed seed (`faker.seed(42)`) so screenshots/tests are reproducible.
Synthetic patient references look like `PAT-4821`, never realistic full identities.

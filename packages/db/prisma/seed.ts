import { randomUUID } from "node:crypto";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { CONNECTOR_DEFS } from "@pulse/shared";
import {
  PrismaClient,
  Role,
  RunStatus,
  JobStatus,
  EventDirection,
  EventStatus,
  LogLevel,
  IncidentStatus,
  IncidentSeverity,
  ConnectorStatus,
  type Prisma,
} from "@prisma/client";

if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
  console.error("Refusing to seed in production without SEED_FORCE=1");
  process.exit(1);
}

faker.seed(42);

const prisma = new PrismaClient();

const DAYS = 7;
const NOW = new Date();
const WINDOW_START = new Date(NOW.getTime() - DAYS * 24 * 60 * 60 * 1000);

function daysAgo(n: number, hour: number, minute = 0): Date {
  const d = new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Two "bad afternoon" failure clusters on the ehr-fhir connector.
const BAD_WINDOWS = [
  { start: daysAgo(5, 13, 0), end: daysAgo(5, 17, 0) },
  { start: daysAgo(2, 13, 0), end: daysAgo(2, 17, 0) },
];

function inBadWindow(d: Date): { hit: boolean; index: number } {
  for (let i = 0; i < BAD_WINDOWS.length; i++) {
    const w = BAD_WINDOWS[i];
    if (d >= w.start && d <= w.end) return { hit: true, index: i };
  }
  return { hit: false, index: -1 };
}

async function chunkedCreateMany<T>(
  label: string,
  rows: T[],
  fn: (batch: T[]) => Promise<Prisma.BatchPayload>,
  size = 500,
) {
  let created = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const res = await fn(batch);
    created += res.count;
  }
  console.log(`  ${label}: ${created}`);
  return created;
}

async function main() {
  console.log(`Seeding Pulse demo data (faker seed 42, window ${WINDOW_START.toISOString()} → ${NOW.toISOString()})`);

  // ── Org & users ────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "lakeview" },
    update: {},
    create: { name: "Lakeview Health Partners", slug: "lakeview" },
  });

  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "pulse-demo-2026";
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  const personas: { name: string; email: string; role: Role }[] = [
    { name: "Dana Alvarez", email: "dana@lakeviewhealth.example", role: Role.ADMIN },
    { name: "Marcus Webb", email: "marcus@lakeviewhealth.example", role: Role.OPS },
    { name: "Priya Nair", email: "priya@lakeviewhealth.example", role: Role.VIEWER },
  ];

  const users = [];
  for (const p of personas) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { name: p.name, role: p.role, passwordHash },
      create: { orgId: org.id, email: p.email, name: p.name, role: p.role, passwordHash },
    });
    users.push(user);
  }
  const [dana, marcus] = users;
  console.log(`  org: ${org.name}, users: ${users.length}`);

  // ── Connectors ─────────────────────────────────────────────
  const connectors = [];
  for (const def of CONNECTOR_DEFS) {
    const connector = await prisma.connector.upsert({
      where: { key: def.key },
      update: {
        displayName: def.displayName,
        description: def.description,
        kind: def.kind,
        syncIntervalSec: def.syncIntervalSec,
      },
      create: {
        orgId: org.id,
        key: def.key,
        displayName: def.displayName,
        description: def.description,
        kind: def.kind,
        syncIntervalSec: def.syncIntervalSec,
        status: "HEALTHY",
      },
    });
    connectors.push(connector);
  }
  const ehrFhir = connectors.find((c) => c.key === "ehr-fhir")!;
  const labResults = connectors.find((c) => c.key === "lab-results")!;
  const claims = connectors.find((c) => c.key === "claims")!;
  const eligibility = connectors.find((c) => c.key === "eligibility")!;
  console.log(`  connectors: ${connectors.length}`);

  // ── Clear previous history (idempotent re-seed) ────────────
  const connectorIds = connectors.map((c) => c.id);
  await prisma.incidentTimelineEntry.deleteMany({ where: { incident: { connectorId: { in: connectorIds } } } });
  await prisma.incident.deleteMany({ where: { connectorId: { in: connectorIds } } });
  await prisma.job.deleteMany({ where: { connectorId: { in: connectorIds } } });
  await prisma.syncRun.deleteMany({ where: { connectorId: { in: connectorIds } } });
  await prisma.integrationEvent.deleteMany({ where: { connectorId: { in: connectorIds } } });
  await prisma.logEntry.deleteMany({ where: { connectorId: { in: connectorIds } } });
  await prisma.healthSnapshot.deleteMany({ where: { connectorId: { in: connectorIds } } });
  await prisma.auditEntry.deleteMany({ where: { orgId: org.id } });

  const logRows: Prisma.LogEntryCreateManyInput[] = [];
  const jobRows: Prisma.JobCreateManyInput[] = [];

  function pushLog(
    level: LogLevel,
    source: string,
    message: string,
    opts: { connectorId?: string; jobId?: string; createdAt: Date; context?: object } ,
  ) {
    logRows.push({
      orgId: org.id,
      level,
      source,
      connectorId: opts.connectorId,
      jobId: opts.jobId,
      message,
      context: opts.context ?? {},
      createdAt: opts.createdAt,
    });
  }

  // ── SyncRuns + Jobs for ehr-fhir ────────────────────────────
  console.log("  generating ehr-fhir sync runs...");
  let syncRunCount = 0;
  let cursorTime = new Date(WINDOW_START);
  const syncRunRows: (Prisma.SyncRunCreateManyInput & { id: string })[] = [];

  while (cursorTime < NOW) {
    const { hit } = inBadWindow(cursorTime);
    const failRoll = faker.number.float({ min: 0, max: 1 });
    const isFailure = hit ? failRoll < 0.7 : failRoll < 0.03;
    const isPartial = !isFailure && hit && failRoll < 0.85;

    const runId = randomUUID();
    const recordsFetched = faker.number.int({ min: 10, max: 200 });
    const status = isFailure ? RunStatus.FAILED : isPartial ? RunStatus.PARTIAL : RunStatus.SUCCEEDED;
    const recordsFailed = isFailure ? recordsFetched : isPartial ? faker.number.int({ min: 1, max: Math.max(1, Math.floor(recordsFetched * 0.3)) }) : 0;
    const finishedAt = new Date(cursorTime.getTime() + faker.number.int({ min: 1000, max: 15000 }));

    syncRunRows.push({
      id: runId,
      connectorId: ehrFhir.id,
      status,
      trigger: "schedule",
      startedAt: cursorTime,
      finishedAt,
      recordsFetched,
      recordsFailed,
      error: isFailure ? "upstream unavailable (503) after 5 attempts" : null,
    });

    const jobCount = faker.number.int({ min: 1, max: 3 });
    for (let j = 0; j < jobCount; j++) {
      const jobFails = isFailure || (isPartial && j === 0);
      const attempts = jobFails ? 5 : faker.number.int({ min: 1, max: 2 });
      const isDead = jobFails && faker.number.float({ min: 0, max: 1 }) < 0.5;
      const errorHistory = jobFails
        ? Array.from({ length: attempts }, (_, i) => ({
            attempt: i + 1,
            at: new Date(cursorTime.getTime() + i * 4000).toISOString(),
            message: "upstream 503: service unavailable",
            durationMs: faker.number.int({ min: 50, max: 800 }),
          }))
        : [];
      const jobId = randomUUID();
      jobRows.push({
        id: jobId,
        orgId: org.id,
        connectorId: ehrFhir.id,
        syncRunId: runId,
        queue: "sync",
        type: "sync.page",
        status: jobFails ? (isDead ? JobStatus.DEAD : JobStatus.FAILED) : JobStatus.SUCCEEDED,
        attempts,
        maxAttempts: 5,
        payload: { page: j + 1, connectorKey: "ehr-fhir" },
        lastError: jobFails ? "upstream 503: service unavailable" : null,
        errorHistory,
        startedAt: cursorTime,
        finishedAt,
        createdAt: cursorTime,
        updatedAt: finishedAt,
      });
      pushLog(jobFails ? LogLevel.ERROR : LogLevel.INFO, "worker", jobFails ? "sync.page job failed" : "sync.page job succeeded", {
        connectorId: ehrFhir.id,
        jobId,
        createdAt: finishedAt,
        context: { syncRunId: runId },
      });
    }

    syncRunCount++;
    cursorTime = new Date(cursorTime.getTime() + 20 * 60 * 1000); // every 20 min
  }

  await chunkedCreateMany("sync runs", syncRunRows, (batch) => prisma.syncRun.createMany({ data: batch }));
  console.log(`  (${syncRunCount} runs generated)`);

  // ── Integration events for lab-results & claims ─────────────
  console.log("  generating lab-results and claims events...");
  const eventRows: (Prisma.IntegrationEventCreateManyInput & { id: string })[] = [];

  function generateEvents(connectorId: string, eventType: string, count: number) {
    for (let i = 0; i < count; i++) {
      const receivedAt = faker.date.between({ from: WINDOW_START, to: NOW });
      const roll = faker.number.float({ min: 0, max: 1 });
      let status: EventStatus = EventStatus.PROCESSED;
      const dedupeKey: string | null = faker.string.uuid();
      let error: string | null = null;
      if (roll < 0.02) {
        status = EventStatus.INVALID;
        error = "signature verification failed";
      } else if (roll < 0.05) {
        status = EventStatus.DUPLICATE;
      } else if (roll < 0.08) {
        status = EventStatus.FAILED;
        error = "schema validation error: missing required field";
      }
      eventRows.push({
        id: randomUUID(),
        orgId: org.id,
        connectorId,
        direction: EventDirection.INBOUND,
        eventType,
        dedupeKey,
        status,
        payload:
          eventType === "lab.result.created"
            ? {
                patientRef: `PAT-${faker.number.int({ min: 1000, max: 9999 })}`,
                orderId: `ORD-${faker.number.int({ min: 100000, max: 999999 })}`,
                panel: faker.helpers.arrayElement(["Basic Metabolic Panel", "CBC", "Lipid Panel"]),
                results: [{ code: "2345-7", name: "Glucose", value: String(faker.number.int({ min: 70, max: 200 })), unit: "mg/dL" }],
                observedAt: receivedAt.toISOString(),
              }
            : {
                claimId: `CLM-${faker.number.int({ min: 100000, max: 999999 })}`,
                status: status === EventStatus.FAILED ? "rejected" : "accepted",
                reason: status === EventStatus.FAILED ? "missing prior authorization" : undefined,
              },
        headers: { "x-pulse-delivery": dedupeKey },
        error,
        receivedAt,
        processedAt: status === EventStatus.PROCESSED || status === EventStatus.FAILED ? new Date(receivedAt.getTime() + 1500) : null,
      });
      pushLog(
        status === EventStatus.FAILED || status === EventStatus.INVALID ? LogLevel.ERROR : LogLevel.INFO,
        "web",
        `${eventType} event ${status.toLowerCase()}`,
        { connectorId, createdAt: receivedAt, context: { dedupeKey } },
      );
    }
  }

  generateEvents(labResults.id, "lab.result.created", 850);
  generateEvents(claims.id, "claim.ack", 650);
  await chunkedCreateMany("integration events", eventRows, (batch) => prisma.integrationEvent.createMany({ data: batch }));

  // ── Jobs for lab-results / claims / eligibility ─────────────
  console.log("  generating supporting jobs...");
  function generateJobs(connectorId: string, queue: string, type: string, count: number) {
    for (let i = 0; i < count; i++) {
      const createdAt = faker.date.between({ from: WINDOW_START, to: NOW });
      const roll = faker.number.float({ min: 0, max: 1 });
      const failed = roll < 0.05;
      const finishedAt = new Date(createdAt.getTime() + faker.number.int({ min: 200, max: 4000 }));
      jobRows.push({
        id: randomUUID(),
        orgId: org.id,
        connectorId,
        queue,
        type,
        status: failed ? JobStatus.FAILED : JobStatus.SUCCEEDED,
        attempts: failed ? faker.number.int({ min: 2, max: 5 }) : 1,
        maxAttempts: 5,
        payload: { demo: true },
        lastError: failed ? "downstream processing error" : null,
        errorHistory: failed ? [{ attempt: 1, at: createdAt.toISOString(), message: "downstream processing error", durationMs: 300 }] : [],
        startedAt: createdAt,
        finishedAt,
        createdAt,
        updatedAt: finishedAt,
      });
    }
  }

  generateJobs(labResults.id, "webhook-processing", "lab.process-result", 700);
  generateJobs(claims.id, "claims-submit", "claim.submit", 500);
  generateJobs(eligibility.id, "eligibility", "eligibility.check", 120);

  // Ensure a healthy 20-30 DEAD jobs exist in the visible failed-job queue across connectors.
  const extraDeadCount = faker.number.int({ min: 20, max: 30 });
  for (let i = 0; i < extraDeadCount; i++) {
    const connector = faker.helpers.arrayElement(connectors);
    const createdAt = faker.date.recent({ days: 2, refDate: NOW });
    jobRows.push({
      id: randomUUID(),
      orgId: org.id,
      connectorId: connector.id,
      queue: connector.key === "eligibility" ? "eligibility" : connector.key === "claims" ? "claims-submit" : connector.key === "lab-results" ? "webhook-processing" : "sync",
      type: "demo.dead-job",
      status: JobStatus.DEAD,
      attempts: 5,
      maxAttempts: 5,
      payload: { demo: true, note: "seeded DEAD job for failed-job queue demo" },
      lastError: "attempts exhausted: upstream 503: service unavailable",
      errorHistory: Array.from({ length: 5 }, (_, a) => ({
        attempt: a + 1,
        at: new Date(createdAt.getTime() + a * 4000).toISOString(),
        message: "upstream 503: service unavailable",
        durationMs: faker.number.int({ min: 100, max: 900 }),
      })),
      startedAt: createdAt,
      finishedAt: new Date(createdAt.getTime() + 20000),
      createdAt,
      updatedAt: new Date(createdAt.getTime() + 20000),
    });
  }

  await chunkedCreateMany("jobs", jobRows, (batch) => prisma.job.createMany({ data: batch }));
  await chunkedCreateMany("log entries", logRows, (batch) => prisma.logEntry.createMany({ data: batch }));

  // ── Health snapshots every 15 min for 7 days per connector ──
  console.log("  generating health snapshots...");
  const snapshotRows: Prisma.HealthSnapshotCreateManyInput[] = [];
  for (const connector of connectors) {
    let t = new Date(WINDOW_START);
    while (t < NOW) {
      const windowEnd = new Date(t.getTime() + 15 * 60 * 1000);
      const hit = connector.key === "ehr-fhir" ? inBadWindow(t).hit : false;
      const totalCalls = faker.number.int({ min: 4, max: 20 });
      const errorRate = hit ? faker.number.float({ min: 0.4, max: 0.9 }) : faker.number.float({ min: 0, max: 0.05 });
      const failedCalls = Math.round(totalCalls * errorRate);
      const status: ConnectorStatus = hit
        ? errorRate >= 0.5
          ? ConnectorStatus.DOWN
          : ConnectorStatus.DEGRADED
        : ConnectorStatus.HEALTHY;
      snapshotRows.push({
        connectorId: connector.id,
        status,
        errorRate,
        p95LatencyMs: hit ? faker.number.int({ min: 4000, max: 9000 }) : faker.number.int({ min: 100, max: 900 }),
        totalCalls,
        failedCalls,
        windowStart: t,
        windowEnd,
        createdAt: windowEnd,
      });
      t = windowEnd;
    }
  }
  await chunkedCreateMany("health snapshots", snapshotRows, (batch) => prisma.healthSnapshot.createMany({ data: batch }));

  // ── Two resolved incidents on ehr-fhir (one per bad afternoon) ──
  console.log("  generating incidents...");
  for (let i = 0; i < BAD_WINDOWS.length; i++) {
    const w = BAD_WINDOWS[i];
    const openedAt = new Date(w.start.getTime() + 10 * 60 * 1000);
    const monitoringAt = new Date(w.end.getTime() + 5 * 60 * 1000);
    const resolvedAt = new Date(monitoringAt.getTime() + 10 * 60 * 1000);

    const incidentId = randomUUID();
    const aiSummary = {
      summary:
        "The Mercy General EHR sync connector experienced a sustained outage, with the majority of scheduled sync jobs failing after exhausting all retry attempts.",
      probableCause: "Upstream FHIR service returned repeated 503 Service Unavailable responses across multiple sync cycles.",
      impact: "Patient and appointment record updates from Mercy General EHR were delayed; downstream views showed stale data during the window.",
      suggestedSteps: [
        "Confirm upstream EHR service status with Mercy General's integration team.",
        "Once healthy, retry all DEAD jobs from the Failed Jobs queue for this connector.",
        "Monitor the connector's error rate for 15-30 minutes after recovery before closing out.",
      ],
      confidence: "high",
      model: "seed",
      promptVersion: "seed",
      generatedAt: openedAt.toISOString(),
    };

    await prisma.incident.create({
      data: {
        id: incidentId,
        orgId: org.id,
        connectorId: ehrFhir.id,
        status: IncidentStatus.RESOLVED,
        severity: IncidentSeverity.CRITICAL,
        title: "Mercy General EHR (FHIR R4) is DOWN",
        openedAt,
        acknowledgedAt: new Date(openedAt.getTime() + 3 * 60 * 1000),
        resolvedAt,
        detectionSource: "health-engine",
        aiSummary,
        aiSummaryStatus: "ready",
        timeline: {
          create: [
            { kind: "opened", message: "Incident opened: connector transitioned to DOWN.", actor: "system", createdAt: openedAt },
            { kind: "status_change", message: "Acknowledged by Marcus Webb.", actor: marcus.id, createdAt: new Date(openedAt.getTime() + 3 * 60 * 1000) },
            { kind: "ai_summary", message: "Draft summary generated (AI-generated).", actor: "system", createdAt: new Date(openedAt.getTime() + 4 * 60 * 1000) },
            { kind: "health_transition", message: "Connector recovered to HEALTHY; incident moved to monitoring.", actor: "system", createdAt: monitoringAt },
            { kind: "status_change", message: "Incident auto-resolved after stability window.", actor: "system", createdAt: resolvedAt },
          ],
        },
      },
    });
  }

  // ── Audit entries ───────────────────────────────────────────
  console.log("  generating audit entries...");
  const auditTimes = BAD_WINDOWS.map((w) => new Date(w.end.getTime() + 8 * 60 * 1000));
  await prisma.auditEntry.createMany({
    data: [
      {
        orgId: org.id,
        userId: dana.id,
        action: "connector.chaos_change",
        targetType: "connector",
        targetId: ehrFhir.id,
        metadata: { from: "HEALTHY", to: "OUTAGE" },
        createdAt: BAD_WINDOWS[0].start,
      },
      {
        orgId: org.id,
        userId: dana.id,
        action: "connector.chaos_change",
        targetType: "connector",
        targetId: ehrFhir.id,
        metadata: { from: "OUTAGE", to: "HEALTHY" },
        createdAt: BAD_WINDOWS[0].end,
      },
      {
        orgId: org.id,
        userId: marcus.id,
        action: "job.retry_bulk",
        targetType: "job",
        targetId: ehrFhir.id,
        metadata: { connectorKey: "ehr-fhir", count: 12 },
        createdAt: auditTimes[0],
      },
      {
        orgId: org.id,
        userId: dana.id,
        action: "connector.chaos_change",
        targetType: "connector",
        targetId: ehrFhir.id,
        metadata: { from: "HEALTHY", to: "OUTAGE" },
        createdAt: BAD_WINDOWS[1].start,
      },
      {
        orgId: org.id,
        userId: dana.id,
        action: "connector.chaos_change",
        targetType: "connector",
        targetId: ehrFhir.id,
        metadata: { from: "OUTAGE", to: "HEALTHY" },
        createdAt: BAD_WINDOWS[1].end,
      },
      {
        orgId: org.id,
        userId: marcus.id,
        action: "job.retry_bulk",
        targetType: "job",
        targetId: ehrFhir.id,
        metadata: { connectorKey: "ehr-fhir", count: 18 },
        createdAt: auditTimes[1],
      },
      {
        orgId: org.id,
        userId: marcus.id,
        action: "incident.acknowledge",
        targetType: "incident",
        targetId: ehrFhir.id,
        metadata: {},
        createdAt: auditTimes[1],
      },
    ],
  });

  // ── Summary ──────────────────────────────────────────────────
  const counts = await Promise.all([
    prisma.syncRun.count({ where: { connectorId: { in: connectorIds } } }),
    prisma.job.count({ where: { connectorId: { in: connectorIds } } }),
    prisma.job.count({ where: { connectorId: { in: connectorIds }, status: JobStatus.DEAD } }),
    prisma.integrationEvent.count({ where: { connectorId: { in: connectorIds } } }),
    prisma.logEntry.count({ where: { connectorId: { in: connectorIds } } }),
    prisma.healthSnapshot.count({ where: { connectorId: { in: connectorIds } } }),
    prisma.incident.count({ where: { connectorId: { in: connectorIds } } }),
    prisma.auditEntry.count({ where: { orgId: org.id } }),
  ]);

  console.log("\nSeed complete:");
  console.log(`  organization:        1 (${org.name})`);
  console.log(`  users:                ${users.length}`);
  console.log(`  connectors:           ${connectors.length}`);
  console.log(`  sync runs:            ${counts[0]}`);
  console.log(`  jobs:                 ${counts[1]} (${counts[2]} DEAD)`);
  console.log(`  integration events:   ${counts[3]}`);
  console.log(`  log entries:          ${counts[4]}`);
  console.log(`  health snapshots:     ${counts[5]}`);
  console.log(`  incidents:            ${counts[6]}`);
  console.log(`  audit entries:        ${counts[7]}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

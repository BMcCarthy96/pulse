/**
 * Computes the numbers the README quotes, so they are reproducible rather than remembered.
 *
 *   pnpm --filter @pulse/db metrics
 *
 * Every figure below is derived from whatever is actually in the database — run it after a seed
 * for the demo numbers, or against production for live ones. The SQL is printed alongside each
 * result so a reader can check the definition rather than trust the label.
 */
import { prisma } from "../src/index.js";

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

function duration(ms: number) {
  if (!Number.isFinite(ms)) return "n/a";
  // Round to seconds *first*: rounding the remainder independently can produce "6m 60s".
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function section(title: string, sql: string) {
  console.log(`\n## ${title}`);
  console.log("```sql");
  console.log(sql.trim());
  console.log("```");
}

// ── Error rate ───────────────────────────────────────────────────────────────
// Defined the same way the health engine defines it: failed *attempts* over total attempts, not
// failed job rows over job rows. A sync page that burned five retries hit the upstream five
// times, and counting it once understates a real outage by a factor of five.
section(
  "Job error rate (attempts, matching the health engine's definition)",
  `
SELECT
  SUM(CASE WHEN status IN ('FAILED','DEAD') THEN GREATEST(attempts, 1) ELSE 0 END) AS failed_attempts,
  SUM(GREATEST(attempts, 1))                                                        AS total_attempts
FROM "Job";
`,
);

const [attemptRow] = await prisma.$queryRaw<{ failed_attempts: bigint; total_attempts: bigint }[]>`
  SELECT
    SUM(CASE WHEN status IN ('FAILED','DEAD') THEN GREATEST(attempts, 1) ELSE 0 END) AS failed_attempts,
    SUM(GREATEST(attempts, 1))                                                        AS total_attempts
  FROM "Job";
`;
const failedAttempts = Number(attemptRow.failed_attempts ?? 0);
const totalAttempts = Number(attemptRow.total_attempts ?? 0);
console.log(`failed attempts: ${failedAttempts} / ${totalAttempts} = ${pct(failedAttempts / (totalAttempts || 1))}`);

// ── Retry success rate ───────────────────────────────────────────────────────
section(
  "Retry success rate (jobs that failed at least once and still succeeded)",
  `
SELECT
  COUNT(*) FILTER (WHERE status = 'SUCCEEDED' AND attempts > 1) AS recovered,
  COUNT(*) FILTER (WHERE attempts > 1)                           AS ever_retried
FROM "Job";
`,
);

const [retryRow] = await prisma.$queryRaw<{ recovered: bigint; ever_retried: bigint }[]>`
  SELECT
    COUNT(*) FILTER (WHERE status = 'SUCCEEDED' AND attempts > 1) AS recovered,
    COUNT(*) FILTER (WHERE attempts > 1)                           AS ever_retried
  FROM "Job";
`;
const recovered = Number(retryRow.recovered ?? 0);
const everRetried = Number(retryRow.ever_retried ?? 0);
console.log(`recovered by retry: ${recovered} / ${everRetried} = ${pct(recovered / (everRetried || 1))}`);

// ── MTTD ─────────────────────────────────────────────────────────────────────
// Time from the first failing snapshot of an unhealthy run to the incident opening. This is
// bounded below by the tick interval — you cannot detect faster than you look.
section(
  "MTTD — first unhealthy snapshot to incident opened",
  `
SELECT AVG(EXTRACT(EPOCH FROM (i."openedAt" - s.first_bad)) * 1000) AS mttd_ms
FROM "Incident" i
JOIN LATERAL (
  SELECT MIN("createdAt") AS first_bad
  FROM "HealthSnapshot"
  WHERE "connectorId" = i."connectorId"
    AND status IN ('DEGRADED','DOWN')
    AND "createdAt" <= i."openedAt"
    AND "createdAt" > i."openedAt" - INTERVAL '1 hour'
) s ON TRUE
WHERE s.first_bad IS NOT NULL;
`,
);

const [mttdRow] = await prisma.$queryRaw<{ mttd_ms: number | null }[]>`
  SELECT AVG(EXTRACT(EPOCH FROM (i."openedAt" - s.first_bad)) * 1000) AS mttd_ms
  FROM "Incident" i
  JOIN LATERAL (
    SELECT MIN("createdAt") AS first_bad
    FROM "HealthSnapshot"
    WHERE "connectorId" = i."connectorId"
      AND status IN ('DEGRADED','DOWN')
      AND "createdAt" <= i."openedAt"
      AND "createdAt" > i."openedAt" - INTERVAL '1 hour'
  ) s ON TRUE
  WHERE s.first_bad IS NOT NULL;
`;
console.log(`MTTD: ${duration(Number(mttdRow?.mttd_ms ?? NaN))}`);

// ── MTTR ─────────────────────────────────────────────────────────────────────
section(
  "MTTR — incident opened to resolved",
  `
SELECT
  COUNT(*)                                                             AS resolved_incidents,
  AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "openedAt")) * 1000)          AS mttr_ms,
  MIN(EXTRACT(EPOCH FROM ("resolvedAt" - "openedAt")) * 1000)          AS fastest_ms,
  MAX(EXTRACT(EPOCH FROM ("resolvedAt" - "openedAt")) * 1000)          AS slowest_ms
FROM "Incident"
WHERE "resolvedAt" IS NOT NULL;
`,
);

const [mttrRow] = await prisma.$queryRaw<
  { resolved_incidents: bigint; mttr_ms: number | null; fastest_ms: number | null; slowest_ms: number | null }[]
>`
  SELECT
    COUNT(*)                                                    AS resolved_incidents,
    AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "openedAt")) * 1000) AS mttr_ms,
    MIN(EXTRACT(EPOCH FROM ("resolvedAt" - "openedAt")) * 1000) AS fastest_ms,
    MAX(EXTRACT(EPOCH FROM ("resolvedAt" - "openedAt")) * 1000) AS slowest_ms
  FROM "Incident"
  WHERE "resolvedAt" IS NOT NULL;
`;
console.log(
  `MTTR over ${Number(mttrRow.resolved_incidents)} resolved incidents: ${duration(Number(mttrRow.mttr_ms ?? NaN))} ` +
    `(fastest ${duration(Number(mttrRow.fastest_ms ?? NaN))}, slowest ${duration(Number(mttrRow.slowest_ms ?? NaN))})`,
);

// ── Throughput ───────────────────────────────────────────────────────────────
section(
  "Job throughput over the seeded history",
  `
SELECT
  COUNT(*)                                                                    AS jobs,
  EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt"))) / 3600            AS span_hours
FROM "Job";
`,
);

const [throughputRow] = await prisma.$queryRaw<{ jobs: bigint; span_hours: number | null }[]>`
  SELECT
    COUNT(*)                                                         AS jobs,
    EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt"))) / 3600 AS span_hours
  FROM "Job";
`;
const jobs = Number(throughputRow.jobs);
const spanHours = Number(throughputRow.span_hours ?? 0);
console.log(`${jobs} jobs over ${spanHours.toFixed(1)}h = ${(jobs / (spanHours || 1)).toFixed(1)} jobs/hour`);

// ── Row counts ───────────────────────────────────────────────────────────────
console.log("\n## Corpus");
const [connectors, jobCount, events, logs, snapshots, incidents, audits] = await Promise.all([
  prisma.connector.count(),
  prisma.job.count(),
  prisma.integrationEvent.count(),
  prisma.logEntry.count(),
  prisma.healthSnapshot.count(),
  prisma.incident.count(),
  prisma.auditEntry.count(),
]);
console.log(
  [
    `connectors:       ${connectors}`,
    `jobs:             ${jobCount}`,
    `events:           ${events}`,
    `log entries:      ${logs}`,
    `health snapshots: ${snapshots}`,
    `incidents:        ${incidents}`,
    `audit entries:    ${audits}`,
  ].join("\n"),
);

await prisma.$disconnect();

import { afterAll, beforeEach } from "vitest";
import { prisma } from "@pulse/db";

/**
 * Runs once per test file. Truncates everything before each test so suites cannot leak state
 * into one another — cheaper and far less fragile than trying to unwind each test's writes.
 */

// Child-first: `TRUNCATE ... CASCADE` would do this for us, but naming the order makes an
// accidental new table with a foreign key fail loudly here rather than silently survive.
const TABLES = [
  "AuditEntry",
  "IncidentTimelineEntry",
  "Incident",
  "HealthSnapshot",
  "LogEntry",
  "IntegrationEvent",
  "Job",
  "SyncRun",
  "Connector",
  "User",
  "Organization",
] as const;

export async function truncateAll() {
  const list = TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

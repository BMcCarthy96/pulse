import { describe, expect, it } from "vitest";
import { prisma } from "@pulse/db";
import { runHealthTick } from "../../src/health/engine.js";
import {
  createConnector,
  createFailedJobs,
  createOrg,
  createSucceededJobs,
} from "../../../../test/integration/fixtures.js";

/**
 * The health engine against a real database. The rules themselves are unit-tested exhaustively;
 * what this suite covers is the part that only exists once Postgres is involved — whether the
 * right rows are read, how attempts are expanded into calls, and whether snapshots and status
 * transitions are actually persisted.
 */

async function seedConnector(over: Parameters<typeof createConnector>[1] = {}) {
  const org = await createOrg();
  const connector = await createConnector(org.id, over);
  return { org, connector };
}

const statusOf = async (id: string) =>
  (await prisma.connector.findUniqueOrThrow({ where: { id } })).status;

describe("runHealthTick — snapshots", () => {
  it("writes one snapshot per connector per tick", async () => {
    const { org } = await seedConnector();
    const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    await createConnector(orgRow.id, {
      key: "claims",
      displayName: "ClearPath Clearinghouse (X12 837)",
    });

    await runHealthTick();

    expect(await prisma.healthSnapshot.count()).toBe(2);
  });

  it("records the window arithmetic, not just the verdict", async () => {
    const { org, connector } = await seedConnector();
    await createSucceededJobs(connector.id, org.id, 8, { minutesAgo: 1 });
    await createFailedJobs(connector.id, org.id, 1, { attempts: 2, minutesAgo: 1 });

    await runHealthTick();

    const snapshot = await prisma.healthSnapshot.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    // 8 successes + 2 failed attempts = 10 calls, 2 failed.
    expect(snapshot.totalCalls).toBe(10);
    expect(snapshot.failedCalls).toBe(2);
    expect(snapshot.errorRate).toBeCloseTo(0.2, 5);
  });

  it("counts attempts rather than job rows", async () => {
    // The phase-7 defect: one DEAD job that burned 5 retries is five failed calls, not one.
    // With rows-as-calls a total outage never reaches the consecutiveFailures >= 5 threshold.
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 1, { attempts: 5, minutesAgo: 1 });

    await runHealthTick();

    const snapshot = await prisma.healthSnapshot.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    expect(snapshot.failedCalls).toBe(5);
    expect(await statusOf(connector.id)).toBe("DOWN");
  });

  it("ignores jobs that fell outside the window", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 3, { attempts: 5, minutesAgo: 120 });

    await runHealthTick();

    const snapshot = await prisma.healthSnapshot.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    expect(snapshot.totalCalls).toBe(0);
  });
});

describe("runHealthTick — status transitions", () => {
  it("drives a connector DOWN on a sustained failure streak", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });

    await runHealthTick();

    expect(await statusOf(connector.id)).toBe("DOWN");
  });

  it("marks DEGRADED on an error rate over 10%", async () => {
    const { org, connector } = await seedConnector();
    await createSucceededJobs(connector.id, org.id, 30, { minutesAgo: 3 });
    // 4 single-attempt failures against 30 successes = 11.7%, over the 10% DEGRADED bar. The
    // count matters: these are the newest calls in the window, so 5 of them would form a
    // consecutive-failure streak and the connector would correctly be DOWN instead.
    await createFailedJobs(connector.id, org.id, 4, { attempts: 1, minutesAgo: 2 });
    await createSucceededJobs(connector.id, org.id, 1, { minutesAgo: 1 });

    await runHealthTick();

    expect(await statusOf(connector.id)).toBe("DEGRADED");
  });

  it("leaves a quiet connector at its previous status rather than declaring recovery", async () => {
    const { connector } = await seedConnector({ status: "DOWN" });

    await runHealthTick();

    expect(await statusOf(connector.id)).toBe("DOWN");
  });

  it("reports PAUSED regardless of how bad the window looks", async () => {
    const { org, connector } = await seedConnector({ paused: true, status: "PAUSED" });
    await createFailedJobs(connector.id, org.id, 10, { attempts: 5, minutesAgo: 1 });

    await runHealthTick();

    expect(await statusOf(connector.id)).toBe("PAUSED");
    expect(await prisma.incident.count()).toBe(0);
  });

  it("recovers to HEALTHY once failures age out and successes arrive", async () => {
    const { org, connector } = await seedConnector({ status: "DOWN" });
    await createSucceededJobs(connector.id, org.id, 20, { minutesAgo: 1 });

    await runHealthTick();

    expect(await statusOf(connector.id)).toBe("HEALTHY");
  });

  it("keeps ticking the other connectors when one fails", async () => {
    const { org } = await seedConnector();
    await createConnector(org.id, {
      key: "claims",
      displayName: "ClearPath Clearinghouse (X12 837)",
    });

    await runHealthTick();

    expect(await prisma.healthSnapshot.count()).toBe(2);
  });
});

describe("runHealthTick — incident lifecycle", () => {
  it("opens exactly one CRITICAL incident when a connector goes DOWN", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });

    await runHealthTick();
    await runHealthTick();
    await runHealthTick();

    const incidents = await prisma.incident.findMany({ where: { connectorId: connector.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].severity).toBe("CRITICAL");
    expect(incidents[0].status).toBe("OPEN");
    expect(incidents[0].detectionSource).toBe("health-engine");
  });

  it("writes an opening timeline entry naming the connector", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });

    await runHealthTick();

    const incident = await prisma.incident.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    const timeline = await prisma.incidentTimelineEntry.findMany({
      where: { incidentId: incident.id },
    });
    expect(timeline.some((t) => t.kind === "opened")).toBe(true);
    expect(incident.title).toContain("Mercy General EHR (FHIR R4)");
  });

  it("queues an AI summary without an API key present", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });

    await runHealthTick();

    const incident = await prisma.incident.findFirstOrThrow({
      where: { connectorId: connector.id },
    });
    // Queued, not generated: the summarizer degrades to a `failed` card rather than blocking
    // incident creation on a third-party call.
    expect(incident.aiSummaryStatus).toBe("queued");
  });

  it("moves to MONITORING on recovery and then RESOLVED", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });
    await runHealthTick();

    const opened = await prisma.incident.findFirstOrThrow({ where: { connectorId: connector.id } });
    expect(opened.status).toBe("OPEN");

    // Recovery: clear the failures, add successes, tick again.
    await prisma.job.deleteMany({ where: { connectorId: connector.id } });
    await createSucceededJobs(connector.id, org.id, 20, { minutesAgo: 1 });
    await runHealthTick();

    const monitoring = await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } });
    expect(monitoring.status).toBe("MONITORING");

    // INCIDENT_STABILITY_MIN is 0 in this config, so the next healthy tick resolves it.
    await runHealthTick();

    const resolved = await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it("does not open a second incident while one is already active", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });
    await runHealthTick();

    // Flap healthy then straight back down.
    await prisma.job.deleteMany({ where: { connectorId: connector.id } });
    await createSucceededJobs(connector.id, org.id, 20, { minutesAgo: 1 });
    await runHealthTick();

    await prisma.job.deleteMany({ where: { connectorId: connector.id } });
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });
    await runHealthTick();

    expect(await prisma.incident.count({ where: { connectorId: connector.id } })).toBe(1);
  });

  it("rolls a flapping incident back out of MONITORING rather than opening a new one", async () => {
    const { org, connector } = await seedConnector();
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });
    await runHealthTick();
    const opened = await prisma.incident.findFirstOrThrow({ where: { connectorId: connector.id } });

    await prisma.job.deleteMany({ where: { connectorId: connector.id } });
    await createSucceededJobs(connector.id, org.id, 20, { minutesAgo: 1 });
    await runHealthTick();
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } })).status).toBe(
      "MONITORING",
    );

    await prisma.job.deleteMany({ where: { connectorId: connector.id } });
    await createFailedJobs(connector.id, org.id, 2, { attempts: 5, minutesAgo: 1 });
    await runHealthTick();

    const flapped = await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } });
    expect(flapped.status).toBe("OPEN");
    expect(flapped.resolvedAt).toBeNull();
  });
});

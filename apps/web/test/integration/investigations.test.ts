import { describe, expect, it } from "vitest";
import { prisma } from "@pulse/db";
import { GUIDED_INVESTIGATION_QUESTIONS, MONITORING_ENTRY_SUFFIX } from "@pulse/shared";
import {
  approveInvestigationAction,
  createInvestigation,
  dismissInvestigationAction,
  normalizeInvestigationActionTargets,
  runInvestigation,
} from "@/lib/investigations";
import { createConnector, createOrg, createUser } from "../../../../test/integration/fixtures.js";

describe("deterministic investigation", () => {
  it("maps safe evidence-card action targets to their source records", () => {
    const incident = { id: "incident-1" } as Parameters<
      typeof normalizeInvestigationActionTargets
    >[1];
    const evidence = [
      { id: "evidence-job", sourceId: "job-1", kind: "JOB" },
      { id: "evidence-incident", sourceId: "incident-1", kind: "TIMELINE" },
      { id: "evidence-log", sourceId: "log-1", kind: "LOG" },
    ] as Parameters<typeof normalizeInvestigationActionTargets>[2];
    const report = {
      summary: "summary",
      hypotheses: [],
      uncertainty: "uncertain",
      recommendedActions: [
        {
          type: "RETRY_JOB" as const,
          targetId: "evidence-job",
          rationale: "retry the failed job",
          evidenceIds: ["evidence-job"],
        },
        {
          type: "ACKNOWLEDGE_INCIDENT" as const,
          targetId: "evidence-incident",
          rationale: "assign ownership",
          evidenceIds: ["evidence-incident"],
        },
        {
          type: "RETRY_JOB" as const,
          targetId: "evidence-log",
          rationale: "must remain invalid",
          evidenceIds: ["evidence-log"],
        },
      ],
    };

    const normalized = normalizeInvestigationActionTargets(report, incident, evidence);
    expect(normalized.recommendedActions.map((item) => item.targetId)).toEqual([
      "job-1",
      "incident-1",
      "evidence-log",
    ]);
  });

  it("grounds each guided answer in a non-EHR incident and reuses the completed workspace", async () => {
    const org = await createOrg("Claims Operations");
    const user = await createUser(org.id, { name: "Dana Alvarez", role: "OPS" });
    const connector = await createConnector(org.id, {
      key: "claims",
      displayName: "ClearPath Clearinghouse (X12 837)",
      kind: "outbound_async",
    });
    const incident = await prisma.incident.create({
      data: {
        orgId: org.id,
        connectorId: connector.id,
        severity: "CRITICAL",
        status: "OPEN",
        title: "Claim submission backlog",
      },
    });
    await prisma.job.create({
      data: {
        orgId: org.id,
        connectorId: connector.id,
        queue: "claims-submit",
        type: "claim.submit",
        status: "DEAD",
        attempts: 5,
        maxAttempts: 5,
        payload: { claim: "[REDACTED:claim-ref]" },
        lastError: "clearinghouse returned HTTP 429 after retry exhaustion",
        errorHistory: [],
      },
    });
    const snapshotAt = new Date();
    await prisma.healthSnapshot.create({
      data: {
        connectorId: connector.id,
        status: "DOWN",
        errorRate: 1,
        p95LatencyMs: null,
        totalCalls: 5,
        failedCalls: 5,
        windowStart: new Date(snapshotAt.getTime() - 60_000),
        windowEnd: snapshotAt,
        createdAt: snapshotAt,
      },
    });

    const workspace = await createInvestigation({
      orgId: org.id,
      userId: user.id,
      incidentId: incident.id,
    });
    const summaries: string[] = [];
    for (const guided of GUIDED_INVESTIGATION_QUESTIONS) {
      const result = await runInvestigation({
        orgId: org.id,
        userId: user.id,
        investigationId: workspace.id,
        question: guided.question,
      });
      summaries.push(result.report.summary);
      expect(JSON.stringify(result.report)).not.toMatch(/EHR endpoint|503 response/i);
      expect(result.report.hypotheses.every((item) => item.evidenceIds.length > 0)).toBe(true);
      for (const hypothesis of result.report.hypotheses) {
        expect(new Set(hypothesis.evidenceIds).size).toBe(hypothesis.evidenceIds.length);
      }
    }

    const healthEvidence = workspace.evidence.find((item) => item.kind === "HEALTH_SNAPSHOT");
    expect(healthEvidence?.excerpt).toContain("p95 n/a");
    expect(healthEvidence?.excerpt).not.toContain("n/ams");
    expect(new Set(summaries).size).toBe(GUIDED_INVESTIGATION_QUESTIONS.length);
    const reopened = await createInvestigation({
      orgId: org.id,
      userId: user.id,
      incidentId: incident.id,
    });
    expect(reopened.id).toBe(workspace.id);
    expect(reopened.report).not.toBeNull();
  });
});

async function actionFixture(
  type: "ACKNOWLEDGE_INCIDENT" | "RESOLVE_INCIDENT",
  incidentStatus: "OPEN" | "MONITORING",
) {
  const org = await createOrg("Action approval tenant");
  const user = await createUser(org.id, { role: "OPS" });
  const connector = await createConnector(org.id, { status: "HEALTHY" });
  const incident = await prisma.incident.create({
    data: {
      orgId: org.id,
      connectorId: connector.id,
      severity: "WARNING",
      status: incidentStatus,
      title: "Action approval incident",
    },
  });
  const investigation = await prisma.investigation.create({
    data: {
      orgId: org.id,
      incidentId: incident.id,
      createdById: user.id,
      title: "Action approval investigation",
      status: "COMPLETED",
    },
  });
  const action = await prisma.investigationAction.create({
    data: {
      investigationId: investigation.id,
      type,
      targetId: incident.id,
      rationale: "Operator review required",
      evidenceIds: [],
    },
  });
  return { org, user, connector, incident, investigation, action };
}

describe("investigation action lifecycle", () => {
  it("commits an acknowledgement, its action result, timeline, and audits together", async () => {
    const fixture = await actionFixture("ACKNOWLEDGE_INCIDENT", "OPEN");

    const completed = await approveInvestigationAction({
      orgId: fixture.org.id,
      userId: fixture.user.id,
      investigationId: fixture.investigation.id,
      actionId: fixture.action.id,
    });

    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.result).toMatchObject({ status: "ACKNOWLEDGED" });
    expect(
      await prisma.incident.findUniqueOrThrow({ where: { id: fixture.incident.id } }),
    ).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedAt: expect.any(Date) });
    expect(
      await prisma.incidentTimelineEntry.count({ where: { incidentId: fixture.incident.id } }),
    ).toBe(1);
    expect(
      (
        await prisma.auditEntry.findMany({
          where: { orgId: fixture.org.id },
          orderBy: { createdAt: "asc" },
        })
      ).map((entry) => entry.action),
    ).toEqual(["incident.acknowledge", "investigation.action_approved"]);
  });

  it("requires and records a covered healthy window before resolving", async () => {
    const fixture = await actionFixture("RESOLVE_INCIDENT", "MONITORING");
    const monitoringStartedAt = new Date(Date.now() - 10_000);
    await prisma.incidentTimelineEntry.create({
      data: {
        incidentId: fixture.incident.id,
        kind: "status_change",
        message: `Connector recovered${MONITORING_ENTRY_SUFFIX}`,
        actor: fixture.user.id,
        createdAt: monitoringStartedAt,
      },
    });
    await prisma.healthSnapshot.createMany({
      data: [5_000, 9_000].map((offset) => ({
        connectorId: fixture.connector.id,
        status: "HEALTHY" as const,
        errorRate: 0,
        p95LatencyMs: 80,
        totalCalls: 5,
        failedCalls: 0,
        windowStart: monitoringStartedAt,
        windowEnd: new Date(monitoringStartedAt.getTime() + offset),
        createdAt: new Date(monitoringStartedAt.getTime() + offset),
      })),
    });

    const completed = await approveInvestigationAction({
      orgId: fixture.org.id,
      userId: fixture.user.id,
      investigationId: fixture.investigation.id,
      actionId: fixture.action.id,
    });

    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.result).toMatchObject({ status: "RESOLVED" });
    expect(
      await prisma.incident.findUniqueOrThrow({ where: { id: fixture.incident.id } }),
    ).toMatchObject({ status: "RESOLVED", resolvedAt: expect.any(Date) });
    expect(
      (
        await prisma.auditEntry.findMany({
          where: { orgId: fixture.org.id },
          orderBy: { createdAt: "asc" },
        })
      ).map((entry) => entry.action),
    ).toEqual(["incident.resolve", "investigation.action_approved"]);
  });

  it("records dismissal in the same transaction as the action state", async () => {
    const fixture = await actionFixture("ACKNOWLEDGE_INCIDENT", "OPEN");

    const dismissed = await dismissInvestigationAction({
      orgId: fixture.org.id,
      userId: fixture.user.id,
      investigationId: fixture.investigation.id,
      actionId: fixture.action.id,
    });

    expect(dismissed.status).toBe("DISMISSED");
    expect(await prisma.auditEntry.findMany({ where: { orgId: fixture.org.id } })).toEqual([
      expect.objectContaining({
        action: "investigation.action_dismissed",
        targetId: fixture.action.id,
      }),
    ]);
  });
});

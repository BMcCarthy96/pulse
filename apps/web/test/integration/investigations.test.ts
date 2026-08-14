import { describe, expect, it } from "vitest";
import { prisma } from "@pulse/db";
import { GUIDED_INVESTIGATION_QUESTIONS } from "@pulse/shared";
import { createInvestigation, runInvestigation } from "@/lib/investigations";
import { createConnector, createOrg, createUser } from "../../../../test/integration/fixtures.js";

describe("deterministic investigation", () => {
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

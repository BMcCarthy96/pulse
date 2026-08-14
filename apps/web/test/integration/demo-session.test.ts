import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@pulse/db";
import { GUIDED_INVESTIGATION_QUESTIONS } from "@pulse/shared";
import {
  approveInvestigationAction,
  createInvestigation,
  runInvestigation,
} from "@/lib/investigations";
import { provisionDemoSession, resetDemoSession } from "@/lib/demo-session";
import { syncQueue } from "@/lib/queue";
import { createConnector, createOrg, createUser } from "../../../../test/integration/fixtures.js";

const mockedSession = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/auth", () => ({ auth: async () => mockedSession.current }));

const { POST: resetDemoRoute } = await import("@/app/api/demo/reset/route");

type RouteContext = { params: Promise<Record<string, string>> };

async function baselineState(orgId: string) {
  const incident = await prisma.incident.findFirstOrThrow({ where: { orgId } });
  const connectors = await prisma.connector.findMany({
    where: { orgId },
    orderBy: { key: "asc" },
    select: { key: true, status: true, chaosMode: true, paused: true },
  });
  const jobs = await prisma.job.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    select: { status: true, attempts: true, maxAttempts: true, bullJobId: true },
  });
  return {
    incident,
    connectors,
    jobs,
    counts: {
      users: await prisma.user.count({ where: { orgId } }),
      sessions: await prisma.demoSession.count({ where: { orgId } }),
      connectors: connectors.length,
      incidents: await prisma.incident.count({ where: { orgId } }),
      timeline: await prisma.incidentTimelineEntry.count({
        where: { incident: { orgId } },
      }),
      jobs: jobs.length,
      syncRuns: await prisma.syncRun.count({ where: { connector: { orgId } } }),
      logs: await prisma.logEntry.count({ where: { orgId } }),
      events: await prisma.integrationEvent.count({ where: { orgId } }),
      snapshots: await prisma.healthSnapshot.count({ where: { connector: { orgId } } }),
      investigations: await prisma.investigation.count({ where: { orgId } }),
      actions: await prisma.investigationAction.count({
        where: { investigation: { orgId } },
      }),
      aiRuns: await prisma.aiRun.count({ where: { orgId } }),
      aiCalls: await prisma.aiCall.count({ where: { run: { orgId } } }),
      audit: await prisma.auditEntry.count({ where: { orgId } }),
    },
  };
}

beforeEach(() => {
  process.env.DEMO_MODE = "true";
  delete process.env.ANTHROPIC_API_KEY;
  mockedSession.current = null;
});

afterEach(() => {
  mockedSession.current = null;
});

afterAll(async () => {
  await syncQueue.close();
});

describe("recruiter demo reset", () => {
  it("restores the canonical scenario after approval and worker-like artifacts without touching another tenant", async () => {
    const demo = await provisionDemoSession();
    expect(demo).not.toBeNull();
    const { id: sessionId, orgId, user } = demo!;
    const before = await baselineState(orgId);
    const oldConnectorIds = before.connectors.length
      ? (await prisma.connector.findMany({ where: { orgId }, select: { id: true } })).map(
          (item) => item.id,
        )
      : [];
    const oldIncidentId = before.incident.id;

    expect(before.counts).toEqual({
      users: 1,
      sessions: 1,
      connectors: 4,
      incidents: 1,
      timeline: 2,
      jobs: 2,
      syncRuns: 0,
      logs: 2,
      events: 1,
      snapshots: 2,
      investigations: 0,
      actions: 0,
      aiRuns: 0,
      aiCalls: 0,
      audit: 0,
    });

    const investigation = await createInvestigation({
      orgId,
      userId: user.id,
      incidentId: oldIncidentId,
    });
    const initialEvidenceCount = investigation.evidence.length;
    await runInvestigation({
      orgId,
      userId: user.id,
      investigationId: investigation.id,
      question: GUIDED_INVESTIGATION_QUESTIONS[0]!.question,
    });
    const retryAction = await prisma.investigationAction.findFirstOrThrow({
      where: { investigationId: investigation.id, type: "RETRY_JOB" },
    });
    const approved = await approveInvestigationAction({
      orgId,
      userId: user.id,
      investigationId: investigation.id,
      actionId: retryAction.id,
    });
    const queuedBullJobId = (approved.result as { bullJobId?: string } | null)?.bullJobId;
    expect(queuedBullJobId).toBeTruthy();

    const ehr = await prisma.connector.findFirstOrThrow({ where: { orgId, key: "ehr-fhir" } });
    const generatedRun = await prisma.syncRun.create({
      data: { connectorId: ehr.id, trigger: "manual", status: "FAILED", error: "stale 404" },
    });
    const generatedJob = await prisma.job.create({
      data: {
        orgId,
        connectorId: ehr.id,
        syncRunId: generatedRun.id,
        queue: "sync",
        type: "sync.page",
        status: "FAILED",
        attempts: 1,
        maxAttempts: 5,
        payload: { demo: true, page: 99 },
        lastError: "simulator returned 404",
      },
    });
    const generatedLog = await prisma.logEntry.create({
      data: {
        orgId,
        connectorId: ehr.id,
        jobId: generatedJob.id,
        syncRunId: generatedRun.id,
        incidentId: oldIncidentId,
        level: "ERROR",
        source: "worker",
        message: "old retry returned 404",
      },
    });
    const generatedSnapshot = await prisma.healthSnapshot.create({
      data: {
        connectorId: ehr.id,
        status: "DEGRADED",
        errorRate: 0.5,
        p95LatencyMs: 900,
        totalCalls: 2,
        failedCalls: 1,
        windowStart: new Date(Date.now() - 60_000),
        windowEnd: new Date(),
      },
    });
    const generatedEvent = await prisma.integrationEvent.create({
      data: {
        orgId,
        connectorId: ehr.id,
        direction: "OUTBOUND",
        eventType: "sync.page.generated",
        dedupeKey: `${sessionId}:generated`,
        status: "FAILED",
        payload: { demo: true },
        error: "stale 404",
      },
    });
    const generatedTimeline = await prisma.incidentTimelineEntry.create({
      data: {
        incidentId: oldIncidentId,
        kind: "retry_burst",
        message: "Generated retry activity",
        actor: user.id,
      },
    });
    const aiRun = await prisma.aiRun.findFirstOrThrow({
      where: { orgId, investigationId: investigation.id },
    });
    const generatedCall = await prisma.aiCall.create({
      data: {
        runId: aiRun.id,
        sequence: 1,
        model: "deterministic-demo-v3",
        latencyMs: 1,
        status: "OK",
      },
    });
    const generatedAudit = await prisma.auditEntry.create({
      data: {
        orgId,
        userId: user.id,
        action: "generated.worker_artifact",
        targetType: "job",
        targetId: generatedJob.id,
      },
    });

    const otherOrg = await createOrg("Other tenant");
    const otherUser = await createUser(otherOrg.id);
    const otherConnector = await createConnector(otherOrg.id, { key: "other-connector" });
    const otherJob = await prisma.job.create({
      data: {
        orgId: otherOrg.id,
        connectorId: otherConnector.id,
        queue: "sync",
        type: "sync.page",
        status: "DEAD",
        attempts: 5,
        maxAttempts: 5,
        payload: { otherTenant: true },
      },
    });

    const results = await Promise.all([
      resetDemoSession(orgId, user.id),
      resetDemoSession(orgId, user.id),
    ]);
    expect(results).toEqual([true, true]);

    const after = await baselineState(orgId);
    expect(after.counts).toEqual({ ...before.counts, audit: 1 });
    expect(after.connectors).toEqual(before.connectors);
    expect(after.jobs).toEqual(before.jobs);
    expect(after.incident).toMatchObject({
      status: "OPEN",
      severity: "CRITICAL",
      title: "Mercy General EHR sync is failing",
      acknowledgedAt: null,
      resolvedAt: null,
    });
    expect(after.incident.id).not.toBe(oldIncidentId);
    const replacementConnectorIds = (
      await prisma.connector.findMany({ where: { orgId }, select: { id: true } })
    ).map((item) => item.id);
    expect(replacementConnectorIds.every((id) => !oldConnectorIds.includes(id))).toBe(true);

    expect(await prisma.organization.findUnique({ where: { id: orgId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.demoSession.findUnique({ where: { id: sessionId } })).not.toBeNull();
    expect(await prisma.investigation.findUnique({ where: { id: investigation.id } })).toBeNull();
    expect(
      await prisma.investigationAction.findUnique({ where: { id: retryAction.id } }),
    ).toBeNull();
    expect(await prisma.aiRun.findUnique({ where: { id: aiRun.id } })).toBeNull();
    expect(await prisma.aiCall.findUnique({ where: { id: generatedCall.id } })).toBeNull();
    expect(await prisma.job.findUnique({ where: { id: generatedJob.id } })).toBeNull();
    expect(await prisma.logEntry.findUnique({ where: { id: generatedLog.id } })).toBeNull();
    expect(
      await prisma.healthSnapshot.findUnique({ where: { id: generatedSnapshot.id } }),
    ).toBeNull();
    expect(
      await prisma.integrationEvent.findUnique({ where: { id: generatedEvent.id } }),
    ).toBeNull();
    expect(
      await prisma.incidentTimelineEntry.findUnique({ where: { id: generatedTimeline.id } }),
    ).toBeNull();
    expect(await prisma.auditEntry.findUnique({ where: { id: generatedAudit.id } })).toBeNull();
    expect(await prisma.auditEntry.findMany({ where: { orgId } })).toEqual([
      expect.objectContaining({
        action: "demo.reset",
        targetType: "demo_session",
        targetId: sessionId,
      }),
    ]);
    expect(await syncQueue.getJob(queuedBullJobId!)).toBeUndefined();

    expect(await prisma.user.findUnique({ where: { id: otherUser.id } })).not.toBeNull();
    expect(await prisma.job.findUnique({ where: { id: otherJob.id } })).not.toBeNull();

    const freshInvestigation = await createInvestigation({
      orgId,
      userId: user.id,
      incidentId: after.incident.id,
    });
    expect(freshInvestigation.evidence).toHaveLength(initialEvidenceCount);
  });

  it("converges concurrent API resets on one fresh audit after stale history is removed", async () => {
    const demo = await provisionDemoSession();
    expect(demo).not.toBeNull();
    const { id: sessionId, orgId, user } = demo!;
    await prisma.auditEntry.create({
      data: {
        orgId,
        userId: user.id,
        action: "stale.action",
        targetType: "incident",
        targetId: "stale",
      },
    });
    mockedSession.current = {
      user: {
        id: user.id,
        orgId,
        role: "OPS",
        name: user.name,
        email: user.email,
        demoSessionId: sessionId,
      },
    };

    const requestReset = () =>
      resetDemoRoute(new Request("http://localhost:3010/api/demo/reset", { method: "POST" }), {
        params: Promise.resolve({}),
      } satisfies RouteContext);
    const responses = await Promise.all([requestReset(), requestReset()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    for (const response of responses) {
      expect(await response.json()).toMatchObject({ ok: true, resetAt: expect.any(String) });
    }
    const audits = await prisma.auditEntry.findMany({ where: { orgId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: user.id,
      action: "demo.reset",
      targetType: "demo_session",
      targetId: sessionId,
    });
    expect((await baselineState(orgId)).counts).toMatchObject({
      jobs: 2,
      logs: 2,
      events: 1,
      snapshots: 2,
      investigations: 0,
      actions: 0,
      aiRuns: 0,
      aiCalls: 0,
      audit: 1,
    });
  });
});

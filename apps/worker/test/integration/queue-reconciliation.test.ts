import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@pulse/db";
import { reconcileQueuedJobs, retryTrackedJob, syncQueue } from "../../src/queues.js";
import { processSyncJob } from "../../src/processors/sync.js";
import { createConnector, createOrg } from "../../../../test/integration/fixtures.js";

beforeEach(async () => {
  await syncQueue.obliterate({ force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await syncQueue.obliterate({ force: true });
  await syncQueue.close();
});

async function trackedJob(status: "QUEUED" | "DEAD") {
  const org = await createOrg("Queue reconciliation tenant");
  const connector = await createConnector(org.id);
  const id = `tracked-${Math.random().toString(36).slice(2, 12)}`;
  return prisma.job.create({
    data: {
      id,
      bullJobId: id,
      orgId: org.id,
      connectorId: connector.id,
      queue: "sync",
      type: "sync.page",
      status,
      attempts: status === "DEAD" ? 5 : 0,
      maxAttempts: 5,
      payload: { connectorId: connector.id, orgId: org.id, page: 1 },
    },
  });
}

describe("durable queue dispatch", () => {
  it("restores a missing BullMQ command from its queued database row", async () => {
    const dbJob = await trackedJob("QUEUED");
    expect(await syncQueue.getJob(dbJob.bullJobId!)).toBeUndefined();

    const result = await reconcileQueuedJobs();

    expect(result).toMatchObject({ inspected: 1, restored: 1 });
    const restored = await syncQueue.getJob(dbJob.bullJobId!);
    expect(restored?.id).toBe(dbJob.bullJobId);
    expect(restored?.data).toMatchObject({ dbJobId: dbJob.id, page: 1 });
  });

  it("uses a BullMQ-safe deterministic retry id and rejects a second claim", async () => {
    const dbJob = await trackedJob("DEAD");

    const retried = await retryTrackedJob(dbJob.id);

    expect(retried.bullJobId).toMatch(new RegExp(`^retry-${dbJob.id}-`));
    expect(retried.bullJobId).not.toContain(":");
    expect(await syncQueue.getJob(retried.bullJobId)).toBeDefined();
    await expect(retryTrackedJob(dbJob.id)).rejects.toMatchObject({ status: 409 });
  });

  it("drops a fetched page when reset removes its sync generation", async () => {
    const org = await createOrg("Reset generation tenant");
    const connector = await createConnector(org.id);
    const run = await prisma.syncRun.create({
      data: { connectorId: connector.id, trigger: "manual", status: "RUNNING" },
    });
    const dbJob = await prisma.job.create({
      data: {
        orgId: org.id,
        connectorId: connector.id,
        syncRunId: run.id,
        queue: "sync",
        type: "sync.page",
        status: "ACTIVE",
        attempts: 1,
        maxAttempts: 5,
        payload: {},
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      await prisma.syncRun.delete({ where: { id: run.id } });
      return new Response(JSON.stringify({ resourceType: "Bundle", entry: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      processSyncJob({
        name: "sync.page",
        data: {
          dbJobId: dbJob.id,
          connectorId: connector.id,
          orgId: org.id,
          syncRunId: run.id,
          page: 1,
          resource: "Patient",
        },
      } as never),
    ).resolves.toBeUndefined();

    expect(await prisma.syncRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await prisma.job.count({ where: { orgId: org.id } })).toBe(1);
    expect(await syncQueue.count()).toBe(0);
  });
});

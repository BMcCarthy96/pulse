import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackedJob, retryTrackedJob } from "../src/tracked-jobs.js";

function dependencies() {
  const job = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const queue = { add: vi.fn() };
  return {
    job,
    queue,
    prisma: { job } as unknown as PrismaClient,
    typedQueue: queue as unknown as Queue,
  };
}

const params = (queue: Queue) => ({
  queue,
  queueName: "sync",
  type: "sync.page",
  connectorId: "connector-1",
  orgId: "org-1",
  payload: { page: 1 },
});

afterEach(() => vi.unstubAllGlobals());

describe("tracked job dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes a durable id before dispatching the matching BullMQ command", async () => {
    const deps = dependencies();
    deps.job.create.mockImplementation(async ({ data }: { data: { id: string } }) => ({
      id: data.id,
    }));
    deps.queue.add.mockImplementation(async (_name, _data, options) => ({ id: options.jobId }));

    const result = await createTrackedJob(deps.prisma, {
      ...params(deps.typedQueue),
      opts: { attempts: 2 },
    });
    const createData = deps.job.create.mock.calls[0]?.[0].data;

    expect(createData).toMatchObject({ status: "QUEUED", bullJobId: createData.id });
    expect(result).toEqual({ dbJobId: createData.id, bullJobId: createData.id });
    expect(deps.queue.add).toHaveBeenCalledWith(
      "sync.page",
      expect.objectContaining({ page: 1, dbJobId: createData.id }),
      expect.objectContaining({ jobId: createData.id, attempts: 2 }),
    );
  });

  it("keeps a failed dispatch queued and visible for reconciliation", async () => {
    const deps = dependencies();
    deps.job.create.mockImplementation(async ({ data }: { data: { id: string } }) => ({
      id: data.id,
    }));
    deps.job.update.mockRejectedValue(new Error("database unavailable"));
    deps.queue.add.mockRejectedValue("redis unavailable");
    vi.stubGlobal("crypto", undefined);

    await expect(createTrackedJob(deps.prisma, params(deps.typedQueue))).rejects.toBe(
      "redis unavailable",
    );
    expect(deps.job.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: { lastError: "queue dispatch failed" },
    });
  });
});

describe("tracked job retry", () => {
  const updatedAt = new Date("2026-08-23T12:00:00.000Z");
  const deadJob = {
    id: "job-1",
    queue: "sync",
    type: "sync.page",
    payload: { page: 1 },
    status: "DEAD",
    updatedAt,
  };

  it("claims once and uses a deterministic BullMQ-safe id", async () => {
    const deps = dependencies();
    deps.job.findUniqueOrThrow.mockResolvedValue(deadJob);
    deps.job.updateMany.mockResolvedValue({ count: 1 });
    deps.queue.add.mockResolvedValue({});
    const expectedId = `retry-${deadJob.id}-${updatedAt.getTime().toString(36)}`;

    await expect(
      retryTrackedJob(deps.prisma, { sync: deps.typedQueue }, deadJob.id),
    ).resolves.toEqual({ dbJobId: deadJob.id, bullJobId: expectedId });
    expect(expectedId).not.toContain(":");
    expect(deps.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bullJobId: expectedId }) }),
    );
    expect(deps.queue.add).toHaveBeenCalledWith(
      deadJob.type,
      expect.objectContaining({ dbJobId: deadJob.id, page: 1 }),
      expect.objectContaining({ jobId: expectedId }),
    );
  });

  it("returns a typed conflict when another request won the claim", async () => {
    const deps = dependencies();
    deps.job.findUniqueOrThrow.mockResolvedValue(deadJob);
    deps.job.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      retryTrackedJob(deps.prisma, { sync: deps.typedQueue }, deadJob.id),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(deps.queue.add).not.toHaveBeenCalled();
  });

  it("restores the previous database state when Redis rejects the command", async () => {
    const deps = dependencies();
    deps.job.findUniqueOrThrow.mockResolvedValue(deadJob);
    deps.job.updateMany.mockResolvedValue({ count: 1 });
    deps.job.update.mockRejectedValue(new Error("database unavailable"));
    deps.queue.add.mockRejectedValue("redis unavailable");

    await expect(retryTrackedJob(deps.prisma, { sync: deps.typedQueue }, deadJob.id)).rejects.toBe(
      "redis unavailable",
    );
    expect(deps.job.update).toHaveBeenCalledWith({
      where: { id: deadJob.id },
      data: { status: "DEAD", lastError: "queue dispatch failed" },
    });
  });

  it("rejects database rows that reference an unknown queue", async () => {
    const deps = dependencies();
    deps.job.findUniqueOrThrow.mockResolvedValue({ ...deadJob, queue: "missing" });

    await expect(retryTrackedJob(deps.prisma, {}, deadJob.id)).rejects.toThrow(
      "unknown queue for retry: missing",
    );
    expect(deps.job.updateMany).not.toHaveBeenCalled();
  });
});

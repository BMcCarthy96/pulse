import { UnrecoverableError, type Job } from "bullmq";
import { prisma } from "@pulse/db";
import { fhirBundleSchema, SIMULATOR_HTTP_TIMEOUT_MS } from "@pulse/shared";
import { log } from "../log.js";
import { syncQueue, createTrackedJob } from "../queues.js";

const SIMULATOR_PORT = process.env.PORT ?? process.env.SIMULATOR_PORT ?? "4001";
const configuredSimulatorUrl = process.env.SIMULATOR_BASE_URL?.trim();
const SIMULATOR_BASE_URL =
  process.env.PORT &&
  (!configuredSimulatorUrl || configuredSimulatorUrl === "http://localhost:4001")
    ? `http://localhost:${SIMULATOR_PORT}`
    : configuredSimulatorUrl || `http://localhost:${SIMULATOR_PORT}`;
const PAGE_COUNT = 15;
type FhirBundle = ReturnType<typeof fhirBundleSchema.parse>;

interface SyncStartPayload {
  connectorId: string;
  orgId: string;
  trigger: "schedule" | "manual";
}

interface SyncPagePayload {
  connectorId: string;
  orgId: string;
  syncRunId: string;
  dbJobId?: string;
  page: number;
  resource: "Patient" | "Appointment";
}

export async function processSyncJob(job: Job) {
  if (job.name === "sync.start") return processSyncStart(job as Job<SyncStartPayload>);
  if (job.name === "sync.page") return processSyncPage(job as Job<SyncPagePayload>);
  throw new Error(`unknown sync job type: ${job.name}`);
}

async function processSyncStart(job: Job<SyncStartPayload>) {
  const { connectorId, orgId, trigger } = job.data;

  const connector = await prisma.connector.findUnique({ where: { id: connectorId } });
  if (!connector || connector.paused) {
    log.info({ connectorId }, "sync.start skipped: connector missing or paused");
    return;
  }

  const existingRun = await prisma.syncRun.findFirst({
    where: { connectorId, status: "RUNNING" },
  });
  if (existingRun) {
    log.info(
      { connectorId, syncRunId: existingRun.id },
      "sync.start skipped: run already in progress",
    );
    return;
  }

  const run = await prisma.syncRun.create({ data: { connectorId, status: "RUNNING", trigger } });
  log.info({ connectorId, syncRunId: run.id }, `sync run started (${trigger})`);

  await createTrackedJob({
    queue: syncQueue,
    queueName: "sync",
    type: "sync.page",
    connectorId,
    orgId,
    syncRunId: run.id,
    payload: { connectorId, orgId, syncRunId: run.id, page: 1, resource: "Patient" },
  });
}

async function enqueueSyncPage(payload: Omit<SyncPagePayload, "dbJobId">) {
  try {
    await createTrackedJob({
      queue: syncQueue,
      queueName: "sync",
      type: "sync.page",
      connectorId: payload.connectorId,
      orgId: payload.orgId,
      syncRunId: payload.syncRunId,
      payload,
    });
  } catch (error) {
    const currentRun = await prisma.syncRun.findFirst({
      where: {
        id: payload.syncRunId,
        connectorId: payload.connectorId,
        connector: { orgId: payload.orgId },
      },
      select: { id: true },
    });
    if (currentRun) throw error;
    log.info(
      { connectorId: payload.connectorId, syncRunId: payload.syncRunId },
      "stale next sync page ignored after reset",
    );
  }
}

async function processSyncPage(job: Job<SyncPagePayload>) {
  const { connectorId, orgId, syncRunId, dbJobId, page, resource } = job.data;

  if (dbJobId) {
    const currentJob = await prisma.job.findFirst({
      where: { id: dbJobId, orgId, connectorId, syncRunId },
      select: { id: true },
    });
    if (!currentJob) {
      log.info({ connectorId, syncRunId, jobId: dbJobId }, "stale sync page skipped after reset");
      return;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMULATOR_HTTP_TIMEOUT_MS);
  let bundle: FhirBundle;
  try {
    const res = await fetch(
      `${SIMULATOR_BASE_URL}/ehr/fhir/${resource}?_page=${page}&_count=${PAGE_COUNT}`,
      {
        signal: controller.signal,
        headers: { "x-pulse-org-id": orgId },
      },
    );
    if (!res.ok) throw new Error(`simulator returned ${res.status}`);
    const parsed = fhirBundleSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new UnrecoverableError("simulator returned a schema-invalid FHIR bundle");
    }
    bundle = parsed.data;
  } finally {
    clearTimeout(timeout);
  }

  const fetched = bundle.entry.length;
  const updatedRun = await prisma.syncRun.updateMany({
    where: { id: syncRunId, connectorId, connector: { orgId } },
    data: { recordsFetched: { increment: fetched } },
  });
  if (updatedRun.count !== 1) {
    log.info({ connectorId, syncRunId, jobId: dbJobId }, "stale sync result ignored after reset");
    return;
  }
  log.info(
    { connectorId, syncRunId, context: { page, resource, fetched } },
    `sync page ${page} (${resource}) fetched ${fetched} records`,
  );

  if (bundle.link?.next) {
    const nextUrl = new URL(bundle.link.next, "http://simulator");
    const nextPage = Number(nextUrl.searchParams.get("_page") ?? page + 1);
    await enqueueSyncPage({
      connectorId,
      orgId,
      syncRunId,
      page: nextPage,
      resource,
    });
    return;
  }

  if (resource === "Patient") {
    await enqueueSyncPage({
      connectorId,
      orgId,
      syncRunId,
      page: 1,
      resource: "Appointment",
    });
    return;
  }

  const completedRun = await prisma.syncRun.updateMany({
    where: { id: syncRunId, connectorId, connector: { orgId } },
    data: { status: "SUCCEEDED", finishedAt: new Date() },
  });
  if (completedRun.count !== 1) {
    log.info(
      { connectorId, syncRunId, jobId: dbJobId },
      "stale sync completion ignored after reset",
    );
    return;
  }
  log.info({ connectorId, syncRunId }, "sync run completed");
}

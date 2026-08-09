import type { Job } from "bullmq";
import { prisma } from "@pulse/db";
import { SIMULATOR_HTTP_TIMEOUT_MS } from "@pulse/shared";
import { log } from "../log.js";
import { syncQueue, createTrackedJob } from "../queues.js";

const SIMULATOR_BASE_URL = process.env.SIMULATOR_BASE_URL ?? "http://localhost:4001";
const PAGE_COUNT = 15;

interface SyncStartPayload {
  connectorId: string;
  orgId: string;
  trigger: "schedule" | "manual";
}

interface SyncPagePayload {
  connectorId: string;
  orgId: string;
  syncRunId: string;
  page: number;
  resource: "Patient" | "Appointment";
}

interface FhirBundle {
  entry?: unknown[];
  link?: { next?: string };
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

async function processSyncPage(job: Job<SyncPagePayload>) {
  const { connectorId, orgId, syncRunId, page, resource } = job.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMULATOR_HTTP_TIMEOUT_MS);
  let bundle: FhirBundle;
  try {
    const res = await fetch(
      `${SIMULATOR_BASE_URL}/ehr/fhir/${resource}?_page=${page}&_count=${PAGE_COUNT}`,
      {
        signal: controller.signal,
      },
    );
    if (!res.ok) throw new Error(`simulator returned ${res.status}`);
    bundle = (await res.json()) as FhirBundle;
  } finally {
    clearTimeout(timeout);
  }

  if (!Array.isArray(bundle.entry)) {
    throw new Error("simulator returned a schema-invalid bundle (missing entry array)");
  }

  const fetched = bundle.entry.length;
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: { recordsFetched: { increment: fetched } },
  });
  log.info(
    { connectorId, syncRunId, context: { page, resource, fetched } },
    `sync page ${page} (${resource}) fetched ${fetched} records`,
  );

  if (bundle.link?.next) {
    const nextUrl = new URL(bundle.link.next, "http://simulator");
    const nextPage = Number(nextUrl.searchParams.get("_page") ?? page + 1);
    await createTrackedJob({
      queue: syncQueue,
      queueName: "sync",
      type: "sync.page",
      connectorId,
      orgId,
      syncRunId,
      payload: { connectorId, orgId, syncRunId, page: nextPage, resource },
    });
    return;
  }

  if (resource === "Patient") {
    await createTrackedJob({
      queue: syncQueue,
      queueName: "sync",
      type: "sync.page",
      connectorId,
      orgId,
      syncRunId,
      payload: { connectorId, orgId, syncRunId, page: 1, resource: "Appointment" },
    });
    return;
  }

  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: { status: "SUCCEEDED", finishedAt: new Date() },
  });
  log.info({ connectorId, syncRunId }, "sync run completed");
}

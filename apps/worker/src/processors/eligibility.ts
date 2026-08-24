import { UnrecoverableError, type Job } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import {
  eligibilityCheckResponseSchema,
  parseRetryAfterMs,
  SIMULATOR_HTTP_TIMEOUT_MS,
} from "@pulse/shared";
import { log } from "../log.js";
import { RetryAfterError } from "../queue-errors.js";

const SIMULATOR_PORT = process.env.PORT ?? process.env.SIMULATOR_PORT ?? "4001";
const configuredSimulatorUrl = process.env.SIMULATOR_BASE_URL?.trim();
const SIMULATOR_BASE_URL =
  process.env.PORT &&
  (!configuredSimulatorUrl || configuredSimulatorUrl === "http://localhost:4001")
    ? `http://localhost:${SIMULATOR_PORT}`
    : configuredSimulatorUrl || `http://localhost:${SIMULATOR_PORT}`;

interface EligibilityPayload {
  connectorId: string;
  orgId: string;
  memberId: string;
  payerId: string;
  dbJobId?: string;
}

export async function processEligibilityJob(job: Job<EligibilityPayload>) {
  const { connectorId, memberId, payerId, dbJobId } = job.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMULATOR_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${SIMULATOR_BASE_URL}/eligibility/check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pulse-org-id": job.data.orgId },
      body: JSON.stringify({ memberId, payerId }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new RetryAfterError("rate limited", parseRetryAfterMs(res.headers.get("retry-after")));
    }
    if (!res.ok) throw new Error(`simulator returned ${res.status}`);

    const parsed = eligibilityCheckResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new UnrecoverableError("simulator returned a schema-invalid eligibility response");
    }
    const result = parsed.data;
    if (dbJobId) {
      await prisma.job.update({
        where: { id: dbJobId },
        data: { payload: { memberId, payerId, result } as Prisma.InputJsonValue },
      });
    }
    log.info({ connectorId, jobId: dbJobId }, "eligibility check completed");
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

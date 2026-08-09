import type { Job } from "bullmq";
import { prisma, type Prisma } from "@pulse/db";
import { parseRetryAfterMs, SIMULATOR_HTTP_TIMEOUT_MS } from "@pulse/shared";
import { log } from "../log.js";
import { RetryAfterError } from "../queue-errors.js";

const SIMULATOR_BASE_URL = process.env.SIMULATOR_BASE_URL ?? "http://localhost:4001";

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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId, payerId }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      throw new RetryAfterError("rate limited", parseRetryAfterMs(res.headers.get("retry-after")));
    }
    if (!res.ok) throw new Error(`simulator returned ${res.status}`);

    const result = (await res.json()) as Prisma.InputJsonValue;
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

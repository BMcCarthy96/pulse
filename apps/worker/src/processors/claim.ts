import { UnrecoverableError, type Job } from "bullmq";
import { faker } from "@faker-js/faker";
import { prisma } from "@pulse/db";
import { claimSubmitResponseSchema, SIMULATOR_HTTP_TIMEOUT_MS } from "@pulse/shared";
import { log } from "../log.js";

const SIMULATOR_BASE_URL = process.env.SIMULATOR_BASE_URL ?? "http://localhost:4001";

interface ClaimSubmitPayload {
  connectorId: string;
  orgId: string;
  dbJobId?: string;
}

export async function processClaimJob(job: Job<ClaimSubmitPayload>) {
  const { connectorId, dbJobId } = job.data;

  const body = {
    patientRef: `PAT-${faker.number.int({ min: 1000, max: 9999 })}`,
    payerId: `PAYER-${faker.number.int({ min: 1, max: 9 })}`,
    amountCents: faker.number.int({ min: 5000, max: 50000 }),
    procedureCodes: [faker.helpers.arrayElement(["99213", "99214", "36415", "80053"])],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMULATOR_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${SIMULATOR_BASE_URL}/clearinghouse/claims`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pulse-org-id": job.data.orgId },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`simulator returned ${res.status}`);

    const parsed = claimSubmitResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new UnrecoverableError("simulator returned a schema-invalid claim response");
    }
    const result = parsed.data;
    if (dbJobId) {
      await prisma.job.update({
        where: { id: dbJobId },
        data: { payload: { ...body, claimId: result.claimId } },
      });
    }
    log.info({ connectorId, jobId: dbJobId }, `claim ${result.claimId} submitted`);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Manual test aid for phase 4 acceptance. Requires the worker dev process to be running
 * (workers must be live to process what this script enqueues). Usage:
 *   pnpm --filter @pulse/worker exec tsx --env-file=.env scripts/enqueue-test-jobs.ts <command> [args]
 *
 * Commands:
 *   claims <count>              enqueue N claim.submit jobs
 *   eligibility <memberId> <payerId>   enqueue one eligibility.check job
 *   retry-dead                  retry the most recently created DEAD job
 */
import { prisma } from "@pulse/db";
import { QUEUE_NAMES, ELIGIBILITY_JOB_OPTS } from "@pulse/shared";
import {
  claimsSubmitQueue,
  eligibilityQueue,
  createTrackedJob,
  retryTrackedJob,
} from "../src/queues.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const org = await prisma.organization.findFirstOrThrow();
  const claimsConnector = await prisma.connector.findFirstOrThrow({ where: { key: "claims" } });
  const eligibilityConnector = await prisma.connector.findFirstOrThrow({
    where: { key: "eligibility" },
  });

  if (command === "claims") {
    const count = Number(args[0] ?? 5);
    for (let i = 0; i < count; i++) {
      const { dbJobId } = await createTrackedJob({
        queue: claimsSubmitQueue,
        queueName: QUEUE_NAMES.claimsSubmit,
        type: "claim.submit",
        connectorId: claimsConnector.id,
        orgId: org.id,
        payload: { connectorId: claimsConnector.id, orgId: org.id },
      });
      console.log(`enqueued claim.submit dbJobId=${dbJobId}`);
    }
    return;
  }

  if (command === "eligibility") {
    const memberId = args[0] ?? "MEM-1";
    const payerId = args[1] ?? "PAYER-1";
    const { dbJobId } = await createTrackedJob({
      queue: eligibilityQueue,
      queueName: QUEUE_NAMES.eligibility,
      type: "eligibility.check",
      connectorId: eligibilityConnector.id,
      orgId: org.id,
      payload: { connectorId: eligibilityConnector.id, orgId: org.id, memberId, payerId },
      opts: ELIGIBILITY_JOB_OPTS,
    });
    console.log(`enqueued eligibility.check dbJobId=${dbJobId}`);
    return;
  }

  if (command === "retry-dead") {
    const dead = await prisma.job.findFirst({
      where: { status: "DEAD" },
      orderBy: { createdAt: "desc" },
    });
    if (!dead) {
      console.log("no DEAD jobs found");
      return;
    }
    const result = await retryTrackedJob(dead.id);
    console.log(`retried dbJobId=${dead.id} -> new bullJobId=${result.bullJobId}`);
    return;
  }

  console.log(
    "usage: enqueue-test-jobs.ts <claims <count>|eligibility <memberId> <payerId>|retry-dead>",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await Promise.all([claimsSubmitQueue.close(), eligibilityQueue.close()]);
  });

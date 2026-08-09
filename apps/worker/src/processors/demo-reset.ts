import { prisma } from "@pulse/db";

export async function runDemoReset(job: {
  data: { connectorId: string; orgId: string; userId: string };
}) {
  if (process.env.DEMO_MODE !== "true") return { reset: false, reason: "demo mode disabled" };
  const connector = await prisma.connector.findFirst({
    where: { id: job.data.connectorId, orgId: job.data.orgId },
  });
  if (!connector || connector.chaosMode === "HEALTHY")
    return { reset: false, reason: "already healthy" };
  await prisma.$transaction([
    prisma.connector.update({
      where: { id: connector.id },
      data: { chaosMode: "HEALTHY", chaosConfig: {} },
    }),
    prisma.auditEntry.create({
      data: {
        orgId: connector.orgId,
        userId: job.data.userId,
        action: "connector.chaos_auto_reset",
        targetType: "connector",
        targetId: connector.id,
        metadata: { from: connector.chaosMode, to: "HEALTHY", automatic: true },
      },
    }),
  ]);
  return { reset: true, connectorId: connector.id };
}

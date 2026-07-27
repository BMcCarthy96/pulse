import { prisma, type Prisma } from "@pulse/db";

export async function writeAudit(params: {
  orgId: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditEntry.create({
    data: {
      orgId: params.orgId,
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ?? {},
    },
  });
}

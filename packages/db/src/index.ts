import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prismaLog: ("warn" | "error")[] =
  process.env.LOG_LEVEL === "silent"
    ? []
    : process.env.NODE_ENV === "development"
      ? ["warn", "error"]
      : ["error"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLog,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

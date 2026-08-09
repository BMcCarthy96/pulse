-- AlterTable
ALTER TABLE "LogEntry" ADD COLUMN     "traceId" TEXT;

-- CreateIndex
CREATE INDEX "LogEntry_traceId_createdAt_idx" ON "LogEntry"("traceId", "createdAt");

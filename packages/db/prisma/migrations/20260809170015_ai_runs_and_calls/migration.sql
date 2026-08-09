-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('SUMMARY', 'COPILOT');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REFUSED', 'CANCELLED', 'BUDGET_EXCEEDED');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('OK', 'FAILED', 'REFUSED');

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "incidentId" TEXT,
    "userId" TEXT,
    "kind" "AiRunKind" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "question" TEXT,
    "answer" TEXT,
    "toolEvents" JSONB,
    "contextChars" INTEGER,
    "contextTruncated" BOOLEAN NOT NULL DEFAULT false,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DECIMAL(12,6),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "traceId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "providerRequestId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "pricingVersion" TEXT,
    "costUsd" DECIMAL(12,6),
    "latencyMs" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRun_orgId_createdAt_idx" ON "AiRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_incidentId_createdAt_idx" ON "AiRun"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_kind_status_createdAt_idx" ON "AiRun"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiCall_runId_createdAt_idx" ON "AiCall"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCall_runId_sequence_key" ON "AiCall"("runId", "sequence");

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

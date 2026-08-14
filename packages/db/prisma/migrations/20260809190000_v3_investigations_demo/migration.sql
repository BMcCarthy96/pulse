-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('LOG', 'JOB', 'EVENT', 'HEALTH_SNAPSHOT', 'TIMELINE');

-- CreateEnum
CREATE TYPE "InvestigationActionType" AS ENUM ('RETRY_JOB', 'ACKNOWLEDGE_INCIDENT', 'RESOLVE_INCIDENT', 'REGENERATE_SUMMARY');

-- CreateEnum
CREATE TYPE "InvestigationActionStatus" AS ENUM ('PROPOSED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'DISMISSED', 'STALE');

-- CreateEnum
CREATE TYPE "InvestigationMode" AS ENUM ('LIVE', 'RECORDED');

-- CreateEnum
CREATE TYPE "DemoSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DELETING');

-- AlterEnum
ALTER TYPE "AiRunKind" ADD VALUE 'INVESTIGATION';

-- DropForeignKey
ALTER TABLE "AiRun" DROP CONSTRAINT "AiRun_orgId_fkey";

-- DropForeignKey
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_userId_fkey";

-- DropForeignKey
ALTER TABLE "Connector" DROP CONSTRAINT "Connector_orgId_fkey";

-- DropForeignKey
ALTER TABLE "HealthSnapshot" DROP CONSTRAINT "HealthSnapshot_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "Incident" DROP CONSTRAINT "Incident_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "IncidentTimelineEntry" DROP CONSTRAINT "IncidentTimelineEntry_incidentId_fkey";

-- DropForeignKey
ALTER TABLE "IntegrationEvent" DROP CONSTRAINT "IntegrationEvent_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "SyncRun" DROP CONSTRAINT "SyncRun_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_orgId_fkey";

-- DropIndex
DROP INDEX "Connector_key_key";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN     "investigationId" TEXT,
ADD COLUMN     "mode" "InvestigationMode" NOT NULL DEFAULT 'LIVE';

-- CreateTable
CREATE TABLE "DemoSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "DemoSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "report" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationEvidence" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "href" TEXT,
    "observedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationAction" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "type" "InvestigationActionType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "InvestigationActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "approvedById" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestigationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoSession_orgId_key" ON "DemoSession"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoSession_userId_key" ON "DemoSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoSession_tokenHash_key" ON "DemoSession"("tokenHash");

-- CreateIndex
CREATE INDEX "DemoSession_status_expiresAt_idx" ON "DemoSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Investigation_orgId_createdAt_idx" ON "Investigation"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Investigation_incidentId_status_idx" ON "Investigation"("incidentId", "status");

-- CreateIndex
CREATE INDEX "InvestigationEvidence_investigationId_createdAt_idx" ON "InvestigationEvidence"("investigationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvestigationEvidence_investigationId_kind_sourceId_key" ON "InvestigationEvidence"("investigationId", "kind", "sourceId");

-- CreateIndex
CREATE INDEX "InvestigationAction_investigationId_status_idx" ON "InvestigationAction"("investigationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_orgId_key_key" ON "Connector"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "User_orgId_email_key" ON "User"("orgId", "email");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshot" ADD CONSTRAINT "HealthSnapshot_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTimelineEntry" ADD CONSTRAINT "IncidentTimelineEntry_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoSession" ADD CONSTRAINT "DemoSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoSession" ADD CONSTRAINT "DemoSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationEvidence" ADD CONSTRAINT "InvestigationEvidence_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationAction" ADD CONSTRAINT "InvestigationAction_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationAction" ADD CONSTRAINT "InvestigationAction_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

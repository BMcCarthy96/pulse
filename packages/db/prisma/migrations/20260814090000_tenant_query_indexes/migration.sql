-- Tenant-first indexes for the incident evidence and operational list paths.
CREATE INDEX "Job_orgId_connectorId_status_createdAt_idx"
ON "Job"("orgId", "connectorId", "status", "createdAt");

CREATE INDEX "LogEntry_orgId_connectorId_createdAt_idx"
ON "LogEntry"("orgId", "connectorId", "createdAt");

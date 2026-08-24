-- Tenant-first indexes for the public event and incident list routes.
CREATE INDEX "IntegrationEvent_orgId_connectorId_receivedAt_idx"
ON "IntegrationEvent"("orgId", "connectorId", "receivedAt");

CREATE INDEX "Incident_orgId_status_openedAt_idx"
ON "Incident"("orgId", "status", "openedAt");

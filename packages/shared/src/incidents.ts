export const INCIDENT_ACTIVE_STATUSES = ["OPEN", "ACKNOWLEDGED", "MONITORING"] as const;

export type IncidentStatusValue = "OPEN" | "ACKNOWLEDGED" | "MONITORING" | "RESOLVED";

/**
 * Canonical wording for a `status_change` timeline entry. Shared because the worker writes
 * these and then reads them back to find when an incident entered MONITORING, while the API
 * writes the same entries for human acknowledge/resolve — one format or the lifecycle
 * mis-reads its own history.
 */
export function incidentStatusChangeMessage(from: string, to: string) {
  return `status ${from} → ${to}`;
}

export const MONITORING_ENTRY_SUFFIX = "→ MONITORING";

export type ConnectorKey = "ehr-fhir" | "lab-results" | "claims" | "eligibility";

export interface ConnectorDef {
  key: ConnectorKey;
  displayName: string;
  description: string;
  kind: "poll_sync" | "inbound_webhook" | "outbound_async" | "request_response";
  syncIntervalSec?: number;
}

export const CONNECTOR_DEFS: ConnectorDef[] = [
  {
    key: "ehr-fhir",
    displayName: "Mercy General EHR (FHIR R4)",
    description: "Scheduled polling sync of patient and appointment records via FHIR R4.",
    kind: "poll_sync",
    syncIntervalSec: 300,
  },
  {
    key: "lab-results",
    displayName: "Northside Labs (HL7v2 ORU)",
    description: "Inbound webhook feed of lab result deliveries (HL7v2 ORU messages).",
    kind: "inbound_webhook",
  },
  {
    key: "claims",
    displayName: "ClearPath Clearinghouse (X12 837)",
    description: "Outbound claim submissions with asynchronous acknowledgment webhooks.",
    kind: "outbound_async",
  },
  {
    key: "eligibility",
    displayName: "VerifyMed Eligibility (270/271)",
    description: "On-demand eligibility checks against a rate-limited upstream.",
    kind: "request_response",
  },
];

export function getConnectorDef(key: string): ConnectorDef | undefined {
  return CONNECTOR_DEFS.find((c) => c.key === key);
}

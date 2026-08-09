import { z } from "zod";

// Mirrors Prisma enums (packages/db/prisma/schema.prisma) as zod schemas without importing
// @prisma/client here, so packages/shared has no dependency on packages/db.
export const jobStatusSchema = z.enum(["QUEUED", "ACTIVE", "SUCCEEDED", "FAILED", "DEAD"]);
export const runStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "FAILED", "PARTIAL"]);
export const eventStatusSchema = z.enum([
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
  "DUPLICATE",
  "INVALID",
]);
export const eventDirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);
export const connectorStatusSchema = z.enum(["HEALTHY", "DEGRADED", "DOWN", "PAUSED"]);
export const incidentStatusSchema = z.enum(["OPEN", "ACKNOWLEDGED", "MONITORING", "RESOLVED"]);
export const incidentSeveritySchema = z.enum(["CRITICAL", "WARNING"]);
export const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);
export const roleSchema = z.enum(["ADMIN", "OPS", "VIEWER"]);
export const aiRunKindSchema = z.enum(["SUMMARY", "COPILOT"]);
export const aiRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "REFUSED",
  "CANCELLED",
  "BUDGET_EXCEEDED",
]);
export const aiCallStatusSchema = z.enum(["OK", "FAILED", "REFUSED"]);
export const aiUsageWindowSchema = z.enum(["24h", "7d", "30d", "all"]);

export const chaosModeSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "OUTAGE",
  "TIMEOUT",
  "RATE_LIMIT",
  "BAD_PAYLOAD",
  "AUTH_FAILURE",
]);

export const setChaosSchema = z.object({
  mode: chaosModeSchema,
  config: z
    .object({
      failureRate: z.number().min(0).max(1).optional(),
      latencyMs: z.number().min(0).optional(),
    })
    .optional(),
});

export const updateConnectorSchema = z.object({
  paused: z.boolean().optional(),
  syncIntervalSec: z.number().int().positive().optional(),
});

export const retryBulkSchema = z.object({
  connectorKey: z.string().optional(),
  ids: z.array(z.string()).max(100).optional(),
});

export const simulateLabResultsSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
});

export const simulateClaimsSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
});

export const eligibilityCheckSchema = z.object({
  memberId: z.string().min(1),
  payerId: z.string().min(1),
});

export const addIncidentNoteSchema = z.object({
  message: z.string().min(1).max(2000),
});

export const editSummarySchema = z.object({
  summary: z.string().min(1),
  probableCause: z.string().min(1),
  impact: z.string().min(1),
  suggestedSteps: z.array(z.string()).max(10),
});

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Inbound webhook payload shapes emitted by the simulator.
export const labResultWebhookSchema = z.object({
  eventType: z.literal("lab.result.created"),
  patientRef: z.string(),
  orderId: z.string(),
  panel: z.string(),
  results: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      value: z.string(),
      unit: z.string().optional(),
    }),
  ),
  observedAt: z.string(),
});

export const claimAckWebhookSchema = z.object({
  eventType: z.literal("claim.ack"),
  claimId: z.string(),
  status: z.enum(["accepted", "rejected"]),
  reason: z.string().optional(),
});

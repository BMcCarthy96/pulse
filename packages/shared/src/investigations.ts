import { z } from "zod";

export const investigationStatusSchema = z.enum(["ACTIVE", "COMPLETED", "EXPIRED"]);
export const investigationModeSchema = z.enum(["LIVE", "RECORDED"]);
export const evidenceKindSchema = z.enum(["LOG", "JOB", "EVENT", "HEALTH_SNAPSHOT", "TIMELINE"]);
export const investigationActionTypeSchema = z.enum([
  "RETRY_JOB",
  "ACKNOWLEDGE_INCIDENT",
  "RESOLVE_INCIDENT",
  "REGENERATE_SUMMARY",
]);
export const investigationActionStatusSchema = z.enum([
  "PROPOSED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "DISMISSED",
  "STALE",
]);

export const investigationEvidenceSchema = z.object({
  id: z.string(),
  kind: evidenceKindSchema,
  sourceId: z.string(),
  label: z.string().max(240),
  excerpt: z.string().max(1_200),
  href: z.string().max(500).nullable(),
  observedAt: z.string().nullable(),
});

export const investigationHypothesisSchema = z.object({
  statement: z.string().min(1).max(500),
  confidence: z.enum(["low", "medium", "high"]),
  evidenceIds: z.array(z.string()).min(1).max(8),
});

export const investigationActionSchema = z.object({
  id: z.string().optional(),
  type: investigationActionTypeSchema,
  targetId: z.string().min(1),
  rationale: z.string().min(1).max(600),
  evidenceIds: z.array(z.string()).min(1).max(8),
});

export const investigationReportSchema = z.object({
  summary: z.string().min(1).max(1_500),
  hypotheses: z.array(investigationHypothesisSchema).max(5),
  uncertainty: z.string().min(1).max(600),
  recommendedActions: z.array(investigationActionSchema).max(4),
});

export type InvestigationReport = z.infer<typeof investigationReportSchema>;
export type InvestigationEvidence = z.infer<typeof investigationEvidenceSchema>;
export type InvestigationAction = z.infer<typeof investigationActionSchema>;
export type InvestigationMode = z.infer<typeof investigationModeSchema>;
export type InvestigationActionType = z.infer<typeof investigationActionTypeSchema>;

export const GUIDED_INVESTIGATION_QUESTIONS = [
  {
    id: "first-signal",
    label: "Find the first signal",
    question: "What changed first, and which evidence proves it?",
  },
  {
    id: "impact",
    label: "Assess impact",
    question: "What downstream workflow is affected and how confident are we?",
  },
  {
    id: "next-action",
    label: "Recommend next action",
    question: "What should the on-call engineer do next, and what is safe to approve?",
  },
] as const;

export type InvestigationStreamEvent =
  | {
      event: "run.started";
      data: { runId: string; mode: InvestigationMode; promptVersion: string };
    }
  | { event: "evidence.added"; data: InvestigationEvidence }
  | { event: "hypothesis.updated"; data: z.infer<typeof investigationHypothesisSchema> }
  | { event: "action.proposed"; data: InvestigationAction }
  | { event: "answer.delta"; data: { text: string } }
  | { event: "tool.started"; data: { name: string; turn: number } }
  | {
      event: "tool.completed";
      data: { name: string; turn: number; summary: string; rowCount: number };
    }
  | { event: "run.completed"; data: { runId: string; mode: InvestigationMode } }
  | { event: "run.error"; data: { code: string; message: string; requestId: string | null } };

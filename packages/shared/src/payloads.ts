import { z } from "zod";

export const fhirBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  entry: z.array(
    z.object({
      resource: z.object({
        resourceType: z.string(),
        id: z.string(),
      }),
    }),
  ),
  link: z.object({ next: z.string().optional() }).optional(),
});

export const claimSubmitRequestSchema = z.object({
  patientRef: z.string(),
  payerId: z.string(),
  amountCents: z.number().int().positive(),
  procedureCodes: z.array(z.string()).min(1),
});

export const claimSubmitResponseSchema = z.object({
  claimId: z.string(),
  status: z.literal("accepted"),
});

export const eligibilityCheckResponseSchema = z.object({
  eligible: z.boolean(),
  plan: z.string(),
  copayCents: z.number().int().nonnegative(),
});

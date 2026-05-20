import { z } from "zod";
import { candidateSchema } from "@electron/shared/ai/selector-pipeline-candidate";

export const candidateOutputSchema = z.object({
  candidates: z.array(
    candidateSchema.pick({
      symbol: true,
      instrumentClass: true,
      instrumentDisplayName: true,
      source: true,
      hypeScore: true,
      volumeScore: true,
      catalystScore: true,
      liquidityScore: true,
      catalystSummary: true,
      riskFlags: true,
      rationale: true,
    }),
  ).max(6),
});

export const verificationOutputSchema = z.object({
  candidate: candidateSchema.partial().extend({
    symbol: z.string().min(1),
    instrumentClass: candidateSchema.shape.instrumentClass,
  }),
});

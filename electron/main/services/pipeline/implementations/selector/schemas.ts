import { z } from "zod";
import { candidateSchema } from "@electron/shared/ai/selector-pipeline-candidate";

export const candidateOutputSchema = z.object({
  candidates: z
    .array(
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
    )
    .max(6)
    .describe("Up to 6 evidence-backed trade candidates; fewer is fine."),
});

export const verificationOutputSchema = z.object({
  candidate: candidateSchema
    .partial()
    .extend({
      symbol: z.string().min(1),
      instrumentClass: candidateSchema.shape.instrumentClass,
    })
    .describe(
      "The single validated candidate with verification scores filled in.",
    ),
});

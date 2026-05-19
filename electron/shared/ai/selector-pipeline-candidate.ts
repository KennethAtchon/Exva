import { z } from "zod";

export const selectorEvidenceSchema = z.object({
  summary: z.string().nullable().default(null),
  thesisDirection: z.enum(["long", "short", "neutral"]).default("neutral"),
  sourceWorkers: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  hasQuoteEvidence: z.boolean().default(false),
  hasNewsEvidence: z.boolean().default(false),
  hasSearchEvidence: z.boolean().default(false),
  hasOhlcvEvidence: z.boolean().default(false),
  hasFetchEvidence: z.boolean().default(false),
});
export type SelectorEvidence = z.infer<typeof selectorEvidenceSchema>;

export const candidateSchema = z.object({
  symbol: z.string().min(1).max(20),
  instrumentClass: z.enum(["stock", "crypto", "futures", "prediction_market"]),
  instrumentDisplayName: z.string().nullable().default(null),
  source: z.array(z.string()).default([]),
  hypeScore: z.number().min(0).max(1).nullable().default(null),
  volumeScore: z.number().min(0).max(1).nullable().default(null),
  catalystScore: z.number().min(0).max(1).nullable().default(null),
  liquidityScore: z.number().min(0).max(1).nullable().default(null),
  catalystSummary: z.string().nullable().default(null),
  riskFlags: z.array(z.string()).default([]),
  finalScore: z.number().min(0).max(1).nullable().default(null),
  rationale: z.string().nullable().default(null),
  selectorEvidence: selectorEvidenceSchema.nullable().default(null),
});

export type Candidate = z.infer<typeof candidateSchema>;

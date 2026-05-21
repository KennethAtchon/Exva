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
  symbol: z
    .string()
    .min(1)
    .max(20)
    .describe("Ticker or contract symbol, evidence-backed; never invented."),
  instrumentClass: z
    .enum(["stock", "crypto", "futures", "prediction_market"])
    .describe("Asset class of the candidate."),
  instrumentDisplayName: z
    .string()
    .nullable()
    .default(null)
    .describe("Human-readable name, or null if unknown."),
  source: z
    .array(z.string())
    .default([])
    .describe("Discovery worker id(s) that surfaced this candidate."),
  hypeScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe("Social/attention intensity (0 = none, 1 = peak), or null."),
  volumeScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe("Relative volume strength (0 = thin, 1 = surge), or null."),
  catalystScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe("Strength of the near-term catalyst (0 = none, 1 = major)."),
  liquidityScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe("Tradability/liquidity (0 = illiquid, 1 = deep), or null."),
  catalystSummary: z
    .string()
    .nullable()
    .default(null)
    .describe("One-to-two sentence catalyst description, or null."),
  riskFlags: z
    .array(z.string())
    .default([])
    .describe("Specific risk markers (e.g. low_liquidity, stale_data)."),
  finalScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe("Reserved for engine scoring; leave null."),
  rationale: z
    .string()
    .nullable()
    .default(null)
    .describe("Why this candidate fits the session instructions."),
  selectorEvidence: selectorEvidenceSchema.nullable().default(null),
});

export type Candidate = z.infer<typeof candidateSchema>;

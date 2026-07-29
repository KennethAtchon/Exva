import { z } from "zod";

export const technicalSignalSchema = z.object({
  symbol: z.string(),
  trendDirection: z.enum(["bullish", "bearish", "neutral"]),
  trendStrength: z.number().min(0).max(1),
  momentumScore: z.number().min(0).max(1).nullable().default(null),
  volumeScore: z.number().min(0).max(1).nullable().default(null),
  volumeSignal: z
    .enum(["accumulation", "distribution", "neutral"])
    .nullable()
    .default(null),
  patternName: z.string().nullable().default(null),
  patternStrength: z.number().min(0).max(1).nullable().default(null),
  nearestSupport: z.number().nullable().default(null),
  nearestResistance: z.number().nullable().default(null),
  timeframeAlignment: z.number().min(0).max(1).nullable().default(null),
  rawSummary: z.string().default(""),
});
export type TechnicalSignal = z.infer<typeof technicalSignalSchema>;

export const fundamentalSignalSchema = z.object({
  symbol: z.string(),
  catalystType: z
    .enum([
      "earnings",
      "partnership",
      "fda",
      "contract",
      "macro",
      "social_hype",
      "unknown",
    ])
    .nullable()
    .default(null),
  catalystStrength: z.number().min(0).max(1).nullable().default(null),
  catalystFreshness: z.number().min(0).max(1).nullable().default(null),
  catalystScore: z.number().min(0).max(1).nullable().default(null),
  catalystSummary: z.string().nullable().default(null),
  earningsScore: z.number().min(0).max(1).nullable().default(null),
  sentimentScore: z.number().min(0).max(1).nullable().default(null),
  contradictionRisk: z.number().min(0).max(1).default(0),
  rawSummary: z.string().default(""),
});
export type FundamentalSignal = z.infer<typeof fundamentalSignalSchema>;

export const reviewSignalSchema = z.object({
  symbol: z.string(),
  technicalFundamentalConflict: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null),
  conflictExplanation: z.string().nullable().default(null),
  tailRisks: z.array(z.string()).default([]),
  overallRisk: z.enum(["low", "medium", "high"]).nullable().default(null),
  recommendation: z.enum(["proceed", "reduce_size", "skip"]),
  rawSummary: z.string().default(""),
});
export type ReviewSignal = z.infer<typeof reviewSignalSchema>;

export const executionStrategySchema = z.enum([
  "trend_momentum",
  "breakout",
  "mean_reversion",
  "event_driven",
  "arbitrage",
  "prediction_market",
  "futures_trend",
  "options_flow",
]);
export type ExecutionStrategyType = z.infer<typeof executionStrategySchema>;

export const tradeSignalSchema = z.object({
  symbol: z.string(),
  action: z.enum(["buy", "sell", "skip"]),
  executionStrategy: executionStrategySchema,
  entryPrice: z.number().positive().nullable().default(null),
  confidence: z.number().min(0).max(1),
  /**
   * Raw setup strength in [0, 1] (e.g. |z|/4 capped). Prefer this over
   * `confidence`, which is kept as a deprecated alias equal to strength.
   */
  strength: z.number().min(0).max(1).optional(),
  reasoning: z.string().min(1),
  /**
   * Optional order handoff (Solution 10 options verticals).
   * Carries OCC legs / max debit without a side channel.
   */
  orderMetadata: z.record(z.unknown()).optional(),
});
export type TradeSignal = z.infer<typeof tradeSignalSchema>;

/** Emit strength and keep confidence as a deprecated alias of the same value. */
export function strengthFields(strength: number): {
  strength: number;
  confidence: number;
} {
  const clamped = Math.max(0, Math.min(1, strength));
  return { strength: clamped, confidence: clamped };
}

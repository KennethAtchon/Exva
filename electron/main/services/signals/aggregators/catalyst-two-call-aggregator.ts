import { z } from "zod";
import {
  executionStrategySchema,
  reviewSignalSchema,
  tradeSignalSchema,
  type ReviewSignal,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";

/** Combined analyst output — filing + OHLCV + quote in one LLM call (audit §5.1). */
export const catalystAnalystOutputSchema = z.object({
  executionStrategy: executionStrategySchema,
  action: z.enum(["buy", "sell", "skip"]),
  confidence: z.number().min(0).max(1),
  entryTiming: z.enum(["now", "skip"]),
  catalystStrength: z.number().min(0).max(1).nullable().default(null),
  priceReactionScore: z.number().min(0).max(1).nullable().default(null),
  reasoning: z.string().min(1),
});
export type CatalystAnalystOutput = z.infer<typeof catalystAnalystOutputSchema>;

export const adversarialReviewerOutputSchema = z.object({
  recommendation: z.enum(["proceed", "reduce_size", "skip"]),
  contradictionRisk: z.number().min(0).max(1),
  overallRisk: z.enum(["low", "medium", "high"]),
  reasoning: z.string().min(1),
});
export type AdversarialReviewerOutput = z.infer<
  typeof adversarialReviewerOutputSchema
>;

export function aggregateAdversarialReview(
  symbol: string,
  output: AdversarialReviewerOutput,
): ReviewSignal {
  return reviewSignalSchema.parse({
    symbol,
    recommendation: output.recommendation,
    contradictionRisk: output.contradictionRisk,
    overallRisk: output.overallRisk,
    rawSummary: output.reasoning,
  });
}

export function aggregateCatalystTradeSignal(
  symbol: string,
  analyst: CatalystAnalystOutput,
  review: ReviewSignal,
  options?: { waitForOpenThreshold?: number },
): TradeSignal {
  if (review.recommendation === "skip") {
    return tradeSignalSchema.parse({
      symbol,
      action: "skip",
      executionStrategy: analyst.executionStrategy,
      entryPrice: null,
      confidence: analyst.confidence,
      reasoning: `Adversarial review skipped: ${review.rawSummary}`,
    });
  }

  let action = analyst.entryTiming === "skip" ? "skip" : analyst.action;
  let reasoning = `${analyst.reasoning} Review: ${review.rawSummary}`;

  const threshold = options?.waitForOpenThreshold;
  if (
    action !== "skip" &&
    threshold != null &&
    analyst.confidence < threshold
  ) {
    action = "skip";
    reasoning = `Confidence ${analyst.confidence} is below wait-for-open threshold ${threshold}. ${reasoning}`;
  }

  return tradeSignalSchema.parse({
    symbol,
    action,
    executionStrategy: analyst.executionStrategy,
    entryPrice: null,
    confidence: analyst.confidence,
    reasoning,
  });
}

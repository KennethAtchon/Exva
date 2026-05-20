import { z } from "zod";
import {
  executionStrategySchema,
  tradeSignalSchema,
  type ReviewSignal,
  type TradeSignal,
} from "@electron/shared/ai/pipeline-signals";

export const signalClassifierOutputSchema = z.object({
  executionStrategy: executionStrategySchema,
  action: z.enum(["buy", "sell", "skip"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});
export type SignalClassifierOutput = z.infer<typeof signalClassifierOutputSchema>;

export const entryTimerOutputSchema = z.object({
  entryTiming: z.enum(["now", "wait", "skip"]),
  entryPrice: z.number().positive().nullable().default(null),
  rawSummary: z.string().default(""),
});
export type EntryTimerOutput = z.infer<typeof entryTimerOutputSchema>;

export function aggregateTradeSignal(
  symbol: string,
  review: ReviewSignal,
  classifier: SignalClassifierOutput | null,
  timer: EntryTimerOutput | null,
): TradeSignal {
  if (review.recommendation === "skip" || classifier == null) {
    return tradeSignalSchema.parse({
      symbol,
      action: "skip",
      executionStrategy: classifier?.executionStrategy ?? "trend_momentum",
      entryPrice: null,
      confidence: classifier?.confidence ?? 0,
      reasoning: classifier?.reasoning ?? "Review recommended skip or classifier did not run.",
    });
  }

  const timing = timer?.entryTiming ?? "unknown";
  const timingBlocksEntry = timing === "skip" || timing === "wait";
  const action = timingBlocksEntry ? "skip" : classifier.action;

  const entryPrice = timer?.entryPrice ?? null;

  return tradeSignalSchema.parse({
    symbol,
    action,
    executionStrategy: classifier.executionStrategy,
    entryPrice,
    confidence: classifier.confidence,
    reasoning: `${classifier.reasoning} Timing: ${timing}.`,
  });
}

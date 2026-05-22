import { z } from "zod";
import {
  executionStrategySchema,
  tradeSignalSchema,
  type ReviewSignal,
  type TradeSignal,
} from "@electron/shared/ai/pipeline-signals";

export const signalClassifierOutputSchema = z.object({
  executionStrategy: executionStrategySchema.describe(
    "Execution strategy matching the dominant setup (e.g. catalyst -> event_driven, trend -> trend_momentum).",
  ),
  action: z
    .enum(["buy", "sell", "skip"])
    .describe(
      "Direction; use skip when review says skip or evidence is insufficient.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the call (0 = none, 1 = high)."),
  reasoning: z
    .string()
    .min(1)
    .describe("One or two sentences justifying the call."),
});
export type SignalClassifierOutput = z.infer<
  typeof signalClassifierOutputSchema
>;

export const entryTimerOutputSchema = z.object({
  entryTiming: z
    .enum(["now", "wait", "skip"])
    .describe(
      "now = enter immediately is reasonable; wait = valid setup, timing not ideal; skip = poor or review says skip.",
    ),
  entryPrice: z
    .number()
    .positive()
    .nullable()
    .default(null)
    .describe("Specific limit level when justified; otherwise null."),
  rawSummary: z.string().default("").describe("One-sentence observation."),
});
export type EntryTimerOutput = z.infer<typeof entryTimerOutputSchema>;

export function aggregateTradeSignal(
  symbol: string,
  review: ReviewSignal,
  classifier: SignalClassifierOutput | null,
  timer: EntryTimerOutput | null,
  options?: { mockRelaxedEntryTiming?: boolean },
): TradeSignal {
  if (review.recommendation === "skip" || classifier == null) {
    return tradeSignalSchema.parse({
      symbol,
      action: "skip",
      executionStrategy: classifier?.executionStrategy ?? "trend_momentum",
      entryPrice: null,
      confidence: classifier?.confidence ?? 0,
      reasoning:
        classifier?.reasoning ??
        "Review recommended skip or classifier did not run.",
    });
  }

  let timing = timer?.entryTiming ?? "unknown";
  if (
    options?.mockRelaxedEntryTiming &&
    review.recommendation === "proceed" &&
    timing === "wait"
  ) {
    timing = "now";
  }
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

import { z } from "zod";
import {
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";

export const meanReversionInputSchema = z.object({
  symbol: z.string(),
  ohlcv: z.array(
    z.object({
      close: z.number(),
    }),
  ),
  zScoreEntry: z.number().default(-2),
});

export function computeMeanReversionSignal(
  input: z.infer<typeof meanReversionInputSchema>,
): TradeSignal {
  const closes = input.ohlcv.map((bar) => bar.close);
  if (closes.length < 20) {
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "mean_reversion",
      entryPrice: null,
      confidence: 0.2,
      reasoning: "Insufficient bars for z-score mean reversion.",
    });
  }

  const window = closes.slice(-20);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance =
    window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length;
  const std = Math.sqrt(variance) || 1;
  const last = closes[closes.length - 1] ?? mean;
  const zScore = (last - mean) / std;

  if (zScore <= input.zScoreEntry) {
    const confidence = Math.min(0.95, Math.abs(zScore) / 4);
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "buy",
      executionStrategy: "mean_reversion",
      entryPrice: null,
      confidence,
      reasoning: `Z-score ${zScore.toFixed(2)} below entry ${input.zScoreEntry}; mean-reversion buy.`,
    });
  }

  return tradeSignalSchema.parse({
    symbol: input.symbol,
    action: "skip",
    executionStrategy: "mean_reversion",
    entryPrice: null,
    confidence: Math.min(0.5, Math.abs(zScore) / 4),
    reasoning: `Z-score ${zScore.toFixed(2)} not extended enough for entry.`,
  });
}

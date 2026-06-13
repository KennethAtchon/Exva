import { z } from "zod";
import {
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";

export const trendFollowingInputSchema = z.object({
  symbol: z.string(),
  ohlcv: z.array(
    z.object({
      close: z.number(),
    }),
  ),
  lookback: z.number().int().positive().default(20),
});

export function computeTrendFollowingSignal(
  input: z.infer<typeof trendFollowingInputSchema>,
): TradeSignal {
  const closes = input.ohlcv.map((bar) => bar.close);
  const lookback = input.lookback;
  if (closes.length < lookback + 1) {
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "trend_momentum",
      entryPrice: null,
      confidence: 0.2,
      reasoning: "Insufficient bars for trend-following SMA crossover.",
    });
  }

  const current = closes[closes.length - 1] ?? 0;
  const previous = closes[closes.length - 2] ?? current;
  const sma = (slice: number[]) =>
    slice.reduce((sum, value) => sum + value, 0) / slice.length;
  const currentSma = sma(closes.slice(-lookback));
  const previousSma = sma(closes.slice(-lookback - 1, -1));

  if (previous <= previousSma && current > currentSma) {
    const distance = Math.abs((current - currentSma) / currentSma);
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "buy",
      executionStrategy: "trend_momentum",
      entryPrice: null,
      confidence: Math.min(0.9, 0.55 + distance * 4),
      reasoning: `Price crossed above ${lookback}-bar SMA; 4h trend-following long.`,
    });
  }

  return tradeSignalSchema.parse({
    symbol: input.symbol,
    action: "skip",
    executionStrategy: "trend_momentum",
    entryPrice: null,
    confidence: 0.35,
    reasoning: `No bullish SMA crossover on ${lookback}-bar window.`,
  });
}

import { z } from "zod";
import {
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";

export const breakoutInputSchema = z.object({
  symbol: z.string(),
  ohlcv: z.array(
    z.object({
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number().optional(),
    }),
  ),
  lookback: z.number().int().positive().default(20),
  volumeMultiplierThreshold: z.number().default(1.5),
});

export function computeBreakoutSignal(
  input: z.infer<typeof breakoutInputSchema>,
): TradeSignal {
  const bars = input.ohlcv;
  const lookback = input.lookback;

  if (bars.length < lookback + 1) {
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "breakout",
      entryPrice: null,
      confidence: 0.2,
      reasoning: `Insufficient bars for breakout detection (need ${lookback + 1}, got ${bars.length}).`,
    });
  }

  const window = bars.slice(-lookback - 1, -1);
  const resistanceHigh = Math.max(...window.map((b) => b.high));
  const supportLow = Math.min(...window.map((b) => b.low));
  const current = bars[bars.length - 1];
  if (!current)
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "breakout",
      entryPrice: null,
      confidence: 0,
      reasoning: "No current bar for breakout detection.",
    });
  const prevClose = bars[bars.length - 2]?.close ?? current.close;

  const breakoutAbove =
    prevClose <= resistanceHigh && current.close > resistanceHigh;
  const breakdownBelow = prevClose >= supportLow && current.close < supportLow;

  if (!breakoutAbove && !breakdownBelow) {
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "breakout",
      entryPrice: null,
      confidence: 0.3,
      reasoning: `No breakout above ${lookback}-bar resistance ${resistanceHigh.toFixed(2)}; current close ${current.close.toFixed(2)}.`,
    });
  }

  const avgVolume =
    window.reduce((sum, b) => sum + (b.volume ?? 1), 0) / window.length;
  const currentVolume = current.volume ?? avgVolume;
  const volumeConfirmed =
    currentVolume >= avgVolume * input.volumeMultiplierThreshold;

  const confidence = volumeConfirmed
    ? Math.min(0.9, 0.7 + (currentVolume / avgVolume - 1) * 0.1)
    : 0.55;

  return tradeSignalSchema.parse({
    symbol: input.symbol,
    action: breakoutAbove ? "buy" : "sell",
    executionStrategy: "breakout",
    entryPrice: null,
    confidence,
    reasoning: breakoutAbove
      ? `Breakout above ${lookback}-bar resistance ${resistanceHigh.toFixed(2)} at ${current.close.toFixed(2)}${volumeConfirmed ? " with volume confirmation" : " (low volume)"}.`
      : `Breakdown below ${lookback}-bar support ${supportLow.toFixed(2)} at ${current.close.toFixed(2)}${volumeConfirmed ? " with volume confirmation" : " (low volume)"}.`,
  });
}

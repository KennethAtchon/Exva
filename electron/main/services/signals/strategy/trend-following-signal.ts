import { z } from "zod";
import {
  strengthFields,
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";
import {
  hashBarWindow,
  type DeterministicStrategy,
} from "../../backtest/replay-engine";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

export const trendFollowingInputSchema = z.object({
  symbol: z.string(),
  ohlcv: z.array(
    z.object({
      close: z.number(),
    }),
  ),
  lookback: z.number().int().positive().default(20),
});

export const TREND_FOLLOWING_DEFAULT_LOOKBACK = 20;

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
      ...strengthFields(0.2),
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
    const strength = Math.min(0.9, 0.55 + distance * 4);
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "buy",
      executionStrategy: "trend_momentum",
      entryPrice: null,
      ...strengthFields(strength),
      reasoning: `Price crossed above ${lookback}-bar SMA; 4h trend-following long.`,
    });
  }

  if (previous >= previousSma && current < currentSma) {
    const distance = Math.abs((current - currentSma) / currentSma);
    const strength = Math.min(0.9, 0.55 + distance * 4);
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "sell",
      executionStrategy: "trend_momentum",
      entryPrice: null,
      ...strengthFields(strength),
      reasoning: `Price crossed below ${lookback}-bar SMA; 4h trend-following short.`,
    });
  }

  return tradeSignalSchema.parse({
    symbol: input.symbol,
    action: "skip",
    executionStrategy: "trend_momentum",
    entryPrice: null,
    ...strengthFields(0.35),
    reasoning: `No bullish SMA crossover on ${lookback}-bar window.`,
  });
}

export function createTrendFollowingStrategy(options?: {
  lookback?: number;
  id?: string;
}): DeterministicStrategy {
  const lookback = options?.lookback ?? TREND_FOLLOWING_DEFAULT_LOOKBACK;
  return {
    id: options?.id ?? "trend-following",
    warmupBars: lookback + 1,
    evaluate(bars: OhlcvBar[], ctx) {
      const closes = bars.map((b) => b.close);
      const signal = computeTrendFollowingSignal({
        symbol: ctx.symbol,
        ohlcv: closes.map((close) => ({ close })),
        lookback,
      });
      if (signal.action !== "buy" && signal.action !== "sell") return null;

      const current = closes[closes.length - 1] ?? 0;
      const previous = closes[closes.length - 2] ?? current;
      const sma =
        closes.length >= lookback
          ? closes.slice(-lookback).reduce((a, b) => a + b, 0) / lookback
          : current;
      const strength = signal.strength ?? signal.confidence;

      return {
        action: signal.action,
        strength,
        evidence: { sma, close: current, previousClose: previous, strength },
        barWindowHash: hashBarWindow(bars),
      };
    },
  };
}

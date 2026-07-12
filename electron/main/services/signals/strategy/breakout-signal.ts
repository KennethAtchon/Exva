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

export const BREAKOUT_DEFAULT_LOOKBACK = 20;

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
      ...strengthFields(0.2),
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
      ...strengthFields(0),
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
      ...strengthFields(0.3),
      reasoning: `No breakout above ${lookback}-bar resistance ${resistanceHigh.toFixed(2)}; current close ${current.close.toFixed(2)}.`,
    });
  }

  const avgVolume =
    window.reduce((sum, b) => sum + (b.volume ?? 1), 0) / window.length;
  const currentVolume = current.volume ?? avgVolume;
  const volumeConfirmed =
    currentVolume >= avgVolume * input.volumeMultiplierThreshold;

  const strength = volumeConfirmed
    ? Math.min(0.9, 0.7 + (currentVolume / avgVolume - 1) * 0.1)
    : 0.55;

  return tradeSignalSchema.parse({
    symbol: input.symbol,
    action: breakoutAbove ? "buy" : "sell",
    executionStrategy: "breakout",
    entryPrice: null,
    ...strengthFields(strength),
    reasoning: breakoutAbove
      ? `Breakout above ${lookback}-bar resistance ${resistanceHigh.toFixed(2)} at ${current.close.toFixed(2)}${volumeConfirmed ? " with volume confirmation" : " (low volume)"}.`
      : `Breakdown below ${lookback}-bar support ${supportLow.toFixed(2)} at ${current.close.toFixed(2)}${volumeConfirmed ? " with volume confirmation" : " (low volume)"}.`,
  });
}

export function createBreakoutStrategy(options?: {
  lookback?: number;
  volumeMultiplierThreshold?: number;
  id?: string;
}): DeterministicStrategy {
  const lookback = options?.lookback ?? BREAKOUT_DEFAULT_LOOKBACK;
  const volumeMultiplierThreshold = options?.volumeMultiplierThreshold ?? 1.5;
  return {
    id: options?.id ?? "breakout",
    warmupBars: lookback + 1,
    evaluate(bars: OhlcvBar[], ctx) {
      const signal = computeBreakoutSignal({
        symbol: ctx.symbol,
        ohlcv: bars.map((b) => ({
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume ?? undefined,
        })),
        lookback,
        volumeMultiplierThreshold,
      });
      if (signal.action !== "buy" && signal.action !== "sell") return null;

      const window = bars.slice(-lookback - 1, -1);
      const resistanceHigh =
        window.length > 0 ? Math.max(...window.map((b) => b.high)) : 0;
      const supportLow =
        window.length > 0 ? Math.min(...window.map((b) => b.low)) : 0;
      const current = bars[bars.length - 1];
      const avgVolume =
        window.length > 0
          ? window.reduce((sum, b) => sum + (b.volume ?? 1), 0) / window.length
          : 1;
      const volumeRatio = current
        ? (current.volume ?? avgVolume) / avgVolume
        : 0;
      const strength = signal.strength ?? signal.confidence;

      return {
        action: signal.action,
        strength,
        evidence: {
          resistanceHigh,
          supportLow,
          close: current?.close ?? 0,
          volumeRatio,
          strength,
        },
        barWindowHash: hashBarWindow(bars),
      };
    },
  };
}

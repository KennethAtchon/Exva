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

export const meanReversionInputSchema = z.object({
  symbol: z.string(),
  ohlcv: z.array(
    z.object({
      close: z.number(),
    }),
  ),
  zScoreEntry: z.number().default(-2),
});

export const MEAN_REVERSION_WARMUP_BARS = 20;

export function computeMeanReversionSignal(
  input: z.infer<typeof meanReversionInputSchema>,
): TradeSignal {
  const closes = input.ohlcv.map((bar) => bar.close);
  // Baseline is the preceding N bars only — current bar is the outlier under test
  // (Solution 02 WS3 / P2-1). Need N+1 closes.
  if (closes.length < MEAN_REVERSION_WARMUP_BARS + 1) {
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "mean_reversion",
      entryPrice: null,
      ...strengthFields(0.2),
      reasoning: "Insufficient bars for z-score mean reversion.",
    });
  }

  const last = closes[closes.length - 1]!;
  const window = closes.slice(
    -(MEAN_REVERSION_WARMUP_BARS + 1),
    -1,
  );
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance =
    window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length;
  const std = Math.sqrt(variance) || 1;
  const zScore = (last - mean) / std;

  if (zScore <= input.zScoreEntry) {
    const strength = Math.min(0.95, Math.abs(zScore) / 4);
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "buy",
      executionStrategy: "mean_reversion",
      entryPrice: null,
      ...strengthFields(strength),
      reasoning: `Z-score ${zScore.toFixed(2)} below entry ${input.zScoreEntry}; mean-reversion buy.`,
    });
  }

  return tradeSignalSchema.parse({
    symbol: input.symbol,
    action: "skip",
    executionStrategy: "mean_reversion",
    entryPrice: null,
    ...strengthFields(Math.min(0.5, Math.abs(zScore) / 4)),
    reasoning: `Z-score ${zScore.toFixed(2)} not extended enough for entry.`,
  });
}

export function createMeanReversionStrategy(options?: {
  zScoreEntry?: number;
  id?: string;
}): DeterministicStrategy {
  const zScoreEntry = options?.zScoreEntry ?? -2;
  return {
    id: options?.id ?? "mean-reversion",
    // Evaluator needs preceding N + current bar.
    warmupBars: MEAN_REVERSION_WARMUP_BARS + 1,
    evaluate(bars: OhlcvBar[], ctx) {
      const signal = computeMeanReversionSignal({
        symbol: ctx.symbol,
        ohlcv: bars.map((b) => ({ close: b.close })),
        zScoreEntry,
      });
      if (signal.action !== "buy" && signal.action !== "sell") return null;

      const closes = bars.map((b) => b.close);
      const last = closes[closes.length - 1]!;
      const window = closes.slice(
        -(MEAN_REVERSION_WARMUP_BARS + 1),
        -1,
      );
      const mean =
        window.length > 0
          ? window.reduce((a, b) => a + b, 0) / window.length
          : 0;
      const variance =
        window.length > 0
          ? window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length
          : 0;
      const std = Math.sqrt(variance) || 1;
      const zScore = (last - mean) / std;
      const strength = signal.strength ?? signal.confidence;

      return {
        action: signal.action,
        strength,
        evidence: { zScore, mean, std, close: last, strength },
        barWindowHash: hashBarWindow(bars),
      };
    },
  };
}

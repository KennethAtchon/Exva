import { z } from "zod";
import {
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";

/**
 * Deterministic unusual-options-activity (UOA) detector (Part D). This is the
 * cheap first-pass screen: it fires only when same-day option volume is large
 * relative to standing open interest AND the call/put split leans directional.
 * It does NOT decide to trade on its own — in the full pipeline an AI-search
 * step then classifies whether the flow is informed or just hedging/noise. The
 * detector keeps LLM spend off the table until something is genuinely unusual.
 */
export const optionsFlowInputSchema = z.object({
  underlyingSymbol: z.string(),
  callVolume: z.number().nonnegative(),
  putVolume: z.number().nonnegative(),
  callOpenInterest: z.number().nonnegative(),
  putOpenInterest: z.number().nonnegative(),
  /** Implied-vol percentile of the underlying, [0,1]; null when unavailable. */
  ivPercentile: z.number().min(0).max(1).nullable().default(null),
  /** volume / open-interest ratio that counts as "unusual". */
  volumeOiRatioThreshold: z.number().positive().default(2),
  /** Call share of directional volume above which we read the flow as bullish. */
  bullishSkewThreshold: z.number().min(0.5).max(1).default(0.6),
});

export function computeOptionsFlowSignal(
  input: z.infer<typeof optionsFlowInputSchema>,
): TradeSignal {
  const totalVolume = input.callVolume + input.putVolume;
  const totalOi = input.callOpenInterest + input.putOpenInterest;

  if (totalVolume <= 0) {
    return skip(input.underlyingSymbol, 0.2, "No option volume to evaluate.");
  }

  const volumeOiRatio = totalVolume / Math.max(totalOi, 1);
  if (volumeOiRatio < input.volumeOiRatioThreshold) {
    return skip(
      input.underlyingSymbol,
      0.3,
      `Volume/OI ${volumeOiRatio.toFixed(2)} below ${input.volumeOiRatioThreshold} — flow not unusual.`,
    );
  }

  const callShare = input.callVolume / totalVolume;
  const putShare = input.putVolume / totalVolume;

  // Symmetric read: calls dominating past the threshold is bullish, puts
  // dominating past the same threshold is bearish.
  const bullish = callShare >= input.bullishSkewThreshold;
  const bearish = putShare >= input.bullishSkewThreshold;

  if (!bullish && !bearish) {
    return skip(
      input.underlyingSymbol,
      0.35,
      `Unusual volume (V/OI ${volumeOiRatio.toFixed(2)}) but call/put split balanced (${callShare.toFixed(2)}) — no directional read.`,
    );
  }

  // Confidence scales with how far past the unusual-activity bar the flow is,
  // how lopsided the skew is, and (if known) elevated IV. Capped to 0.85 — a
  // deterministic flow read is never a high-conviction standalone signal.
  const ratioStrength = Math.min(
    1,
    volumeOiRatio / (input.volumeOiRatioThreshold * 2),
  );
  const directionalShare = bullish ? callShare : putShare;
  const skewStrength = Math.min(
    1,
    (directionalShare - input.bullishSkewThreshold) /
      (1 - input.bullishSkewThreshold || 1),
  );
  const ivBoost = input.ivPercentile ?? 0.5;
  const confidence = Math.min(
    0.85,
    0.45 + ratioStrength * 0.2 + skewStrength * 0.15 + ivBoost * 0.05,
  );

  return tradeSignalSchema.parse({
    symbol: input.underlyingSymbol,
    action: bullish ? "buy" : "sell",
    executionStrategy: "options_flow",
    entryPrice: null,
    confidence,
    reasoning: `Unusual ${bullish ? "call" : "put"} flow on ${input.underlyingSymbol}: volume/OI ${volumeOiRatio.toFixed(2)}, ${(directionalShare * 100).toFixed(0)}% ${bullish ? "calls" : "puts"}${input.ivPercentile != null ? `, IV pctile ${(input.ivPercentile * 100).toFixed(0)}` : ""}.`,
  });
}

function skip(
  symbol: string,
  confidence: number,
  reasoning: string,
): TradeSignal {
  return tradeSignalSchema.parse({
    symbol,
    action: "skip",
    executionStrategy: "options_flow",
    entryPrice: null,
    confidence,
    reasoning,
  });
}

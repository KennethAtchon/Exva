import type { EdgeEstimate } from "../domain/edge-estimate";
import { kellyFractionBinary } from "./kelly";

/**
 * Deterministic prediction-market edge model (P4). For a binary market the
 * quoted price is already an implied-probability proxy; the only question is
 * whether the calibrated true probability is meaningfully different from the
 * price after spread and fees.
 *
 * The LLM's job is to extract structured features and a calibrated p_hat. This
 * module turns p_hat + market mid + costs into an edge and a size, with NO LLM
 * involvement in sizing.
 */

export interface PredictionEdgeInput {
  /** Calibrated model probability of YES resolution, [0,1]. */
  predictedProbability: number;
  /** Market-implied probability (mid price), [0,1]. */
  marketMidProbability: number;
  spreadBps: number;
  feeBps: number;
  slippageBps: number;
  /** Calibration bucket sample size backing p_hat. */
  sampleSize: number;
  calibrationBucket: string | null;
  modelId: string;
  modelVersion: string;
  /**
   * Pre-computed uncertainty band on p_hat in bps (e.g. from the
   * forecaster/red-team combination). When provided, it overrides the
   * sample-size-derived band and is gated against `rule.maxUncertaintyBps`.
   */
  uncertaintyBps?: number;
  /** Available order-book depth on the side we'd trade, in USD. */
  orderBookDepthUsd?: number;
  /** Size we intend to trade, in USD — must fit inside the available depth. */
  requiredSizeUsd?: number;
}

export interface PredictionEdgeResult {
  side: "BUY" | "SELL" | "skip";
  edge: number;
  netEdge: number;
  rawKellyFraction: number;
  estimate: EdgeEstimate;
  /** Set when the gate rejected an otherwise-directional edge. */
  skipReason?: string;
}

export interface PredictionTradeRule {
  minNetEdge: number;
  minCalibrationSampleSize: number;
  /** Inclusive window for time-to-resolution, in hours. */
  minHoursToResolution?: number;
  maxHoursToResolution?: number;
  /**
   * Reject when the (red-team-widened) uncertainty band exceeds this many bps.
   * Wide forecaster/red-team disagreement means we don't really have an edge.
   */
  maxUncertaintyBps?: number;
}

/**
 * edge = p_hat - market_mid
 * net_edge = |edge| - (spread + fees + slippage)
 * Trade YES (BUY) when p_hat > mid, NO (SELL) when p_hat < mid, only if net
 * edge clears the rule threshold and the calibration bucket has enough sample.
 */
export function evaluatePredictionEdge(
  input: PredictionEdgeInput,
  rule: PredictionTradeRule,
  asOf: string,
  hoursToResolution?: number,
): PredictionEdgeResult {
  const pHat = clamp01(input.predictedProbability);
  const mid = clamp01(input.marketMidProbability);
  const edge = pHat - mid;
  const costFraction =
    (input.spreadBps + input.feeBps + input.slippageBps) / 10_000;
  const netEdge = Math.abs(edge) - costFraction;

  // Net odds for a binary contract priced at `entry`: payout 1, cost entry,
  // so b = (1 - entry) / entry for a BUY (YES) at price `mid`.
  const side: PredictionEdgeResult["side"] =
    edge > 0 ? "BUY" : edge < 0 ? "SELL" : "skip";
  const entry = side === "BUY" ? mid : 1 - mid;
  const netOdds = entry > 0 && entry < 1 ? (1 - entry) / entry : 0;
  const winProbability = side === "BUY" ? pHat : 1 - pHat;
  const rawKellyFraction =
    side === "skip" ? 0 : kellyFractionBinary(winProbability, netOdds);

  const uncertaintyBps =
    input.uncertaintyBps != null && input.uncertaintyBps >= 0
      ? input.uncertaintyBps
      : estimateUncertaintyBps(pHat, input.sampleSize);

  const skipReason = firstGateFailure(
    side,
    netEdge,
    uncertaintyBps,
    input,
    rule,
    hoursToResolution,
  );
  const tradeable = skipReason == null;

  const estimate: EdgeEstimate = {
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    asOf,
    targetHorizon: "resolution",
    predictedProbability: pHat,
    expectedGrossReturnBps: Math.abs(edge) * 10_000,
    expectedCostBps: costFraction * 10_000,
    expectedNetReturnBps: netEdge * 10_000,
    uncertaintyBps,
    calibrationBucket: input.calibrationBucket,
    sampleSize: input.sampleSize,
  };

  return {
    side: tradeable ? side : "skip",
    edge,
    netEdge,
    rawKellyFraction: tradeable ? rawKellyFraction : 0,
    estimate,
    skipReason,
  };
}

/**
 * Returns the first reason the edge is not tradeable, or undefined if it
 * clears every gate. Order is intentional: direction first, then cost, sample,
 * uncertainty band, order-book depth, and resolution window.
 */
function firstGateFailure(
  side: PredictionEdgeResult["side"],
  netEdge: number,
  uncertaintyBps: number,
  input: PredictionEdgeInput,
  rule: PredictionTradeRule,
  hoursToResolution: number | undefined,
): string | undefined {
  if (side === "skip") return "p_hat equals market mid; no directional edge.";
  if (netEdge < rule.minNetEdge) {
    return `Net edge ${(netEdge * 100).toFixed(2)}% below threshold; does not survive cost.`;
  }
  if (input.sampleSize < rule.minCalibrationSampleSize) {
    return `Calibration sample ${input.sampleSize} below required ${rule.minCalibrationSampleSize}.`;
  }
  if (
    rule.maxUncertaintyBps != null &&
    uncertaintyBps > rule.maxUncertaintyBps
  ) {
    return `Uncertainty ${uncertaintyBps.toFixed(0)}bps exceeds max ${rule.maxUncertaintyBps}bps (forecaster/red-team disagree too much).`;
  }
  if (
    input.orderBookDepthUsd != null &&
    input.requiredSizeUsd != null &&
    input.orderBookDepthUsd < input.requiredSizeUsd
  ) {
    return `Order-book depth $${input.orderBookDepthUsd.toFixed(0)} cannot fill $${input.requiredSizeUsd.toFixed(0)}.`;
  }
  if (!withinResolutionWindow(hoursToResolution, rule)) {
    return "Time-to-resolution outside the validated trading window.";
  }
  return undefined;
}

function withinResolutionWindow(
  hours: number | undefined,
  rule: PredictionTradeRule,
): boolean {
  if (hours == null) return true;
  if (rule.minHoursToResolution != null && hours < rule.minHoursToResolution) {
    return false;
  }
  if (rule.maxHoursToResolution != null && hours > rule.maxHoursToResolution) {
    return false;
  }
  return true;
}

/**
 * Standard error of a proportion (sqrt(p(1-p)/n)) expressed in bps. With no
 * sample, uncertainty is maximal (5000 bps = 50%).
 */
function estimateUncertaintyBps(p: number, sampleSize: number): number {
  if (sampleSize <= 0) return 5000;
  return Math.sqrt((p * (1 - p)) / sampleSize) * 10_000;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

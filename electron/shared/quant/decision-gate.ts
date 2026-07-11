import type { EdgeEstimate } from "../domain/edge-estimate";
import { kellyFractionBinary } from "./kelly";

/**
 * Shared deterministic decision gate for ALL experiences.
 * Prediction markets use evaluatePredictionEdge; rules/other strategies use
 * evaluateEdgeDecision with the same EdgeEstimate + cost floors.
 */

export interface EdgeDecisionInput {
  estimate: EdgeEstimate;
  /** Fractional Kelly raw (before haircuts); null → size from EV only. */
  rawKellyFraction?: number | null;
  /** Multiplicative haircut from calibration service [0,1]; 1 = no haircut. */
  calibrationHaircut?: number;
  /** Available book depth constraint (USD). */
  orderBookDepthUsd?: number;
  requiredSizeUsd?: number;
}

export interface EdgeDecisionRule {
  /** Minimum expectedNetReturnBps after costs. */
  minNetEdgeBps: number;
  /** Reject when estimate.uncertaintyBps exceeds this. */
  maxUncertaintyBps: number;
  /** Minimum sampleSize backing the estimate. */
  minSampleSize: number;
  /** Cap on fractional Kelly after haircuts. */
  maxKellyFraction?: number;
}

export interface EdgeDecisionResult {
  action: "trade" | "skip";
  skipReason?: string;
  /** Kelly fraction after calibration haircut + max cap. */
  sizedKellyFraction: number;
  estimate: EdgeEstimate;
}

export function evaluateEdgeDecision(
  input: EdgeDecisionInput,
  rule: EdgeDecisionRule,
): EdgeDecisionResult {
  const { estimate } = input;
  const haircut = clamp01(input.calibrationHaircut ?? 1);

  if (estimate.expectedNetReturnBps < rule.minNetEdgeBps) {
    return skip(
      estimate,
      `Net edge ${estimate.expectedNetReturnBps.toFixed(0)}bps below floor ${rule.minNetEdgeBps}bps.`,
    );
  }
  if (estimate.uncertaintyBps > rule.maxUncertaintyBps) {
    return skip(
      estimate,
      `Uncertainty ${estimate.uncertaintyBps.toFixed(0)}bps exceeds max ${rule.maxUncertaintyBps}bps.`,
    );
  }
  if (estimate.sampleSize < rule.minSampleSize) {
    return skip(
      estimate,
      `Sample ${estimate.sampleSize} below required ${rule.minSampleSize}.`,
    );
  }
  if (
    input.orderBookDepthUsd != null &&
    input.requiredSizeUsd != null &&
    input.orderBookDepthUsd < input.requiredSizeUsd
  ) {
    return skip(
      estimate,
      `Order-book depth $${input.orderBookDepthUsd.toFixed(0)} cannot fill $${input.requiredSizeUsd.toFixed(0)}.`,
    );
  }

  const raw = input.rawKellyFraction ?? kellyFromNetEdge(estimate);
  const capped =
    rule.maxKellyFraction != null
      ? Math.min(raw * haircut, rule.maxKellyFraction)
      : raw * haircut;

  return {
    action: "trade",
    sizedKellyFraction: Math.max(0, capped),
    estimate,
  };
}

/**
 * Build an EdgeEstimate from a rules-strategy strength statistic when no
 * calibrated probability exists yet. Uses wide uncertainty until labels land.
 */
export function edgeEstimateFromStrength(input: {
  modelId: string;
  modelVersion: string;
  asOf: string;
  targetHorizon: string;
  /** Absolute strength (e.g. |z-score|). */
  strength: number;
  /** Rough expected gross return if the setup plays out, in bps. */
  expectedGrossReturnBps: number;
  expectedCostBps: number;
  sampleSize: number;
  calibrationBucket?: string | null;
  predictedProbability?: number | null;
}): EdgeEstimate {
  const expectedNetReturnBps =
    input.expectedGrossReturnBps - input.expectedCostBps;
  // Uncalibrated → max uncertainty haircut pressure (5000 bps = 50%).
  const uncertaintyBps =
    input.sampleSize > 0
      ? Math.min(5000, 5000 / Math.sqrt(input.sampleSize))
      : 5000;
  return {
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    asOf: input.asOf,
    targetHorizon: input.targetHorizon,
    predictedProbability: input.predictedProbability ?? null,
    expectedGrossReturnBps: input.expectedGrossReturnBps,
    expectedCostBps: input.expectedCostBps,
    expectedNetReturnBps,
    uncertaintyBps,
    calibrationBucket: input.calibrationBucket ?? null,
    sampleSize: input.sampleSize,
  };
}

function kellyFromNetEdge(estimate: EdgeEstimate): number {
  if (estimate.predictedProbability != null) {
    // Binary approx: treat EV as edge over even money when no mid available.
    const p = clamp01(estimate.predictedProbability);
    return kellyFractionBinary(p, 1);
  }
  // Fallback: scale net edge bps into a small fraction (100bps → 0.05).
  return Math.max(0, Math.min(0.25, estimate.expectedNetReturnBps / 2000));
}

function skip(
  estimate: EdgeEstimate,
  skipReason: string,
): EdgeDecisionResult {
  return { action: "skip", skipReason, sizedKellyFraction: 0, estimate };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

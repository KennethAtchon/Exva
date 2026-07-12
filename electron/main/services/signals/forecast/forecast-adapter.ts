/**
 * Maps strategy strength statistics to EdgeEstimate forecasts.
 * Uses CalibrationService empirical buckets when available; otherwise an
 * identity-ish prior with wide uncertainty via edgeEstimateFromStrength.
 */

import type { EdgeEstimate } from "@electron/shared/domain/edge-estimate";
import { edgeEstimateFromStrength } from "@electron/shared/quant/decision-gate";
import type { CalibrationService } from "./calibration-service";

export interface ForecastFromStrengthInput {
  strategyId: string;
  /** Signal strength in [0, 1] (e.g. |z|/4 capped). */
  strength: number;
  modelVersion: string;
  /** Optional calibration store; when present and populated, maps p → empirical. */
  calibration?: CalibrationService | null;
  asOf?: string;
  targetHorizon?: string;
  expectedGrossReturnBps?: number;
  expectedCostBps?: number;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Build an EdgeEstimate from a rules-strategy strength statistic.
 * Calibrated models substitute the bucket's empirical win rate for the prior.
 */
export function forecastFromStrength(
  input: ForecastFromStrengthInput,
): EdgeEstimate {
  const strength = clamp01(input.strength);
  const modelId = `rules:${input.strategyId}`;
  const asOf = input.asOf ?? new Date().toISOString();
  const targetHorizon = input.targetHorizon ?? "1d";
  const expectedGrossReturnBps = input.expectedGrossReturnBps ?? strength * 100;
  const expectedCostBps = input.expectedCostBps ?? 6;

  const cal = input.calibration?.get(modelId, input.modelVersion) ?? null;
  if (cal) {
    const bucket =
      cal.buckets.find((b) => {
        const [lo, hi] = b.label.split("-").map(Number);
        return strength >= (lo ?? 0) && strength < (hi ?? 1);
      }) ?? null;

    if (bucket && bucket.sampleSize > 0) {
      const predictedProbability = clamp01(bucket.empiricalWinRate);
      const expectedNetReturnBps = expectedGrossReturnBps - expectedCostBps;
      // Tighten uncertainty as sample size grows; still conservative.
      const uncertaintyBps = Math.min(
        5000,
        5000 / Math.sqrt(bucket.sampleSize),
      );
      return {
        modelId,
        modelVersion: input.modelVersion,
        asOf,
        targetHorizon,
        predictedProbability,
        expectedGrossReturnBps,
        expectedCostBps,
        expectedNetReturnBps,
        uncertaintyBps,
        calibrationBucket: bucket.label,
        sampleSize: bucket.sampleSize,
      };
    }
  }

  // Uncalibrated identity-ish prior: treat strength as p with max uncertainty.
  return edgeEstimateFromStrength({
    modelId,
    modelVersion: input.modelVersion,
    asOf,
    targetHorizon,
    strength,
    expectedGrossReturnBps,
    expectedCostBps,
    sampleSize: 0,
    predictedProbability: strength,
    calibrationBucket: null,
  });
}

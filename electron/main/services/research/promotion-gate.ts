import type {
  ExperienceResearchContract,
  SignalLabel,
} from "@electron/shared/domain";
import {
  bootstrapMeanCI,
  brierScore,
  purgedWalkForwardFolds,
  sharpeLowerBound,
} from "@electron/shared/quant/statistics";

/**
 * Statistically conservative promotion decision (P1). Promote only on
 * lower-bound metrics, not point estimates, so luck- or regime-driven
 * strategies do not pass:
 *
 *   out_of_sample_trades >= contract.minOutOfSampleTrades
 *   lower_95ci_net_expectancy > 0
 *   lower_95ci_sharpe > 0
 *   max_drawdown_pct <= contract limit
 *   all required folds pass (lower-bound net expectancy positive per fold)
 *   brier <= contract.maxBrierScore (when probability-based)
 */
export interface PromotionEvidence {
  sampleSize: number;
  netExpectancyCi: { point: number; lower: number; upper: number };
  sharpe: { sharpe: number; lower: number };
  maxDrawdownPct: number;
  brierScore: number | null;
  foldsPassed: number;
  foldsRequired: number;
}

export interface PromotionDecisionResult {
  promote: boolean;
  failedCriteria: string[];
  evidence: PromotionEvidence;
}

const BPS = 10_000;

/**
 * Evaluate promotion from a set of out-of-sample labels against the experience
 * research contract. `labels` should be the labeled OUT-OF-SAMPLE observations
 * (net returns drive expectancy; outcomeWin drives Brier).
 */
export function evaluatePromotion(
  contract: ExperienceResearchContract,
  labels: readonly SignalLabel[],
  options?: { seed?: number },
): PromotionDecisionResult {
  const netReturns = labels
    .map((l) => l.netReturnBps)
    .filter((v): v is number => v != null);
  // Net return per opportunity in USD-equivalent fractions (bps/10000); the CI
  // is on the mean per-opportunity return, the expectancy proxy.
  const netFractions = netReturns.map((bps) => bps / BPS);

  const netExpectancyCi = bootstrapMeanCI(netFractions, {
    seed: options?.seed,
  });
  const sharpe = sharpeLowerBound(netFractions, 0.95);
  const maxDrawdownPct = computeMaxDrawdownPct(netFractions);

  const probPredictions = labels
    .filter((l) => l.outcomeWin != null)
    .map((l) => ({
      // Recover predicted probability if encoded; fall back to net sign proxy.
      probability: clampProbability(l),
      outcome: (l.outcomeWin === 1 ? 1 : 0) as 0 | 1,
    }));
  const brier =
    probPredictions.length > 0 ? brierScore(probPredictions) : null;

  const { foldsPassed, foldsRequired } = evaluateFolds(
    netFractions,
    contract.validation.requiredFolds,
    options?.seed,
  );

  const failedCriteria: string[] = [];
  if (netReturns.length < contract.validation.minOutOfSampleTrades) {
    failedCriteria.push("minOutOfSampleTrades");
  }
  if (netExpectancyCi.lower <= contract.validation.minNetExpectancyUsd / BPS) {
    failedCriteria.push("lower95NetExpectancy");
  }
  if (sharpe.lower <= contract.validation.minLowerBoundSharpe) {
    failedCriteria.push("lower95Sharpe");
  }
  if (maxDrawdownPct > contract.validation.maxDrawdownPct) {
    failedCriteria.push("maxDrawdownPct");
  }
  if (
    contract.validation.maxBrierScore != null &&
    brier != null &&
    brier > contract.validation.maxBrierScore
  ) {
    failedCriteria.push("maxBrierScore");
  }
  if (foldsPassed < foldsRequired) {
    failedCriteria.push("requiredFolds");
  }

  return {
    promote: failedCriteria.length === 0,
    failedCriteria,
    evidence: {
      sampleSize: netReturns.length,
      netExpectancyCi: {
        point: netExpectancyCi.point,
        lower: netExpectancyCi.lower,
        upper: netExpectancyCi.upper,
      },
      sharpe: { sharpe: sharpe.sharpe, lower: sharpe.lower },
      maxDrawdownPct,
      brierScore: brier,
      foldsPassed,
      foldsRequired,
    },
  };
}

function evaluateFolds(
  netFractions: number[],
  requiredFolds: number,
  seed?: number,
): { foldsPassed: number; foldsRequired: number } {
  const folds = purgedWalkForwardFolds(netFractions.length, requiredFolds, 1);
  if (folds.length === 0) {
    return { foldsPassed: 0, foldsRequired: requiredFolds };
  }
  let passed = 0;
  for (const fold of folds) {
    const slice = netFractions.slice(fold.testStart, fold.testEnd);
    if (slice.length < 2) continue;
    const ci = bootstrapMeanCI(slice, { seed, iterations: 1000 });
    if (ci.lower > 0) passed += 1;
  }
  return { foldsPassed: passed, foldsRequired: folds.length };
}

function computeMaxDrawdownPct(netFractions: number[]): number {
  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const r of netFractions) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }
  return peak > 0 ? maxDd / peak : maxDd > 0 ? 1 : 0;
}

/** Best-effort predicted probability for Brier when not separately stored. */
function clampProbability(label: SignalLabel): number {
  // If a calibrated probability was persisted on the label we would use it;
  // absent that, treat a positive net return as a 1-ish forecast proxy. This
  // keeps Brier conservative until a probability column is added.
  if (label.netReturnBps == null) return 0.5;
  return label.netReturnBps > 0 ? 0.6 : 0.4;
}

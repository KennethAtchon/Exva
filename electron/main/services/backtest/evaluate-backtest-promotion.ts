import type {
  BacktestVerdict,
  ExperienceResearchContract,
  SignalLabel,
} from "@electron/shared/domain";
import type { BacktestDataQualityReport } from "@electron/shared/domain/backtest-data-quality";
import {
  evaluatePromotion,
  type PromotionDecisionResult,
} from "../research/promotion-gate";

export interface BacktestCriterionResult {
  pass: boolean;
  reason: string;
}

export interface BacktestPromotionEvaluation extends PromotionDecisionResult {
  verdict: BacktestVerdict;
  criteria: Record<string, BacktestCriterionResult>;
  dataQuality: BacktestDataQualityReport[];
}

const CRITERION_LABELS: Record<string, string> = {
  minOutOfSampleTrades: "Minimum out-of-sample trades",
  lower95NetExpectancy: "Lower 95% CI net expectancy > 0",
  lower95Sharpe: "Lower 95% CI Sharpe > contract minimum",
  maxDrawdownPct: "Max drawdown within limit",
  maxBrierScore: "Brier score within limit",
  requiredFolds: "Required folds pass lower-bound check",
  dataQualityComplete: "Data quality complete for all symbols",
  engineV1: "V1 engine runs are inspect-only and cannot promote",
};

/**
 * Apply the shared research-contract promotion gate to backtest labels and
 * attach data-quality + engine-version criteria.
 */
export function evaluateBacktestPromotion(input: {
  contract: ExperienceResearchContract;
  labels: readonly SignalLabel[];
  dataQuality: readonly BacktestDataQualityReport[];
  engineVersion: number;
  seed?: number;
}): BacktestPromotionEvaluation {
  const evaluation = evaluatePromotion(input.contract, input.labels, {
    seed: input.seed,
  });

  const dataQualityComplete = input.dataQuality.every(
    (report) => report.complete,
  );
  const failedCriteria = [...evaluation.failedCriteria];
  if (!dataQualityComplete) {
    failedCriteria.push("dataQualityComplete");
  }
  if (input.engineVersion < 2) {
    failedCriteria.push("engineV1");
  }

  const promote =
    input.engineVersion >= 2 &&
    dataQualityComplete &&
    evaluation.promote;

  const criteria = buildCriteriaMap({
    evaluation,
    failedCriteria,
    dataQualityComplete,
    dataQuality: input.dataQuality,
    engineVersion: input.engineVersion,
    contract: input.contract,
  });

  const verdict = resolveVerdict({
    engineVersion: input.engineVersion,
    promote,
    sampleSize: evaluation.evidence.sampleSize,
    minOutOfSampleTrades: input.contract.validation.minOutOfSampleTrades,
  });

  return {
    ...evaluation,
    promote,
    failedCriteria,
    verdict,
    criteria,
    dataQuality: [...input.dataQuality],
  };
}

function resolveVerdict(input: {
  engineVersion: number;
  promote: boolean;
  sampleSize: number;
  minOutOfSampleTrades: number;
}): BacktestVerdict {
  if (input.engineVersion < 2) return "inconclusive";
  if (input.promote) return "pass";
  if (input.sampleSize < input.minOutOfSampleTrades) return "inconclusive";
  return "fail";
}

function buildCriteriaMap(input: {
  evaluation: PromotionDecisionResult;
  failedCriteria: string[];
  dataQualityComplete: boolean;
  dataQuality: readonly BacktestDataQualityReport[];
  engineVersion: number;
  contract: ExperienceResearchContract;
}): Record<string, BacktestCriterionResult> {
  const failed = new Set(input.failedCriteria);
  const criteria: Record<string, BacktestCriterionResult> = {};

  const sampleSize = input.evaluation.evidence.sampleSize;
  criteria.minOutOfSampleTrades = {
    pass: !failed.has("minOutOfSampleTrades"),
    reason: !failed.has("minOutOfSampleTrades")
      ? `${sampleSize} trades >= ${input.contract.validation.minOutOfSampleTrades}`
      : `${sampleSize} trades < ${input.contract.validation.minOutOfSampleTrades}`,
  };

  const exp = input.evaluation.evidence.netExpectancyCi;
  criteria.lower95NetExpectancy = {
    pass: !failed.has("lower95NetExpectancy"),
    reason: !failed.has("lower95NetExpectancy")
      ? `lower ${exp.lower.toFixed(4)} > 0`
      : `lower ${exp.lower.toFixed(4)} <= 0`,
  };

  const sharpe = input.evaluation.evidence.sharpe;
  criteria.lower95Sharpe = {
    pass: !failed.has("lower95Sharpe"),
    reason: !failed.has("lower95Sharpe")
      ? `lower ${sharpe.lower.toFixed(3)} > ${input.contract.validation.minLowerBoundSharpe}`
      : `lower ${sharpe.lower.toFixed(3)} <= ${input.contract.validation.minLowerBoundSharpe}`,
  };

  criteria.maxDrawdownPct = {
    pass: !failed.has("maxDrawdownPct"),
    reason: !failed.has("maxDrawdownPct")
      ? `${(input.evaluation.evidence.maxDrawdownPct * 100).toFixed(1)}% <= ${(input.contract.validation.maxDrawdownPct * 100).toFixed(1)}%`
      : `${(input.evaluation.evidence.maxDrawdownPct * 100).toFixed(1)}% > ${(input.contract.validation.maxDrawdownPct * 100).toFixed(1)}%`,
  };

  if (input.contract.validation.maxBrierScore != null) {
    const brier = input.evaluation.evidence.brierScore;
    criteria.maxBrierScore = {
      pass: !failed.has("maxBrierScore"),
      reason:
        brier == null
          ? "No probability labels"
          : !failed.has("maxBrierScore")
            ? `Brier ${brier.toFixed(3)} <= ${input.contract.validation.maxBrierScore}`
            : `Brier ${brier.toFixed(3)} > ${input.contract.validation.maxBrierScore}`,
    };
  }

  criteria.requiredFolds = {
    pass: !failed.has("requiredFolds"),
    reason: !failed.has("requiredFolds")
      ? `${input.evaluation.evidence.foldsPassed}/${input.evaluation.evidence.foldsRequired} folds pass`
      : `${input.evaluation.evidence.foldsPassed}/${input.evaluation.evidence.foldsRequired} folds pass`,
  };

  criteria.dataQualityComplete = {
    pass: input.dataQualityComplete,
    reason: input.dataQualityComplete
      ? "All symbols complete"
      : input.dataQuality
          .filter((report) => !report.complete)
          .map((report) => `${report.symbol}: ${report.blockers.join(", ")}`)
          .join("; ") || "Incomplete data",
  };

  if (input.engineVersion < 2) {
    criteria.engineV1 = {
      pass: false,
      reason: "V1 engine runs cannot promote",
    };
  }

  for (const key of Object.keys(criteria)) {
    if (CRITERION_LABELS[key] && !criteria[key]?.reason) {
      criteria[key]!.reason = CRITERION_LABELS[key]!;
    }
  }

  return criteria;
}

/** Map closed backtest trades into promotion labels. */
export function backtestTradesToLabels(
  trades: ReadonlyArray<{
    netReturnBps: number;
    entryTs: string;
  }>,
  contract: ExperienceResearchContract,
): SignalLabel[] {
  return trades.map((trade, index) => ({
    observationId: `backtest-${index}`,
    horizon: contract.label.horizon,
    benchmark: contract.label.benchmark,
    grossReturnBps: trade.netReturnBps,
    costBps: 0,
    netReturnBps: trade.netReturnBps,
    benchmarkReturnBps: 0,
    maxFavorableBps: Math.max(0, trade.netReturnBps),
    maxAdverseBps: Math.min(0, trade.netReturnBps),
    outcomeWin: trade.netReturnBps > 0 ? 1 : 0,
    labelReadyAt: trade.entryTs,
    createdAt: trade.entryTs,
  }));
}

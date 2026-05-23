import { expect } from "vitest";
import type {
  ExecutionStrategyType,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { ReplayResult } from "../cycle-replay-service";

export function assertSubmissionFires(result: ReplayResult): void {
  expect(result.scorecard.submissionFired).toBe(true);
  expect(result.phaseOutputs.selector).not.toBeNull();
}

export function assertSelectorSubmissionRate(
  results: ReplayResult[],
  minRate: number,
): void {
  const selectorResults = results.filter(
    (result) => result.phaseOutputs.selector !== null,
  );
  expect(selectorResults.length).toBeGreaterThan(0);
  const submitted = selectorResults.filter(
    (result) => result.scorecard.submissionFired,
  ).length;
  expect(submitted / selectorResults.length).toBeGreaterThanOrEqual(minRate);
}

export function assertZeroAiAuthoredSizing(results: ReplayResult[]): void {
  for (const result of results) {
    expect(result.scorecard.aiAuthoredSizingFieldCount).toBe(0);
  }
}

export function assertTechnicalSignalHasField(
  result: ReplayResult,
  field: keyof TechnicalSignal,
): void {
  const technical = result.phaseOutputs.technical;
  expect(technical).not.toBeNull();
  expect(technical && technical[field]).not.toBeUndefined();
}

export function assertTradeSignalAction(
  result: ReplayResult,
  action: TradeSignal["action"],
): void {
  expect(result.phaseOutputs.decision?.action).toBe(action);
}

export function assertCostBelowUsd(result: ReplayResult, maxUsd: number): void {
  expect(result.scorecard.totalCostUsd).toBeLessThanOrEqual(maxUsd);
}

export function assertTradeExecutionProfile(
  result: ReplayResult,
  expected: {
    positionSizeUsd: number;
    orderType: "market" | "limit";
    limitPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
  },
): void {
  expect(result.executionProfile).not.toBeNull();
  expect(result.executionProfile?.positionSizeUsd).toBe(
    expected.positionSizeUsd,
  );
  expect(result.executionProfile?.orderType).toBe(expected.orderType);
  expect(result.executionProfile?.limitPrice).toBe(expected.limitPrice);
  if (expected.stopLossPrice == null) {
    expect(result.executionProfile?.stopLossPrice).toBeNull();
  } else {
    expect(result.executionProfile?.stopLossPrice).toBeCloseTo(
      expected.stopLossPrice,
      2,
    );
  }
  if (expected.takeProfitPrice == null) {
    expect(result.executionProfile?.takeProfitPrice).toBeNull();
  } else {
    expect(result.executionProfile?.takeProfitPrice).toBeCloseTo(
      expected.takeProfitPrice,
      2,
    );
  }
}

export function expectedTradeExecutionProfile(args: {
  strategy: ExecutionStrategyType;
  instrumentClass: "stock" | "crypto" | "futures" | "prediction_market";
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  confidence: number;
  kellyFraction: number;
  entryPrice: number | null;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  side?: "BUY" | "SELL";
}): {
  positionSizeUsd: number;
  orderType: "market" | "limit";
  limitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
} {
  const {
    strategy,
    instrumentClass,
    maxPositionUsd,
    maxExposureUsd,
    confidence,
    kellyFraction,
    entryPrice,
    stopLossPct,
    takeProfitPct,
    side = "BUY",
  } = args;

  const sizeFactors: Record<ExecutionStrategyType, number> = {
    trend_momentum: 1,
    breakout: 1,
    mean_reversion: 0.5,
    event_driven: 0.5,
    arbitrage: 0.5,
    prediction_market: 1,
    futures_trend: 1,
  };

  const kelly = Math.max(0, Math.min(1, kellyFraction));
  const conf = Math.max(0, Math.min(1, confidence));
  const sizeFactor = sizeFactors[strategy] ?? 1;

  let positionSizeUsd =
    instrumentClass === "prediction_market"
      ? Math.min(maxPositionUsd, maxExposureUsd ?? maxPositionUsd) *
        kelly *
        conf *
        sizeFactor
      : maxPositionUsd * conf * kelly * sizeFactor;
  positionSizeUsd = Math.min(positionSizeUsd, maxPositionUsd);
  if (maxExposureUsd != null)
    positionSizeUsd = Math.min(positionSizeUsd, maxExposureUsd);

  const orderType =
    entryPrice != null ? ("limit" as const) : ("market" as const);
  let stopLossPrice: number | null = null;
  let takeProfitPrice: number | null = null;
  if (entryPrice != null && entryPrice > 0) {
    if (stopLossPct != null && stopLossPct > 0) {
      const delta = entryPrice * (stopLossPct / 100);
      stopLossPrice = side === "BUY" ? entryPrice - delta : entryPrice + delta;
    }
    if (takeProfitPct != null && takeProfitPct > 0) {
      const delta = entryPrice * (takeProfitPct / 100);
      takeProfitPrice =
        side === "BUY" ? entryPrice + delta : entryPrice - delta;
    }
  }

  return {
    positionSizeUsd,
    orderType,
    limitPrice: entryPrice,
    stopLossPrice,
    takeProfitPrice,
  };
}

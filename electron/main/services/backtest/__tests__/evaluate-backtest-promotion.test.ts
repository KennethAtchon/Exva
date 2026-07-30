import { describe, expect, it } from "vitest";
import {
  backtestTradesToLabels,
  evaluateBacktestPromotion,
} from "../evaluate-backtest-promotion";
import type { ExperienceResearchContract } from "@electron/shared/domain";
import type { BacktestDataQualityReport } from "@electron/shared/domain/backtest-data-quality";

const CONTRACT: ExperienceResearchContract = {
  hypothesis: "test",
  tradableUniverse: ["SPY"],
  instrumentClass: "stock",
  signalTimestamp: "intraday",
  label: { horizon: "1d", outcome: "net_return", benchmark: "SPY" },
  validation: {
    minOutOfSampleTrades: 5,
    minNetExpectancyUsd: 0,
    minLowerBoundSharpe: 0,
    maxDrawdownPct: 0.5,
    requiredFolds: 2,
  },
  costs: { spreadBps: 1, slippageBps: 1, commissionBps: 0 },
};

const COMPLETE_QUALITY: BacktestDataQualityReport = {
  symbol: "SPY",
  timeframe: "1h",
  windowStart: "2024-01-01T00:00:00.000Z",
  windowEnd: "2024-01-02T00:00:00.000Z",
  expectedBars: 24,
  actualBars: 24,
  missingIntervals: [],
  duplicateTimestamps: 0,
  outOfOrderPairs: 0,
  provider: "alpaca",
  feed: "iex",
  windowCovered: true,
  complete: true,
  blockers: [],
};

describe("evaluateBacktestPromotion", () => {
  it("V1 engine cannot promote even with positive edge", () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({
      netReturnBps: 40,
      entryTs: new Date(2024, 0, i + 1).toISOString(),
    }));
    const result = evaluateBacktestPromotion({
      contract: CONTRACT,
      labels: backtestTradesToLabels(trades, CONTRACT),
      dataQuality: [COMPLETE_QUALITY],
      engineVersion: 1,
      seed: 1,
    });
    expect(result.promote).toBe(false);
    expect(result.verdict).toBe("inconclusive");
    expect(result.failedCriteria).toContain("engineV1");
  });

  it("blocks promotion when data quality is incomplete", () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({
      netReturnBps: 40,
      entryTs: new Date(2024, 0, i + 1).toISOString(),
    }));
    const result = evaluateBacktestPromotion({
      contract: CONTRACT,
      labels: backtestTradesToLabels(trades, CONTRACT),
      dataQuality: [{ ...COMPLETE_QUALITY, complete: false, blockers: ["gaps:1"] }],
      engineVersion: 2,
      seed: 2,
    });
    expect(result.promote).toBe(false);
    expect(result.failedCriteria).toContain("dataQualityComplete");
    expect(result.criteria.dataQualityComplete.pass).toBe(false);
  });

  it("completed V2 run with insufficient trades stays inconclusive not pass", () => {
    const trades = [{ netReturnBps: 100, entryTs: "2024-01-01T00:00:00.000Z" }];
    const result = evaluateBacktestPromotion({
      contract: CONTRACT,
      labels: backtestTradesToLabels(trades, CONTRACT),
      dataQuality: [COMPLETE_QUALITY],
      engineVersion: 2,
      seed: 3,
    });
    expect(result.promote).toBe(false);
    expect(result.verdict).toBe("inconclusive");
  });
});

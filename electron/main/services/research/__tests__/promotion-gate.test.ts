import { describe, expect, it } from "vitest";
import { evaluatePromotion } from "../promotion-gate";
import type {
  ExperienceResearchContract,
  SignalLabel,
} from "@electron/shared/domain";

const CONTRACT: ExperienceResearchContract = {
  hypothesis: "test",
  tradableUniverse: ["X"],
  instrumentClass: "stock",
  signalTimestamp: "intraday",
  label: { horizon: "1d", outcome: "net_return", benchmark: "SPY" },
  validation: {
    minOutOfSampleTrades: 20,
    minNetExpectancyUsd: 0,
    minLowerBoundSharpe: 0,
    maxDrawdownPct: 0.5,
    requiredFolds: 2,
  },
  costs: { spreadBps: 1, slippageBps: 1, commissionBps: 0 },
};

function label(netBps: number, i: number): SignalLabel {
  return {
    observationId: `obs-${i}`,
    horizon: "1d",
    benchmark: "SPY",
    grossReturnBps: netBps + 2,
    costBps: 2,
    netReturnBps: netBps,
    benchmarkReturnBps: 0,
    maxFavorableBps: Math.max(0, netBps),
    maxAdverseBps: Math.min(0, netBps),
    outcomeWin: netBps > 0 ? 1 : 0,
    labelReadyAt: new Date(2026, 0, i + 1).toISOString(),
    createdAt: new Date(2026, 0, i + 1).toISOString(),
  };
}

describe("evaluatePromotion", () => {
  it("rejects below minimum out-of-sample sample size", () => {
    const labels = Array.from({ length: 5 }, (_, i) => label(50, i));
    const result = evaluatePromotion(CONTRACT, labels, { seed: 1 });
    expect(result.promote).toBe(false);
    expect(result.failedCriteria).toContain("minOutOfSampleTrades");
  });

  it("rejects a noisy zero-edge series on the lower bound", () => {
    const labels = Array.from({ length: 40 }, (_, i) =>
      label(i % 2 === 0 ? 80 : -80, i),
    );
    const result = evaluatePromotion(CONTRACT, labels, { seed: 7 });
    expect(result.promote).toBe(false);
    // lower bound of expectancy should not clear zero for a coin-flip series
    expect(result.failedCriteria).toContain("lower95NetExpectancy");
  });

  it("promotes a consistently positive series clearing all gates", () => {
    // Tight positive returns -> positive lower CI and positive sharpe lower bound.
    const labels = Array.from({ length: 60 }, (_, i) => label(30 + (i % 3), i));
    const result = evaluatePromotion(CONTRACT, labels, { seed: 3 });
    expect(result.evidence.sampleSize).toBe(60);
    expect(result.evidence.netExpectancyCi.lower).toBeGreaterThan(0);
    expect(result.promote).toBe(true);
  });
});

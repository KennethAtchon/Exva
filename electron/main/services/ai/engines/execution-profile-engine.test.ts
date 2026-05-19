import { describe, expect, it } from "vitest";
import { computeExecutionProfile, priceLevelsFromProfile } from "./execution-profile-engine";
import type { TradeSignal } from "@electron/shared/ai/pipeline-signals";

const baseSignal: TradeSignal = {
  symbol: "NVDA",
  action: "buy",
  executionStrategy: "trend_momentum",
  entryPrice: 100,
  confidence: 0.8,
  reasoning: "test",
};

describe("execution profile engine", () => {
  it("throws for skip signals", () => {
    expect(() =>
      computeExecutionProfile({
        signal: { ...baseSignal, action: "skip" },
        instrumentClass: "stock",
        maxPositionUsd: 1000,
        maxExposureUsd: null,
        risk: { stopLossPct: 2, takeProfitPct: 4, kellyFraction: 0.25 },
      }),
    ).toThrow(/skip/);
  });

  it("sizes with confidence and kelly", () => {
    const profile = computeExecutionProfile({
      signal: baseSignal,
      instrumentClass: "stock",
      maxPositionUsd: 1000,
      maxExposureUsd: null,
      risk: { stopLossPct: 2, takeProfitPct: 4, kellyFraction: 0.5 },
    });

    expect(profile.positionSizeUsd).toBe(400);
    expect(profile.side).toBe("BUY");
    expect(profile.orderType).toBe("limit");
    expect(profile.limitPrice).toBe(100);
    expect(profile.stopLossPct).toBe(2);
  });

  it("halves size when review recommends reduce_size", () => {
    const profile = computeExecutionProfile({
      signal: baseSignal,
      instrumentClass: "stock",
      maxPositionUsd: 1000,
      maxExposureUsd: null,
      risk: { stopLossPct: 2, takeProfitPct: 4, kellyFraction: 0.5 },
      reviewRecommendation: "reduce_size",
    });

    expect(profile.positionSizeUsd).toBe(200);
  });

  it("uses mean_reversion half factor", () => {
    const profile = computeExecutionProfile({
      signal: { ...baseSignal, executionStrategy: "mean_reversion" },
      instrumentClass: "stock",
      maxPositionUsd: 1000,
      maxExposureUsd: null,
      risk: { stopLossPct: 2, takeProfitPct: 4, kellyFraction: 1 },
    });

    expect(profile.positionSizeUsd).toBe(400);
  });

  it("caps prediction market size with kelly", () => {
    const profile = computeExecutionProfile({
      signal: { ...baseSignal, executionStrategy: "prediction_market" },
      instrumentClass: "prediction_market",
      maxPositionUsd: 5000,
      maxExposureUsd: 500,
      risk: { stopLossPct: null, takeProfitPct: null, kellyFraction: 0.2 },
    });

    expect(profile.positionSizeUsd).toBe(80);
  });

  it("computes stop and take profit prices from entry", () => {
    const levels = priceLevelsFromProfile("BUY", 100, { stopLossPct: 2, takeProfitPct: 4 });
    expect(levels.stopLossPrice).toBeCloseTo(98);
    expect(levels.takeProfitPrice).toBeCloseTo(104);
  });
});

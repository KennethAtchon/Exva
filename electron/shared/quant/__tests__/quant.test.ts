import { describe, expect, it } from "vitest";
import {
  bootstrapMeanCI,
  brierScore,
  deflatedSharpe,
  mean,
  purgedWalkForwardFolds,
  reliabilityBuckets,
  sharpeLowerBound,
  sharpeRatio,
  stddev,
} from "../statistics";
import { allocateCapital, kellyFractionBinary } from "../kelly";
import { evaluatePredictionEdge } from "../prediction-edge";
import { costGate, estimateExecutionCost } from "../execution-cost-model";
import { edgeSurvivesCost } from "../../domain/edge-estimate";

describe("statistics", () => {
  it("computes mean and sample stddev", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it("bootstrap CI brackets the point estimate and is reproducible", () => {
    const xs = [0.1, -0.05, 0.2, 0.0, 0.15, -0.1, 0.3, 0.05];
    const a = bootstrapMeanCI(xs, { seed: 42, iterations: 1000 });
    const b = bootstrapMeanCI(xs, { seed: 42, iterations: 1000 });
    expect(a).toEqual(b); // deterministic
    expect(a.lower).toBeLessThanOrEqual(a.point);
    expect(a.upper).toBeGreaterThanOrEqual(a.point);
  });

  it("flags a luck-driven series with a non-positive lower bound", () => {
    // Tiny sample, high variance: point may be positive but lower bound must not be trusted.
    const lucky = [5, -4, 6, -5, 4];
    const ci = bootstrapMeanCI(lucky, { seed: 1, iterations: 2000 });
    expect(ci.lower).toBeLessThanOrEqual(0);
  });

  it("sharpe lower bound is below the point estimate", () => {
    const returns = [0.01, 0.02, -0.01, 0.015, 0.005, 0.02, -0.005, 0.01];
    const { sharpe, lower } = sharpeLowerBound(returns, 0.95);
    expect(sharpe).toBeGreaterThan(0);
    expect(lower).toBeLessThan(sharpe);
  });

  it("deflated sharpe penalizes multiple testing", () => {
    expect(deflatedSharpe(2.0, 1)).toBe(2.0);
    expect(deflatedSharpe(2.0, 100)).toBeLessThan(2.0);
  });

  it("annualizes sharpe when periodsPerYear given", () => {
    const r = [0.01, -0.01, 0.02, 0.0, 0.015];
    const daily = sharpeRatio(r);
    const annual = sharpeRatio(r, { periodsPerYear: 252 });
    expect(Math.abs(annual)).toBeGreaterThan(Math.abs(daily));
  });

  it("brier score: perfect calibration scores 0, worst scores 1", () => {
    expect(
      brierScore([
        { probability: 1, outcome: 1 },
        { probability: 0, outcome: 0 },
      ]),
    ).toBe(0);
    expect(
      brierScore([
        { probability: 1, outcome: 0 },
        { probability: 0, outcome: 1 },
      ]),
    ).toBe(1);
  });

  it("reliability buckets track predicted vs observed", () => {
    const preds = [
      { probability: 0.55, outcome: 1 as const },
      { probability: 0.58, outcome: 0 as const },
      { probability: 0.95, outcome: 1 as const },
    ];
    const buckets = reliabilityBuckets(preds, 10);
    const midBucket = buckets[5]; // [0.5,0.6)
    expect(midBucket?.count).toBe(2);
    expect(midBucket?.observedFrequency).toBe(0.5);
  });

  it("purged folds leave a gap between train and test", () => {
    const folds = purgedWalkForwardFolds(100, 3, 5);
    expect(folds.length).toBe(3);
    for (const f of folds) {
      expect(f.testStart).toBeGreaterThanOrEqual(f.trainEnd + 5);
      expect(f.testEnd).toBeGreaterThan(f.testStart);
    }
  });
});

describe("kelly", () => {
  it("no bet on non-positive edge", () => {
    // Fair coin, even odds: edge zero -> fraction 0.
    expect(kellyFractionBinary(0.5, 1)).toBe(0);
    expect(kellyFractionBinary(0.4, 1)).toBe(0);
  });

  it("positive edge yields positive fraction", () => {
    // 60% win at even odds -> classic Kelly f* = 0.2.
    expect(kellyFractionBinary(0.6, 1)).toBeCloseTo(0.2, 5);
  });

  it("applies fractional kelly and haircuts and caps", () => {
    const r = allocateCapital({
      bankrollUsd: 10_000,
      riskBudgetPct: 0.5,
      rawKellyFraction: 0.2,
      kellyMultiplier: 0.25,
      sampleSize: 50,
      requiredSampleSize: 100,
      correlatedExposurePct: 0.5,
      maxPositionUsd: 1_000_000,
      maxExposureRemainingUsd: 1_000_000,
    });
    // 10000 * (0.2*0.25) * (50/100) * (1-0.5) = 10000*0.05*0.5*0.5 = 125
    expect(r.sizeUsd).toBeCloseTo(125, 5);
    expect(r.uncertaintyHaircut).toBe(0.5);
    expect(r.correlationHaircut).toBe(0.5);
  });

  it("caps to max position", () => {
    const r = allocateCapital({
      bankrollUsd: 1_000_000,
      riskBudgetPct: 1,
      rawKellyFraction: 0.5,
      kellyMultiplier: 0.5,
      sampleSize: 100,
      requiredSampleSize: 100,
      correlatedExposurePct: 0,
      maxPositionUsd: 500,
      maxExposureRemainingUsd: 1_000_000,
    });
    expect(r.sizeUsd).toBe(500);
    expect(r.cappedBy).toBe("max_position");
  });
});

describe("prediction edge", () => {
  const rule = { minNetEdge: 0.02, minCalibrationSampleSize: 30 };

  it("trades YES when p_hat exceeds mid beyond cost", () => {
    const res = evaluatePredictionEdge(
      {
        predictedProbability: 0.7,
        marketMidProbability: 0.5,
        spreadBps: 50,
        feeBps: 0,
        slippageBps: 10,
        sampleSize: 100,
        calibrationBucket: "0.6-0.7",
        modelId: "pm",
        modelVersion: "v1",
      },
      rule,
      "2026-06-22T00:00:00Z",
    );
    expect(res.side).toBe("BUY");
    expect(res.netEdge).toBeGreaterThan(rule.minNetEdge);
    expect(res.rawKellyFraction).toBeGreaterThan(0);
    expect(res.estimate.expectedNetReturnBps).toBeGreaterThan(0);
  });

  it("skips when calibration sample too small", () => {
    const res = evaluatePredictionEdge(
      {
        predictedProbability: 0.7,
        marketMidProbability: 0.5,
        spreadBps: 50,
        feeBps: 0,
        slippageBps: 10,
        sampleSize: 5,
        calibrationBucket: "0.6-0.7",
        modelId: "pm",
        modelVersion: "v1",
      },
      rule,
      "2026-06-22T00:00:00Z",
    );
    expect(res.side).toBe("skip");
  });

  it("skips when edge does not survive cost", () => {
    const res = evaluatePredictionEdge(
      {
        predictedProbability: 0.52,
        marketMidProbability: 0.5,
        spreadBps: 50,
        feeBps: 0,
        slippageBps: 10,
        sampleSize: 100,
        calibrationBucket: "0.5-0.6",
        modelId: "pm",
        modelVersion: "v1",
      },
      rule,
      "2026-06-22T00:00:00Z",
    );
    expect(res.side).toBe("skip");
  });

  it("respects time-to-resolution window", () => {
    const windowed = { ...rule, minHoursToResolution: 24 };
    const res = evaluatePredictionEdge(
      {
        predictedProbability: 0.7,
        marketMidProbability: 0.5,
        spreadBps: 50,
        feeBps: 0,
        slippageBps: 10,
        sampleSize: 100,
        calibrationBucket: "0.6-0.7",
        modelId: "pm",
        modelVersion: "v1",
      },
      windowed,
      "2026-06-22T00:00:00Z",
      2, // only 2h to resolution, below the 24h floor
    );
    expect(res.side).toBe("skip");
  });
});

describe("execution cost model", () => {
  it("prefers observed spread over contract assumption", () => {
    const est = estimateExecutionCost({
      instrumentClass: "stock",
      side: "BUY",
      orderSizeUsd: 1000,
      observedSpreadBps: 8,
      contractSpreadBps: 1,
      contractSlippageBps: 2,
      contractCommissionBps: 0,
    });
    expect(est.expectedSpreadBps).toBe(8);
  });

  it("scales slippage when order exceeds book depth", () => {
    const est = estimateExecutionCost({
      instrumentClass: "crypto",
      side: "BUY",
      orderSizeUsd: 2000,
      contractSpreadBps: 5,
      contractSlippageBps: 10,
      contractCommissionBps: 10,
      orderBookDepthUsd: 1000,
    });
    expect(est.expectedSlippageBps).toBe(20); // 10 * (2000/1000)
    expect(est.minFillProbability).toBeCloseTo(0.5, 5);
  });

  it("gate rejects edges that do not clear cost + margin", () => {
    const est = estimateExecutionCost({
      instrumentClass: "stock",
      side: "BUY",
      orderSizeUsd: 1000,
      contractSpreadBps: 10,
      contractSlippageBps: 10,
      contractCommissionBps: 0,
    });
    const gate = costGate({
      expectedNetReturnBps: 15,
      cost: est,
      safetyMarginBps: 5,
    });
    expect(gate.passes).toBe(false);
    expect(gate.expectedCostBps).toBe(20);
  });

  it("edgeSurvivesCost helper agrees with the hurdle", () => {
    expect(
      edgeSurvivesCost(
        {
          modelId: "m",
          modelVersion: "v",
          asOf: "2026-06-22T00:00:00Z",
          targetHorizon: "1d",
          predictedProbability: null,
          expectedGrossReturnBps: 30,
          expectedCostBps: 20,
          expectedNetReturnBps: 30,
          uncertaintyBps: 5,
          calibrationBucket: null,
          sampleSize: 100,
        },
        5,
      ),
    ).toBe(true);
  });
});

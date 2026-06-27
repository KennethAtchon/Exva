import { describe, expect, it } from "vitest";
import { combineForecasterAndRedTeam } from "../prediction-forecast";
import { evaluatePredictionEdge } from "../prediction-edge";

describe("combineForecasterAndRedTeam", () => {
  it("widens the uncertainty band by the disagreement instead of averaging it away", () => {
    const combined = combineForecasterAndRedTeam(
      { pHat: 0.7, uncertaintyBps: 500 },
      { pHat: 0.5, uncertaintyBps: 500 },
    );
    // disagreement = |0.7 - 0.5| = 0.2 = 2000bps, added on top of the base band.
    expect(combined.disagreementBps).toBeCloseTo(2000, 5);
    expect(combined.uncertaintyBps).toBeCloseTo(2500, 5);
    // equal weight -> midpoint
    expect(combined.pHat).toBeCloseTo(0.6, 5);
  });

  it("never shrinks the band below either input when they agree", () => {
    const combined = combineForecasterAndRedTeam(
      { pHat: 0.6, uncertaintyBps: 800 },
      { pHat: 0.6, uncertaintyBps: 400 },
    );
    expect(combined.disagreementBps).toBe(0);
    expect(combined.uncertaintyBps).toBe(800);
  });

  it("biases toward the red team when weighted", () => {
    const combined = combineForecasterAndRedTeam(
      { pHat: 0.8, uncertaintyBps: 300 },
      { pHat: 0.4, uncertaintyBps: 300 },
      { redTeamWeight: 0.75 },
    );
    // 0.25*0.8 + 0.75*0.4 = 0.5
    expect(combined.pHat).toBeCloseTo(0.5, 5);
  });
});

describe("evaluatePredictionEdge — red-team-aware gating", () => {
  const baseInput = {
    predictedProbability: 0.7,
    marketMidProbability: 0.5,
    spreadBps: 50,
    feeBps: 0,
    slippageBps: 10,
    sampleSize: 100,
    calibrationBucket: "0.6-0.7",
    modelId: "pm",
    modelVersion: "v2",
  };

  it("skips when the widened uncertainty band exceeds the rule", () => {
    const res = evaluatePredictionEdge(
      { ...baseInput, uncertaintyBps: 3000 },
      { minNetEdge: 0.02, minCalibrationSampleSize: 30, maxUncertaintyBps: 1500 },
      "2026-06-26T00:00:00Z",
    );
    expect(res.side).toBe("skip");
    expect(res.skipReason).toMatch(/uncertainty/i);
  });

  it("skips when order-book depth cannot fill the intended size", () => {
    const res = evaluatePredictionEdge(
      { ...baseInput, orderBookDepthUsd: 50, requiredSizeUsd: 500 },
      { minNetEdge: 0.02, minCalibrationSampleSize: 30 },
      "2026-06-26T00:00:00Z",
    );
    expect(res.side).toBe("skip");
    expect(res.skipReason).toMatch(/depth/i);
  });

  it("trades when band is tight and depth is sufficient", () => {
    const res = evaluatePredictionEdge(
      {
        ...baseInput,
        uncertaintyBps: 600,
        orderBookDepthUsd: 5000,
        requiredSizeUsd: 500,
      },
      { minNetEdge: 0.02, minCalibrationSampleSize: 30, maxUncertaintyBps: 1500 },
      "2026-06-26T00:00:00Z",
    );
    expect(res.side).toBe("BUY");
    expect(res.skipReason).toBeUndefined();
    expect(res.estimate.uncertaintyBps).toBe(600);
  });
});

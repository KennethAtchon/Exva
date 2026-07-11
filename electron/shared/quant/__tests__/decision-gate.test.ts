import { describe, expect, it } from "vitest";
import type { EdgeEstimate } from "../../domain/edge-estimate";
import {
  edgeEstimateFromStrength,
  evaluateEdgeDecision,
  type EdgeDecisionRule,
} from "../decision-gate";

const baseEstimate = (overrides: Partial<EdgeEstimate> = {}): EdgeEstimate => ({
  modelId: "test",
  modelVersion: "1",
  asOf: "2026-07-11T12:00:00.000Z",
  targetHorizon: "PT4H",
  predictedProbability: 0.6,
  expectedGrossReturnBps: 200,
  expectedCostBps: 20,
  expectedNetReturnBps: 180,
  uncertaintyBps: 400,
  calibrationBucket: "0.5-0.6",
  sampleSize: 50,
  ...overrides,
});

const rule: EdgeDecisionRule = {
  minNetEdgeBps: 50,
  maxUncertaintyBps: 1000,
  minSampleSize: 10,
  maxKellyFraction: 0.25,
};

describe("evaluateEdgeDecision", () => {
  it("trades when edge, uncertainty, and sample clear the floors", () => {
    const result = evaluateEdgeDecision(
      { estimate: baseEstimate(), calibrationHaircut: 1 },
      rule,
    );
    expect(result.action).toBe("trade");
    expect(result.sizedKellyFraction).toBeGreaterThan(0);
    expect(result.sizedKellyFraction).toBeLessThanOrEqual(0.25);
  });

  it("skips when net edge is below the floor", () => {
    const result = evaluateEdgeDecision(
      { estimate: baseEstimate({ expectedNetReturnBps: 10 }) },
      rule,
    );
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/below floor/i);
    expect(result.sizedKellyFraction).toBe(0);
  });

  it("skips when uncertainty exceeds the max", () => {
    const result = evaluateEdgeDecision(
      { estimate: baseEstimate({ uncertaintyBps: 2000 }) },
      rule,
    );
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/uncertainty/i);
  });

  it("skips when sample size is too small", () => {
    const result = evaluateEdgeDecision(
      { estimate: baseEstimate({ sampleSize: 2 }) },
      rule,
    );
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/sample/i);
  });

  it("skips when order-book depth cannot fill required size", () => {
    const result = evaluateEdgeDecision(
      {
        estimate: baseEstimate(),
        orderBookDepthUsd: 100,
        requiredSizeUsd: 500,
      },
      rule,
    );
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/order-book depth/i);
  });

  it("applies calibration haircut and Kelly cap", () => {
    const result = evaluateEdgeDecision(
      {
        estimate: baseEstimate(),
        rawKellyFraction: 0.5,
        calibrationHaircut: 0.5,
      },
      rule,
    );
    expect(result.action).toBe("trade");
    // 0.5 * 0.5 = 0.25, then capped at maxKellyFraction 0.25
    expect(result.sizedKellyFraction).toBe(0.25);
  });
});

describe("edgeEstimateFromStrength", () => {
  it("builds a wide-uncertainty estimate from strength", () => {
    const estimate = edgeEstimateFromStrength({
      modelId: "mean-rev",
      modelVersion: "1",
      asOf: "2026-07-11T12:00:00.000Z",
      targetHorizon: "PT1H",
      strength: 2.5,
      expectedGrossReturnBps: 150,
      expectedCostBps: 25,
      sampleSize: 25,
    });
    expect(estimate.expectedNetReturnBps).toBe(125);
    expect(estimate.uncertaintyBps).toBeGreaterThan(0);
    expect(estimate.uncertaintyBps).toBeLessThanOrEqual(5000);
  });
});

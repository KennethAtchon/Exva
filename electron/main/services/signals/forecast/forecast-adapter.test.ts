import { describe, expect, it } from "vitest";
import { CalibrationService } from "./calibration-service";
import { forecastFromStrength } from "./forecast-adapter";

describe("forecastFromStrength", () => {
  it("uses an identity-ish prior with wide uncertainty when uncalibrated", () => {
    const estimate = forecastFromStrength({
      strategyId: "mean-reversion",
      strength: 0.75,
      modelVersion: "rules-1",
      asOf: "2026-07-11T12:00:00.000Z",
    });

    expect(estimate.modelId).toBe("rules:mean-reversion");
    expect(estimate.predictedProbability).toBe(0.75);
    expect(estimate.expectedGrossReturnBps).toBe(75);
    expect(estimate.expectedNetReturnBps).toBe(69);
    expect(estimate.uncertaintyBps).toBe(5000);
    expect(estimate.sampleSize).toBe(0);
    expect(estimate.calibrationBucket).toBeNull();
  });

  it("substitutes empirical win rate when calibration buckets have samples", () => {
    const calibration = new CalibrationService();
    calibration.refresh(
      "rules:breakout",
      "v2",
      Array.from({ length: 20 }, (_, i) => ({
        predictedProbability: 0.65,
        outcomeWin: i < 14, // 70% win rate in 0.6-0.7 bucket
      })),
      "2026-07-11T12:00:00.000Z",
    );

    const estimate = forecastFromStrength({
      strategyId: "breakout",
      strength: 0.65,
      modelVersion: "v2",
      calibration,
      asOf: "2026-07-11T12:00:00.000Z",
    });

    expect(estimate.predictedProbability).toBe(0.7);
    expect(estimate.sampleSize).toBe(20);
    expect(estimate.calibrationBucket).toBe("0.6-0.7");
    expect(estimate.uncertaintyBps).toBeLessThan(5000);
  });

  it("clamps out-of-range strength", () => {
    const estimate = forecastFromStrength({
      strategyId: "trend-following",
      strength: 1.5,
      modelVersion: "rules-1",
    });
    expect(estimate.predictedProbability).toBe(1);
  });
});

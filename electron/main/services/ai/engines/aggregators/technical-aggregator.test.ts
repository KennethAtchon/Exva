import { describe, expect, it } from "vitest";
import { aggregateTechnicalSignal } from "./technical-aggregator";

describe("technical aggregator", () => {
  it("uses momentum worker fields for trend and strength", () => {
    const signal = aggregateTechnicalSignal("NVDA", {
      momentum: {
        trendDirection: "bullish",
        trendStrength: 0.8,
        momentumScore: 0.7,
        rawSummary: "Strong uptrend",
      },
    });

    expect(signal.symbol).toBe("NVDA");
    expect(signal.trendDirection).toBe("bullish");
    expect(signal.trendStrength).toBe(0.8);
    expect(signal.momentumScore).toBe(0.7);
  });

  it("uses chart pattern fields", () => {
    const signal = aggregateTechnicalSignal("PLTR", {
      chartPattern: {
        patternName: "bull flag",
        patternStrength: 0.9,
        nearestSupport: 21.5,
        nearestResistance: 25.0,
        rawSummary: "Clean flag",
      },
    });

    expect(signal.patternName).toBe("bull flag");
    expect(signal.patternStrength).toBe(0.9);
    expect(signal.nearestSupport).toBe(21.5);
    expect(signal.nearestResistance).toBe(25.0);
  });

  it("uses volume fields", () => {
    const signal = aggregateTechnicalSignal("AMD", {
      volume: {
        volumeScore: 0.85,
        volumeSignal: "accumulation",
        rawSummary: "Volume surge",
      },
    });

    expect(signal.volumeScore).toBe(0.85);
    expect(signal.volumeSignal).toBe("accumulation");
  });

  it("computes timeframeAlignment=1 when bullish trend aligns with accumulation", () => {
    const signal = aggregateTechnicalSignal("TSLA", {
      momentum: {
        trendDirection: "bullish",
        trendStrength: 0.7,
        momentumScore: 0.6,
        rawSummary: "",
      },
      volume: {
        volumeScore: 0.6,
        volumeSignal: "accumulation",
        rawSummary: "",
      },
    });

    expect(signal.timeframeAlignment).toBe(1);
  });

  it("computes timeframeAlignment=0 when bullish trend conflicts with distribution", () => {
    const signal = aggregateTechnicalSignal("SPY", {
      momentum: {
        trendDirection: "bullish",
        trendStrength: 0.5,
        momentumScore: 0.5,
        rawSummary: "",
      },
      volume: {
        volumeScore: 0.7,
        volumeSignal: "distribution",
        rawSummary: "",
      },
    });

    expect(signal.timeframeAlignment).toBe(0);
  });

  it("defaults to neutral trend and null scores when all workers absent", () => {
    const signal = aggregateTechnicalSignal("UNKNOWN", {});

    expect(signal.trendDirection).toBe("neutral");
    expect(signal.trendStrength).toBe(0);
    expect(signal.momentumScore).toBeNull();
    expect(signal.volumeScore).toBeNull();
    expect(signal.patternName).toBeNull();
    expect(signal.timeframeAlignment).toBeNull();
  });

  it("includes worker summaries in rawSummary", () => {
    const signal = aggregateTechnicalSignal("NVDA", {
      momentum: {
        trendDirection: "bullish",
        trendStrength: 0.9,
        momentumScore: 0.8,
        rawSummary: "RSI 65",
      },
      volume: {
        volumeScore: 0.7,
        volumeSignal: "accumulation",
        rawSummary: "3x avg volume",
      },
    });

    expect(signal.rawSummary).toContain("RSI 65");
    expect(signal.rawSummary).toContain("3x avg volume");
  });
});

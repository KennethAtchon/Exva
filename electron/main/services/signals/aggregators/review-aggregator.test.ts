import { describe, expect, it } from "vitest";
import { aggregateReviewSignal } from "./review-aggregator";

describe("review aggregator", () => {
  it("returns skip when both workers are absent", () => {
    const signal = aggregateReviewSignal("AAPL", {});

    expect(signal.recommendation).toBe("skip");
    expect(signal.overallRisk).toBeNull();
    expect(signal.technicalFundamentalConflict).toBeNull();
    expect(signal.rawSummary).toBe("");
  });

  it("returns proceed when conflict is low and risk is not high", () => {
    const signal = aggregateReviewSignal("NVDA", {
      conflictDetector: {
        technicalFundamentalConflict: 0.2,
        conflictExplanation: "Minimal disagreement",
        rawSummary: "Minor gap",
      },
      riskAssessor: {
        tailRisks: ["macro"],
        overallRisk: "low",
        rawSummary: "Manageable",
      },
    });

    expect(signal.recommendation).toBe("proceed");
    expect(signal.symbol).toBe("NVDA");
    expect(signal.tailRisks).toEqual(["macro"]);
  });

  it("returns skip when only risk is high", () => {
    const signal = aggregateReviewSignal("TSLA", {
      conflictDetector: {
        technicalFundamentalConflict: 0.3,
        conflictExplanation: null,
        rawSummary: "",
      },
      riskAssessor: {
        tailRisks: ["earnings miss", "margin compression"],
        overallRisk: "high",
        rawSummary: "High tail exposure",
      },
    });

    expect(signal.recommendation).toBe("skip");
    expect(signal.overallRisk).toBe("high");
  });

  it("returns skip when conflict is above 0.7", () => {
    const signal = aggregateReviewSignal("AMD", {
      conflictDetector: {
        technicalFundamentalConflict: 0.75,
        conflictExplanation: "Trend bullish but fundamentals weak",
        rawSummary: "Cross-signal conflict",
      },
      riskAssessor: {
        tailRisks: [],
        overallRisk: "medium",
        rawSummary: "Moderate risk",
      },
    });

    expect(signal.recommendation).toBe("skip");
    expect(signal.technicalFundamentalConflict).toBe(0.75);
  });

  it("returns skip when conflict is high AND risk is high", () => {
    const signal = aggregateReviewSignal("PLTR", {
      conflictDetector: {
        technicalFundamentalConflict: 0.8,
        conflictExplanation: "Bearish trend vs bullish news catalyst",
        rawSummary: "Strong conflict",
      },
      riskAssessor: {
        tailRisks: ["dilution", "contract loss"],
        overallRisk: "high",
        rawSummary: "Severe risk",
      },
    });

    expect(signal.recommendation).toBe("skip");
  });

  it("includes worker summaries in rawSummary", () => {
    const signal = aggregateReviewSignal("XYZ", {
      conflictDetector: {
        technicalFundamentalConflict: 0.4,
        conflictExplanation: null,
        rawSummary: "Slight disagreement",
      },
      riskAssessor: {
        tailRisks: ["regulatory"],
        overallRisk: "medium",
        rawSummary: "Watch regulatory news",
      },
    });

    expect(signal.rawSummary).toContain("Slight disagreement");
    expect(signal.rawSummary).toContain("Watch regulatory news");
  });

  it("passes conflictExplanation through", () => {
    const signal = aggregateReviewSignal("META", {
      conflictDetector: {
        technicalFundamentalConflict: 0.5,
        conflictExplanation: "RSI overbought vs positive earnings",
        rawSummary: "",
      },
    });

    expect(signal.conflictExplanation).toBe(
      "RSI overbought vs positive earnings",
    );
    expect(signal.recommendation).toBe("reduce_size");
  });
});

import { describe, expect, it } from "vitest";
import { aggregateTradeSignal } from "./trade-signal-aggregator";

const reviewProceed = {
  symbol: "NVDA",
  technicalFundamentalConflict: 0.1,
  conflictExplanation: null,
  tailRisks: [],
  overallRisk: "low" as const,
  recommendation: "proceed" as const,
  rawSummary: "",
};

describe("trade signal aggregator", () => {
  it("forces skip when review recommends skip", () => {
    const signal = aggregateTradeSignal(
      "NVDA",
      { ...reviewProceed, recommendation: "skip" },
      {
        executionStrategy: "trend_momentum",
        action: "buy",
        confidence: 0.9,
        reasoning: "Strong trend",
      },
      { entryTiming: "now", entryPrice: null, rawSummary: "" },
    );

    expect(signal.action).toBe("skip");
  });

  it("uses timer skip over classifier buy", () => {
    const signal = aggregateTradeSignal(
      "NVDA",
      reviewProceed,
      {
        executionStrategy: "trend_momentum",
        action: "buy",
        confidence: 0.8,
        reasoning: "Momentum",
      },
      {
        entryTiming: "skip",
        entryPrice: null,
        rawSummary: "Wait for pullback",
      },
    );

    expect(signal.action).toBe("skip");
  });

  it("uses timer wait over classifier buy", () => {
    const signal = aggregateTradeSignal(
      "NVDA",
      reviewProceed,
      {
        executionStrategy: "trend_momentum",
        action: "buy",
        confidence: 0.8,
        reasoning: "Momentum",
      },
      {
        entryTiming: "wait",
        entryPrice: 118.25,
        rawSummary: "Wait for pullback",
      },
    );

    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("Timing: wait");
  });

  it("merges classifier and timer for a buy", () => {
    const signal = aggregateTradeSignal(
      "NVDA",
      reviewProceed,
      {
        executionStrategy: "breakout",
        action: "buy",
        confidence: 0.85,
        reasoning: "Breakout setup",
      },
      { entryTiming: "now", entryPrice: 120.5, rawSummary: "Enter now" },
    );

    expect(signal.action).toBe("buy");
    expect(signal.executionStrategy).toBe("breakout");
    expect(signal.entryPrice).toBe(120.5);
    expect(signal.reasoning).toContain("Timing: now");
  });

  it("maps timer wait to buy when mock relaxed entry timing is enabled", () => {
    const signal = aggregateTradeSignal(
      "NVDA",
      reviewProceed,
      {
        executionStrategy: "breakout",
        action: "buy",
        confidence: 0.85,
        reasoning: "Breakout setup",
      },
      { entryTiming: "wait", entryPrice: 118.25, rawSummary: "Wait for pullback" },
      { mockRelaxedEntryTiming: true },
    );

    expect(signal.action).toBe("buy");
    expect(signal.reasoning).toContain("Timing: now");
  });

  it("forces skip when confidence is below wait-for-open threshold", () => {
    const signal = aggregateTradeSignal(
      "NVDA",
      reviewProceed,
      {
        executionStrategy: "breakout",
        action: "buy",
        confidence: 0.65,
        reasoning: "Moderate setup",
      },
      { entryTiming: "now", entryPrice: null, rawSummary: "Enter now" },
      { waitForOpenThreshold: 0.8 },
    );

    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("wait-for-open threshold");
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateAdversarialReview,
  aggregateCatalystTradeSignal,
} from "./catalyst-two-call-aggregator";

const analystBuy = {
  executionStrategy: "event_driven" as const,
  action: "buy" as const,
  confidence: 0.82,
  entryTiming: "now" as const,
  catalystStrength: 0.7,
  priceReactionScore: 0.6,
  reasoning: "Strong 8-K catalyst.",
};

describe("catalyst-two-call-aggregator", () => {
  it("maps adversarial reviewer output into a review signal", () => {
    const review = aggregateAdversarialReview("NVDA", {
      recommendation: "reduce_size",
      contradictionRisk: 0.35,
      overallRisk: "medium",
      reasoning: "Guidance is vague but directionally consistent.",
    });

    expect(review).toMatchObject({
      symbol: "NVDA",
      recommendation: "reduce_size",
      overallRisk: "medium",
      rawSummary: expect.stringContaining("Guidance is vague"),
    });
  });

  it("skips when adversarial review rejects the catalyst", () => {
    const review = aggregateAdversarialReview("NVDA", {
      recommendation: "skip",
      contradictionRisk: 0.9,
      overallRisk: "high",
      reasoning: "Material weakness in filing language.",
    });

    const trade = aggregateCatalystTradeSignal("NVDA", analystBuy, review);

    expect(trade.action).toBe("skip");
    expect(trade.executionStrategy).toBe("event_driven");
    expect(trade.reasoning).toContain("Adversarial review skipped");
  });

  it("applies wait-for-open threshold before emitting a buy", () => {
    const review = aggregateAdversarialReview("NVDA", {
      recommendation: "proceed",
      contradictionRisk: 0.1,
      overallRisk: "low",
      reasoning: "Filing supports the trade.",
    });

    const trade = aggregateCatalystTradeSignal(
      "NVDA",
      { ...analystBuy, confidence: 0.55 },
      review,
      { waitForOpenThreshold: 0.7 },
    );

    expect(trade.action).toBe("skip");
    expect(trade.reasoning).toContain("below wait-for-open threshold");
  });

  it("preserves analyst buy when review proceeds and confidence clears threshold", () => {
    const review = aggregateAdversarialReview("NVDA", {
      recommendation: "proceed",
      contradictionRisk: 0.1,
      overallRisk: "low",
      reasoning: "Filing supports the trade.",
    });

    const trade = aggregateCatalystTradeSignal("NVDA", analystBuy, review, {
      waitForOpenThreshold: 0.7,
    });

    expect(trade.action).toBe("buy");
    expect(trade.executionStrategy).toBe("event_driven");
    expect(trade.reasoning).toContain("Strong 8-K catalyst.");
  });
});

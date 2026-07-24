import { describe, expect, it } from "vitest";
import { buildPredictionMarketCandidateBlock } from "../prediction-market-candidates";

describe("prediction-market-candidates input engine", () => {
  it("limits compact candidates and directs workers to list omitted markets", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      symbol: `pm:condition-${index}`,
      instrumentClass: "prediction_market" as const,
      instrumentDisplayName: `Will event ${index} happen?`,
      predictionOutcome: index % 2 === 0 ? ("YES" as const) : ("NO" as const),
      instrumentMetadataJson: JSON.stringify({
        marketMid: 0.55,
        liquidity: 10_000,
        ignored: "x".repeat(10_000),
      }),
    }));

    const block = buildPredictionMarketCandidateBlock(candidates);

    expect(block.length).toBeLessThanOrEqual(6_000);
    expect(block.match(/^- \{/gm)).toHaveLength(12);
    expect(block).toContain(
      "...8 more markets omitted (use list_markets for the full set)",
    );
    expect(block).toContain('"question":"Will event 0 happen?"');
    expect(block).not.toContain("ignored");
  });
});

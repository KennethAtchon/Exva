import { describe, expect, it } from "vitest";
import { SelectorRiskFilter } from "./selector-risk-filter";
import type { SelectorCandidate } from "./selector-candidate-merger";
import { selectorEvidenceSchema } from "@electron/shared/ai/selector-candidate";

const baseStrategyContext = {
  identity: { name: "Test", objective: "Breakout" },
  researchPosture: { discoveryMode: "balanced" as const },
  rules: { sideBias: "long_only" as const },
  timeframe: { holdingStyle: "multi_day_swing" as const },
  riskConfig: { maxConcurrentTrades: 3 },
  presetBehavior: {},
} as never;

function quoteTrace(symbol: string, price = 120) {
  return [
    {
      step: 1,
      toolCalls: [
        {
          step: 1,
          tool: "get_quote",
          argsJson: JSON.stringify({ symbol }),
          resultJson: JSON.stringify({
            instrumentSymbol: symbol,
            price,
            volume: 1_000_000,
            timestamp: new Date().toISOString(),
          }),
          latencyMs: 10,
        },
        {
          step: 1,
          tool: "search_web",
          argsJson: JSON.stringify({ query: `${symbol} breakout` }),
          resultJson: JSON.stringify([
            {
              title: `${symbol} breaks out above resistance`,
              snippet: `${symbol} cleared prior resistance with volume.`,
            },
          ]),
          latencyMs: 12,
        },
      ],
    },
  ];
}

function candidate(
  overrides: Partial<SelectorCandidate> = {},
): SelectorCandidate {
  return {
    symbol: "NVDA",
    instrumentClass: "stock",
    instrumentDisplayName: "NVIDIA",
    predictionOutcome: null,
    instrumentMetadataJson: null,
    rationale: "Strong breakout momentum with volume confirmation.",
    catalystSummary: null,
    hypeScore: 0.8,
    volumeScore: 0.7,
    liquidityScore: 0.6,
    catalystScore: 0.75,
    finalScore: 0.72,
    source: ["web-scout"],
    riskFlags: [],
    selectorEvidence: null,
    selectorTraces: quoteTrace("NVDA"),
    ...overrides,
  };
}

describe("SelectorRiskFilter", () => {
  it("accepts candidate with rationale, quote trace, and symbol-specific search evidence", () => {
    const withEvidence = {
      ...candidate(),
      selectorEvidence: selectorEvidenceSchema.parse({
        summary: "Strong breakout momentum with volume confirmation.",
        thesisDirection: "long",
        sourceWorkers: ["web-scout"],
        riskFlags: [],
        hasQuoteEvidence: true,
        hasSearchEvidence: true,
        hasNewsEvidence: false,
        hasOhlcvEvidence: false,
        hasFetchEvidence: false,
      }),
    };

    const result = new SelectorRiskFilter({
      sessionId: "session-1",
      instrumentClasses: ["stock"],
      strategyContext: baseStrategyContext,
    }).evaluate([withEvidence]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("does not reject candidates solely because selectorEvidence was null before finalize", () => {
    const withoutEvidence = candidate({
      selectorEvidence: null,
    });

    const result = new SelectorRiskFilter({
      sessionId: "session-1",
      instrumentClasses: ["stock"],
      strategyContext: baseStrategyContext,
    }).evaluate([withoutEvidence]);

    expect(result.rejected.map((row) => row.reasons)).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["Selector rationale is empty"]),
      ]),
    );
  });

  it("rejects candidate with empty rationale even when traces exist", () => {
    const result = new SelectorRiskFilter({
      sessionId: "session-1",
      instrumentClasses: ["stock"],
      strategyContext: baseStrategyContext,
    }).evaluate([
      candidate({
        rationale: "   ",
        selectorEvidence: selectorEvidenceSchema.parse({
          summary: "   ",
          thesisDirection: "neutral",
          sourceWorkers: [],
          riskFlags: [],
          hasQuoteEvidence: true,
          hasSearchEvidence: true,
          hasNewsEvidence: false,
          hasOhlcvEvidence: false,
          hasFetchEvidence: false,
        }),
      }),
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reasons).toContain(
      "Selector rationale is empty",
    );
  });
});

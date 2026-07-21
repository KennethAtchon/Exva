import { describe, expect, it } from "vitest";
import { buildInstrumentSelection } from "./selector-submission-builder";
import type { Candidate } from "@electron/shared/ai/selector-candidate";

function candidate(
  symbol: string,
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    symbol,
    instrumentClass: "stock",
    instrumentDisplayName: `${symbol} Inc`,
    predictionOutcome: null,
    instrumentMetadataJson: null,
    source: [],
    hypeScore: null,
    volumeScore: null,
    catalystScore: null,
    liquidityScore: null,
    catalystSummary: `Catalyst for ${symbol}`,
    riskFlags: [],
    finalScore: null,
    rationale: `Why ${symbol}`,
    selectorEvidence: null,
    ...overrides,
  };
}

describe("selector submission builder", () => {
  it("builds a bounded instrument selection", () => {
    const selection = buildInstrumentSelection(
      [candidate("NVDA"), candidate("PLTR"), candidate("AMD")],
      2,
    );
    expect(selection.instruments).toHaveLength(2);
    expect(selection.instruments[0]?.symbol).toBe("NVDA");
    expect(selection.instruments[1]?.symbol).toBe("PLTR");
  });

  it("preserves prediction outcome and executable metadata with catalyst", () => {
    const conditionId = `0x${"cd".repeat(32)}`;
    const selection = buildInstrumentSelection(
      [
        candidate(`pm:${conditionId}`, {
          instrumentClass: "prediction_market",
          predictionOutcome: "NO",
          instrumentMetadataJson: JSON.stringify({
            conditionId,
            outcomeTokenId: "no-token",
            yesOutcomeTokenId: "yes-token",
            noOutcomeTokenId: "no-token",
          }),
          catalystSummary: "Fed decision catalyst",
        }),
      ],
      1,
    );

    expect(selection.instruments[0]).toMatchObject({
      predictionOutcome: "NO",
    });
    expect(
      JSON.parse(selection.instruments[0]?.instrumentMetadataJson ?? "{}"),
    ).toMatchObject({
      conditionId,
      outcomeTokenId: "no-token",
      catalyst: "Fed decision catalyst",
    });
  });

  it("does not throw on empty candidate list", () => {
    expect(buildInstrumentSelection([], 3)).toEqual({ instruments: [] });
  });
});

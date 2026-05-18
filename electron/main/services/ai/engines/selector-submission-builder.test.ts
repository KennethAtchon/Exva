import { describe, expect, it } from "vitest";
import { buildInstrumentSelection } from "./selector-submission-builder";
import type { Candidate } from "@electron/shared/ai/selector-pipeline-candidate";

function candidate(symbol: string): Candidate {
  return {
    symbol,
    instrumentClass: "stock",
    instrumentDisplayName: `${symbol} Inc`,
    source: [],
    hypeScore: null,
    volumeScore: null,
    catalystScore: null,
    liquidityScore: null,
    catalystSummary: `Catalyst for ${symbol}`,
    riskFlags: [],
    finalScore: null,
    rationale: `Why ${symbol}`,
  };
}

describe("selector submission builder", () => {
  it("builds a bounded instrument selection", () => {
    const selection = buildInstrumentSelection([candidate("NVDA"), candidate("PLTR"), candidate("AMD")], 2);
    expect(selection.instruments).toHaveLength(2);
    expect(selection.instruments[0]?.symbol).toBe("NVDA");
    expect(selection.instruments[1]?.symbol).toBe("PLTR");
  });

  it("does not throw on empty candidate list", () => {
    expect(buildInstrumentSelection([], 3)).toEqual({ instruments: [] });
  });
});

import { describe, expect, it } from "vitest";
import { scoreCandidate, scoreCandidates } from "./selector-scoring-engine";
import type { Candidate } from "@electron/shared/ai/selector-pipeline-candidate";

function baseCandidate(symbol: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    symbol,
    instrumentClass: "stock",
    instrumentDisplayName: null,
    source: [],
    hypeScore: null,
    volumeScore: null,
    catalystScore: null,
    liquidityScore: null,
    catalystSummary: null,
    riskFlags: [],
    finalScore: null,
    rationale: null,
    ...overrides,
  };
}

describe("selector scoring engine", () => {
  it("scores deterministically from weighted inputs", () => {
    const candidate = baseCandidate("NVDA", {
      hypeScore: 0.2,
      volumeScore: 0.8,
      catalystScore: 0.6,
      liquidityScore: 1,
    });

    expect(scoreCandidate(candidate, { hype: 0.2, volume: 0.3, catalyst: 0.35, liquidity: 0.15 })).toBeCloseTo(0.64, 5);
  });

  it("sorts highest score first", () => {
    const candidates = scoreCandidates([
      baseCandidate("A", { volumeScore: 0.1, catalystScore: 0.1 }),
      baseCandidate("B", { volumeScore: 0.9, catalystScore: 0.8, liquidityScore: 0.7 }),
      baseCandidate("C", { hypeScore: 0.5 }),
    ]);

    expect(candidates.map((candidate) => candidate.symbol)).toEqual(["B", "C", "A"]);
  });
});

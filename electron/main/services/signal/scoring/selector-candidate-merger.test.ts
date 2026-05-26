import { describe, expect, it } from "vitest";
import {
  mergeDiscoveryCandidates,
  type SelectorCandidate,
} from "./selector-candidate-merger";

function candidate(
  symbol: string,
  overrides: Partial<SelectorCandidate> = {},
): SelectorCandidate {
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
    selectorEvidence: null,
    selectorTraces: [],
    ...overrides,
  };
}

describe("selector candidate merger", () => {
  it("dedupes by instrumentClass:symbol key and max-merges scores", () => {
    const merged = mergeDiscoveryCandidates([
      [
        candidate("NVDA", {
          hypeScore: 0.3,
          volumeScore: 0.6,
          source: ["web-scout"],
        }),
      ],
      [
        candidate("NVDA", {
          hypeScore: 0.7,
          catalystScore: 0.5,
          source: ["trend-scout"],
        }),
      ],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.symbol).toBe("NVDA");
    expect(merged[0]?.hypeScore).toBe(0.7);
    expect(merged[0]?.volumeScore).toBe(0.6);
    expect(merged[0]?.catalystScore).toBe(0.5);
    expect(merged[0]?.source).toEqual(
      expect.arrayContaining(["web-scout", "trend-scout"]),
    );
  });

  it("treats different instrument classes as separate candidates", () => {
    const merged = mergeDiscoveryCandidates([
      [candidate("BTC", { instrumentClass: "crypto" })],
      [candidate("BTC", { instrumentClass: "stock" })],
    ]);

    expect(merged).toHaveLength(2);
  });

  it("keeps first non-null display name and rationale", () => {
    const merged = mergeDiscoveryCandidates([
      [candidate("PLTR", { instrumentDisplayName: null, rationale: null })],
      [
        candidate("PLTR", {
          instrumentDisplayName: "Palantir",
          rationale: "Strong AI revenue",
        }),
      ],
    ]);

    expect(merged[0]?.instrumentDisplayName).toBe("Palantir");
    expect(merged[0]?.rationale).toBe("Strong AI revenue");
  });

  it("unions risk flags without duplicates", () => {
    const merged = mergeDiscoveryCandidates([
      [candidate("AMD", { riskFlags: ["low_liquidity", "sector_risk"] })],
      [candidate("AMD", { riskFlags: ["sector_risk", "high_spread"] })],
    ]);

    expect(merged[0]?.riskFlags).toHaveLength(3);
    expect(merged[0]?.riskFlags).toEqual(
      expect.arrayContaining(["low_liquidity", "sector_risk", "high_spread"]),
    );
  });

  it("returns empty list for empty input", () => {
    expect(mergeDiscoveryCandidates([])).toEqual([]);
    expect(mergeDiscoveryCandidates([[]])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { aggregateFundamentalSignal } from "./fundamental-aggregator";

describe("fundamental aggregator", () => {
  it("passes earnings and sentiment scores directly", () => {
    const signal = aggregateFundamentalSignal("NVDA", {
      earnings: { earningsScore: 0.9, rawSummary: "Strong beat" },
      sentiment: { sentimentScore: 0.75, rawSummary: "Bullish Reddit" },
    });

    expect(signal.symbol).toBe("NVDA");
    expect(signal.earningsScore).toBe(0.9);
    expect(signal.sentimentScore).toBe(0.75);
  });

  it("derives catalystScore as strength * freshness * (1 - contradictionRisk)", () => {
    const signal = aggregateFundamentalSignal("PLTR", {
      catalyst: {
        catalystType: "contract",
        catalystStrength: 0.8,
        catalystFreshness: 0.9,
        contradictionRisk: 0.2,
        catalystSummary: "New DoD contract",
        rawSummary: "Contract announced",
      },
    });

    expect(signal.catalystType).toBe("contract");
    expect(signal.catalystSummary).toBe("New DoD contract");
    // 0.8 * 0.9 * (1 - 0.2) = 0.576
    expect(signal.catalystScore).toBeCloseTo(0.576, 5);
    expect(signal.contradictionRisk).toBe(0.2);
  });

  it("returns null catalystScore when strength or freshness is absent", () => {
    const signal = aggregateFundamentalSignal("AMD", {
      catalyst: { catalystType: null, catalystStrength: null, catalystFreshness: null, contradictionRisk: 0, catalystSummary: null, rawSummary: "" },
    });

    expect(signal.catalystScore).toBeNull();
  });

  it("defaults all scores to null and contradictionRisk to 0 when workers absent", () => {
    const signal = aggregateFundamentalSignal("XYZ", {});

    expect(signal.earningsScore).toBeNull();
    expect(signal.sentimentScore).toBeNull();
    expect(signal.catalystScore).toBeNull();
    expect(signal.catalystType).toBeNull();
    expect(signal.contradictionRisk).toBe(0);
    expect(signal.rawSummary).toBe("");
  });

  it("includes worker summaries in rawSummary", () => {
    const signal = aggregateFundamentalSignal("TSLA", {
      catalyst: { catalystType: "macro", catalystStrength: 0.5, catalystFreshness: 0.6, contradictionRisk: 0.1, catalystSummary: null, rawSummary: "Rate cut expectations" },
      sentiment: { sentimentScore: 0.6, rawSummary: "Positive Reddit thread" },
    });

    expect(signal.rawSummary).toContain("Rate cut expectations");
    expect(signal.rawSummary).toContain("Positive Reddit thread");
  });
});

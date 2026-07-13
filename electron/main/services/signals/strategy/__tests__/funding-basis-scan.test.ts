/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import {
  detectFundingDislocations,
  fundingHitToMarketSignal,
  percentileRank,
} from "../funding-basis-scan";

describe("funding basis scan", () => {
  it("computes percentile rank", () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(0.4);
  });

  it("emits on extreme funding percentile", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      venue: "kraken",
      symbol: "BTC/USD",
      ts: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      rate: 0.0001 * (i + 1),
    }));
    const latest = {
      venue: "kraken",
      symbol: "BTC/USD",
      ts: "2026-02-01T00:00:00.000Z",
      rate: 0.01,
      basisBps: 40,
    };
    const hit = detectFundingDislocations(history, latest, {
      windowSize: 50,
      extremePercentile: 0.9,
    });
    expect(hit).not.toBeNull();
    const signal = fundingHitToMarketSignal(hit!);
    expect(signal.kind).toBe("market_dislocation");
    if (signal.kind !== "market_dislocation") throw new Error("unreachable");
    expect(signal.payload.fundingPercentile).toBe(hit!.percentile);
    expect(signal.instrumentClass).toBe("crypto");
  });
});

import { describe, expect, it } from "vitest";
import { computeMeanReversionSignal } from "./mean-reversion-signal";

function flatCloses(value: number, count: number) {
  return Array.from({ length: count }, () => ({ close: value }));
}

describe("computeMeanReversionSignal", () => {
  it("skips when there are fewer than 20 bars", () => {
    const signal = computeMeanReversionSignal({
      symbol: "SPY",
      ohlcv: flatCloses(100, 10),
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("skip");
    expect(signal.executionStrategy).toBe("mean_reversion");
    expect(signal.reasoning).toContain("Insufficient bars");
  });

  it("buys when z-score is below the entry threshold", () => {
    const ohlcv = [...flatCloses(100, 19), { close: 70 }];
    const signal = computeMeanReversionSignal({
      symbol: "QQQ",
      ohlcv,
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("buy");
    expect(signal.confidence).toBeGreaterThan(0.5);
    expect(signal.reasoning).toContain("mean-reversion buy");
  });

  it("skips when price is not extended enough", () => {
    const signal = computeMeanReversionSignal({
      symbol: "SPY",
      ohlcv: flatCloses(100, 20),
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("not extended enough");
  });
});

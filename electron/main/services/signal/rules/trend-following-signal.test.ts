import { describe, expect, it } from "vitest";
import { computeTrendFollowingSignal } from "./trend-following-signal";

describe("computeTrendFollowingSignal", () => {
  it("skips when there are insufficient bars", () => {
    const signal = computeTrendFollowingSignal({
      symbol: "GC",
      ohlcv: [{ close: 2000 }],
      lookback: 20,
    });

    expect(signal.action).toBe("skip");
    expect(signal.executionStrategy).toBe("trend_momentum");
  });

  it("buys on a bullish SMA crossover", () => {
    const signal = computeTrendFollowingSignal({
      symbol: "CL",
      ohlcv: [
        { close: 100 },
        { close: 100 },
        { close: 100 },
        { close: 100 },
        { close: 99 },
        { close: 102 },
      ],
      lookback: 3,
    });

    expect(signal.action).toBe("buy");
    expect(signal.reasoning).toContain("crossed above");
  });

  it("skips when no crossover is present", () => {
    const signal = computeTrendFollowingSignal({
      symbol: "GC",
      ohlcv: Array.from({ length: 25 }, (_, index) => ({
        close: 2000 + index,
      })),
      lookback: 20,
    });

    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("No bullish SMA crossover");
  });
});

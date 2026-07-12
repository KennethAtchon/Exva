import { describe, expect, it } from "vitest";
import { tradeSignalSchema } from "@electron/shared/ai/trade-signals";
import {
  computeTrendFollowingSignal,
  trendFollowingInputSchema,
} from "./trend-following-signal";

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
    expect(tradeSignalSchema.parse(signal)).toEqual(signal);
  });

  it("sells on a bearish SMA crossover", () => {
    const signal = computeTrendFollowingSignal({
      symbol: "CL",
      ohlcv: [
        { close: 100 },
        { close: 100 },
        { close: 100 },
        { close: 100 },
        { close: 101 },
        { close: 98 },
      ],
      lookback: 3,
    });

    expect(signal.action).toBe("sell");
    expect(signal.reasoning).toContain("crossed below");
    expect(tradeSignalSchema.parse(signal)).toEqual(signal);
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

  it("clamps strong trend-following strength at 0.9", () => {
    const signal = computeTrendFollowingSignal({
      symbol: "CL",
      ohlcv: [
        { close: 10 },
        { close: 10 },
        { close: 10 },
        { close: 10 },
        { close: 9 },
        { close: 100 },
      ],
      lookback: 3,
    });

    expect(signal.action).toBe("buy");
    expect(signal.strength).toBe(0.9);
    expect(signal.confidence).toBe(0.9);
  });

  it("rejects malformed input through the trend-following input schema", () => {
    expect(() =>
      trendFollowingInputSchema.parse({
        symbol: "CL",
        ohlcv: [{ close: Number.NaN }],
      }),
    ).toThrow();
  });
});

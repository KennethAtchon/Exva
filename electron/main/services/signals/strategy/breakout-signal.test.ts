import { describe, expect, it } from "vitest";
import { tradeSignalSchema } from "@electron/shared/ai/trade-signals";
import { breakoutInputSchema, computeBreakoutSignal } from "./breakout-signal";

function bar(high: number, low: number, close: number, volume?: number) {
  return { high, low, close, volume };
}

describe("computeBreakoutSignal", () => {
  it("skips when there are insufficient bars", () => {
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [bar(101, 99, 100)],
      lookback: 20,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("skip");
    expect(signal.executionStrategy).toBe("breakout");
    expect(signal.reasoning).toContain("Insufficient bars");
  });

  it("buys on a breakout above resistance with volume confirmation", () => {
    const window = Array.from({ length: 3 }, () => bar(101, 99, 100, 1000));
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [...window, bar(110, 100, 105, 2000)],
      lookback: 3,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("buy");
    expect(signal.executionStrategy).toBe("breakout");
    expect(signal.reasoning).toContain("volume confirmation");
    expect(tradeSignalSchema.parse(signal)).toEqual(signal);
  });

  it("sells on a breakdown below support with volume confirmation", () => {
    const window = Array.from({ length: 3 }, () => bar(101, 99, 100, 1000));
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [...window, bar(100, 90, 95, 2000)],
      lookback: 3,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("sell");
    expect(signal.executionStrategy).toBe("breakout");
    expect(signal.reasoning).toContain("Breakdown below");
    expect(tradeSignalSchema.parse(signal)).toEqual(signal);
  });

  it("buys with lower strength when volume is not confirmed", () => {
    const window = Array.from({ length: 3 }, () => bar(101, 99, 100, 1000));
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [...window, bar(110, 100, 105, 1000)],
      lookback: 3,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("buy");
    expect(signal.strength).toBe(0.55);
    expect(signal.confidence).toBe(0.55);
    expect(signal.reasoning).toContain("low volume");
  });

  it("sells with lower strength when breakdown volume is not confirmed", () => {
    const window = Array.from({ length: 3 }, () => bar(101, 99, 100, 1000));
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [...window, bar(100, 90, 95, 1000)],
      lookback: 3,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("sell");
    expect(signal.strength).toBe(0.55);
    expect(signal.confidence).toBe(0.55);
    expect(signal.reasoning).toContain("low volume");
  });

  it("skips when price does not break resistance", () => {
    const window = Array.from({ length: 3 }, () => bar(101, 99, 100, 1000));
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [...window, bar(100, 98, 99, 1000)],
      lookback: 3,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("skip");
    expect(signal.executionStrategy).toBe("breakout");
    expect(signal.reasoning).toContain("No breakout");
  });

  it("uses default volume when bars omit volume", () => {
    const window = Array.from({ length: 3 }, () => bar(101, 99, 100));
    const signal = computeBreakoutSignal({
      symbol: "AAPL",
      ohlcv: [...window, bar(110, 100, 105)],
      lookback: 3,
      volumeMultiplierThreshold: 1.5,
    });

    expect(signal.action).toBe("buy");
    expect(signal.strength).toBe(0.55);
    expect(signal.confidence).toBe(0.55);
  });

  it("rejects malformed input through the breakout input schema", () => {
    expect(() =>
      breakoutInputSchema.parse({
        symbol: "AAPL",
        ohlcv: [{ high: 101, low: Number.NaN, close: 100 }],
      }),
    ).toThrow();
  });
});

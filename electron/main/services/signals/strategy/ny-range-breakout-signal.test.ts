import { describe, expect, it } from "vitest";
import {
  createNyRangeBreakoutStrategy,
  NY_RANGE_BREAKOUT_WARMUP_BARS,
} from "./ny-range-breakout-signal";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

function bar(
  openedAt: string,
  high: number,
  low: number,
  close: number,
): OhlcvBar {
  return { ts: openedAt, open: close, high, low, close, volume: 1 };
}

function rangeBars(dateUtc: string): OhlcvBar[] {
  const start = new Date(dateUtc).getTime();
  return Array.from({ length: 12 }, (_, i) => {
    const price = 2000 + (i % 3);
    return bar(
      new Date(start + i * 5 * 60 * 1000).toISOString(),
      price + 1,
      price - 1,
      price,
    );
  });
}

describe("createNyRangeBreakoutStrategy", () => {
  it("uses the completed New York midnight range and enters on the first close above it", () => {
    const strategy = createNyRangeBreakoutStrategy();
    const bars = [
      ...rangeBars("2024-01-15T05:00:00.000Z"),
      bar("2024-01-15T06:00:00.000Z", 2005, 2002, 2004),
    ];

    const signal = strategy.evaluate(bars, { symbol: "GC", timeframe: "5m" });

    expect(signal).toMatchObject({ action: "buy", strength: 1 });
    expect(signal?.evidence).toMatchObject({
      rangeHigh: 2003,
      rangeLow: 1999,
      entryPrice: 2004,
      initialStopPrice: 1998,
      tp1Price: 2006,
      partialClosePct: 0.8,
    });
  });

  it("does not turn a wick through the range into an entry", () => {
    const strategy = createNyRangeBreakoutStrategy();
    const bars = [
      ...rangeBars("2024-01-15T05:00:00.000Z"),
      bar("2024-01-15T06:00:00.000Z", 2005, 2000, 2002),
    ];

    expect(
      strategy.evaluate(bars, { symbol: "GC", timeframe: "5m" }),
    ).toBeNull();
  });

  it("requires every five-minute bar in the midnight range", () => {
    const strategy = createNyRangeBreakoutStrategy();
    const bars = rangeBars("2024-01-15T05:00:00.000Z");
    bars.splice(4, 1);
    bars.push(bar("2024-01-15T06:00:00.000Z", 2005, 2002, 2004));

    expect(
      strategy.evaluate(bars, { symbol: "GC", timeframe: "5m" }),
    ).toBeNull();
  });

  it("uses a one-session warmup window", () => {
    expect(NY_RANGE_BREAKOUT_WARMUP_BARS).toBe(288);
  });
});

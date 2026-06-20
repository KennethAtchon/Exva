import { describe, expect, it } from "vitest";
import { tradeSignalSchema } from "@electron/shared/ai/trade-signals";
import {
  computeMeanReversionSignal,
  meanReversionInputSchema,
} from "./mean-reversion-signal";

function flatCloses(value: number, count: number) {
  return Array.from({ length: count }, () => ({ close: value }));
}

function closesWithLastZScore(lastZScore: number) {
  const sumOthers = -lastZScore;
  const sumSquaresOthers = 20 - lastZScore ** 2;
  const discriminant = 18 * (19 * sumSquaresOthers - sumOthers ** 2);
  const repeated = (18 * sumOthers + Math.sqrt(discriminant)) / (18 * 19);
  const outlier = sumOthers - 18 * repeated;
  return [
    ...Array.from({ length: 18 }, () => ({ close: 100 + repeated })),
    { close: 100 + outlier },
    { close: 100 + lastZScore },
  ];
}

describe("computeMeanReversionSignal", () => {
  it.each([0, 19])(
    "skips with low confidence when %i closes cannot form a 20-bar z-score",
    (count) => {
      const signal = computeMeanReversionSignal({
        symbol: "SPY",
        ohlcv: flatCloses(100, count),
        zScoreEntry: -2,
      });

      expect(signal.action).toBe("skip");
      expect(signal.confidence).toBe(0.2);
      expect(signal.executionStrategy).toBe("mean_reversion");
      expect(tradeSignalSchema.parse(signal)).toEqual(signal);
    },
  );

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
    expect(tradeSignalSchema.parse(signal)).toEqual(signal);
  });

  it("buys at the exact z-score entry boundary", () => {
    const signal = computeMeanReversionSignal({
      symbol: "QQQ",
      ohlcv: closesWithLastZScore(-2),
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("buy");
    expect(signal.reasoning).toContain("Z-score -2.00 below entry -2");
  });

  it("skips just above the z-score entry boundary", () => {
    const signal = computeMeanReversionSignal({
      symbol: "QQQ",
      ohlcv: closesWithLastZScore(-1.99),
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("not extended enough");
  });

  it("clamps extreme mean-reversion confidence at 0.95", () => {
    const signal = computeMeanReversionSignal({
      symbol: "QQQ",
      ohlcv: [...flatCloses(100, 19), { close: 1 }],
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("buy");
    expect(signal.confidence).toBe(0.95);
  });

  it("honors a custom z-score entry threshold", () => {
    const signal = computeMeanReversionSignal({
      symbol: "QQQ",
      ohlcv: closesWithLastZScore(-2),
      zScoreEntry: -2.5,
    });

    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("entry");
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

  it("uses the zero-variance guard for a constant series", () => {
    const signal = computeMeanReversionSignal({
      symbol: "SPY",
      ohlcv: flatCloses(100, 20),
      zScoreEntry: -2,
    });

    expect(signal.action).toBe("skip");
    expect(signal.confidence).toBe(0);
    expect(signal.reasoning).toContain("Z-score 0.00");
  });

  it("rejects malformed input through the rule input schema", () => {
    expect(() =>
      meanReversionInputSchema.parse({
        symbol: "SPY",
        ohlcv: [{ close: Number.NaN }],
      }),
    ).toThrow();
  });
});

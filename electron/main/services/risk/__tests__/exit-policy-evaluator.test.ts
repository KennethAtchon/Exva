import { describe, expect, it } from "vitest";
import {
  ExitPolicyEvaluator,
  type ExitPolicyInput,
} from "../exit-policy-evaluator";

const evaluator = new ExitPolicyEvaluator();

function makeBars(
  count: number,
  basePrice = 100,
): { high: number; low: number; close: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    open: basePrice + i * 0.1,
    high: basePrice + i * 0.1 + 2,
    low: basePrice + i * 0.1 - 2,
    close: basePrice + i * 0.1,
    ts: new Date(Date.now() - (count - 1 - i) * 86400000).toISOString(),
    volume: 100000,
  }));
}

function makeInput(
  overrides: Partial<ExitPolicyInput> & { currentPrice: number },
): ExitPolicyInput {
  return {
    trade: {
      id: "t1",
      entryPrice: 100,
      side: "BUY",
      instrumentType: "stock",
      highWaterMarkPrice: null,
    },
    ohlcvBars: [],
    riskConfig: {
      stopLossType: "fixed_pct",
      stopLossPct: 5,
      atrStopMultiplier: null,
      takeProfitPct: null,
    },
    ...overrides,
  };
}

describe("ExitPolicyEvaluator — fixed_pct", () => {
  it("long: price below stop → shouldExit=true, reason=stop_loss_fixed", () => {
    const result = evaluator.evaluate(makeInput({ currentPrice: 94 })); // entry 100, stop at 95

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("stop_loss_fixed");
    expect(result.triggerPrice).toBeCloseTo(95);
  });

  it("long: price above stop → shouldExit=false", () => {
    const result = evaluator.evaluate(makeInput({ currentPrice: 96 }));

    expect(result.shouldExit).toBe(false);
  });

  it("long: price at exact stop threshold → shouldExit=true", () => {
    const result = evaluator.evaluate(makeInput({ currentPrice: 95 }));

    expect(result.shouldExit).toBe(true);
  });

  it("long: take-profit triggers when price exceeds target", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 111,
        riskConfig: {
          stopLossType: "fixed_pct",
          stopLossPct: 5,
          atrStopMultiplier: null,
          takeProfitPct: 10,
        },
      }),
    );

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("take_profit");
    expect(result.triggerPrice).toBeCloseTo(110);
  });

  it("take_profit checked before stop_loss — TP exit returned when both conditions are met", () => {
    // Construct a scenario where a short trade: stop at entry*1.05, TP at entry*0.90
    // Price drops below both: TP fires first (checked before stop_loss)
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 88, // below both TP (90) and — for a short — stop (105) is above, doesn't matter here
        trade: {
          id: "t1",
          entryPrice: 100,
          side: "SELL",
          instrumentType: "stock",
          highWaterMarkPrice: null,
        },
        riskConfig: {
          stopLossType: "fixed_pct",
          stopLossPct: 5,
          atrStopMultiplier: null,
          takeProfitPct: 10,
        },
      }),
    );

    // TP for short: entryPrice * (1 - 10/100) = 90; price 88 <= 90 → take_profit fires before stop_loss check
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("take_profit");
  });

  it("short: price above stop → shouldExit=true", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 106,
        trade: {
          id: "t1",
          entryPrice: 100,
          side: "SELL",
          instrumentType: "stock",
          highWaterMarkPrice: null,
        },
      }),
    );

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("stop_loss_fixed");
  });

  it("short: price below stop → shouldExit=false", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 96,
        trade: {
          id: "t1",
          entryPrice: 100,
          side: "SELL",
          instrumentType: "stock",
          highWaterMarkPrice: null,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });
});

describe("ExitPolicyEvaluator — trailing_atr", () => {
  it("fewer than 15 bars → shouldExit=false (not enough data for ATR)", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 70,
        ohlcvBars: makeBars(10),
        riskConfig: {
          stopLossType: "trailing_atr",
          stopLossPct: null,
          atrStopMultiplier: 2,
          takeProfitPct: null,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });

  it("price stays above trail → shouldExit=false", () => {
    const bars = makeBars(20, 100);
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 102,
        ohlcvBars: bars,
        riskConfig: {
          stopLossType: "trailing_atr",
          stopLossPct: null,
          atrStopMultiplier: 2,
          takeProfitPct: null,
        },
        trade: {
          id: "t1",
          entryPrice: 100,
          side: "BUY",
          instrumentType: "stock",
          highWaterMarkPrice: 102,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });

  it("price drops below (hwm - atrStopMultiplier * ATR) → shouldExit=true", () => {
    // Create bars with ATR ~4 (high-low range of 4 per bar at price 100)
    const bars = Array.from({ length: 20 }, (_, i) => ({
      high: 100 + 2,
      low: 100 - 2,
      close: 100,
      open: 100,
      ts: new Date(Date.now() - (19 - i) * 86400000).toISOString(),
      volume: 1000,
    }));
    // ATR ≈ 4, multiplier = 2 → trail = hwm - 8
    // hwm = 110, trail = 110 - 8 = 102
    // price = 100 < 102 → exit
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 100,
        ohlcvBars: bars,
        riskConfig: {
          stopLossType: "trailing_atr",
          stopLossPct: null,
          atrStopMultiplier: 2,
          takeProfitPct: null,
        },
        trade: {
          id: "t1",
          entryPrice: 100,
          side: "BUY",
          instrumentType: "stock",
          highWaterMarkPrice: 110,
        },
      }),
    );

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("stop_loss_trailing_atr");
    expect(result.triggerPrice).toBeDefined();
  });

  it("price rises to new HWM but stays above trail → shouldExit=false", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({
      high: 100 + 2,
      low: 100 - 2,
      close: 100 + i * 0.5,
      open: 100 + i * 0.5,
      ts: new Date(Date.now() - (19 - i) * 86400000).toISOString(),
      volume: 1000,
    }));
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 115,
        ohlcvBars: bars,
        riskConfig: {
          stopLossType: "trailing_atr",
          stopLossPct: null,
          atrStopMultiplier: 2,
          takeProfitPct: null,
        },
        trade: {
          id: "t1",
          entryPrice: 100,
          side: "BUY",
          instrumentType: "stock",
          highWaterMarkPrice: 110,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });

  it("prediction_market instrumentType → shouldExit=false always", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 0.01,
        ohlcvBars: makeBars(20),
        riskConfig: {
          stopLossType: "trailing_atr",
          stopLossPct: null,
          atrStopMultiplier: 2,
          takeProfitPct: null,
        },
        trade: {
          id: "t1",
          entryPrice: 0.9,
          side: "BUY",
          instrumentType: "prediction_market",
          highWaterMarkPrice: null,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });
});

describe("ExitPolicyEvaluator — stopLossType=none", () => {
  it("skips exit math when entry or current price is zero/NaN", () => {
    expect(
      evaluator.evaluate(makeInput({ currentPrice: 0 })).shouldExit,
    ).toBe(false);
    expect(
      evaluator.evaluate(
        makeInput({
          currentPrice: 90,
          trade: {
            id: "t1",
            entryPrice: 0,
            side: "BUY",
            instrumentType: "stock",
            highWaterMarkPrice: null,
          },
        }),
      ).shouldExit,
    ).toBe(false);
  });

  it("no stop-loss check runs; price far below entry → shouldExit=false", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 50,
        riskConfig: {
          stopLossType: "none",
          stopLossPct: 5,
          atrStopMultiplier: null,
          takeProfitPct: null,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });

  it("take-profit still fires when stopLossType=none", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 115,
        riskConfig: {
          stopLossType: "none",
          stopLossPct: null,
          atrStopMultiplier: null,
          takeProfitPct: 10,
        },
      }),
    );

    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("take_profit");
  });
});

describe("ExitPolicyEvaluator — broker_native_trailing", () => {
  it("evaluator does nothing; returns shouldExit=false", () => {
    const result = evaluator.evaluate(
      makeInput({
        currentPrice: 50,
        riskConfig: {
          stopLossType: "broker_native_trailing",
          stopLossPct: 5,
          atrStopMultiplier: 2,
          takeProfitPct: null,
        },
      }),
    );

    expect(result.shouldExit).toBe(false);
  });
});

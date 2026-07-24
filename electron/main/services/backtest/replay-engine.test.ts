import { describe, expect, it } from "vitest";
import { purgedWalkForwardFolds } from "@electron/shared/quant/statistics";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import {
  foldIndexForBar,
  hashBarWindow,
  runBacktest,
  type BacktestSpec,
  type DeterministicStrategy,
} from "./replay-engine";

function bar(ts: string, close: number): OhlcvBar {
  return {
    ts,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

/** Fires a buy when the last close is exactly the planted trigger price. */
function plantedStrategy(triggerClose: number): DeterministicStrategy {
  return {
    id: "planted-buy",
    warmupBars: 3,
    evaluate(bars) {
      const last = bars[bars.length - 1];
      if (!last || last.close !== triggerClose) return null;
      return {
        action: "buy",
        strength: 1,
        evidence: { trigger: triggerClose },
        barWindowHash: hashBarWindow(bars),
      };
    },
  };
}

function baseSpec(
  overrides: Partial<BacktestSpec> & {
    strategy: DeterministicStrategy;
    barsBySymbol: Record<string, OhlcvBar[]>;
  },
): BacktestSpec {
  return {
    experienceId: "rules-mean-reversion",
    symbols: ["SPY"],
    timeframe: "1h",
    window: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-03T00:00:00.000Z",
    },
    folds: 2,
    foldConfig: { purge: 1 },
    costs: { spreadBps: 5, feeBps: 2, slippageBps: 3 },
    exitPolicy: { maxHoldBars: 2, takeProfitPct: 0.1 },
    ...overrides,
  };
}

describe("runBacktest", () => {
  it("finds a planted setup and records a trade", () => {
    // 12 bars → purgedWalkForwardFolds(12, 2, 1): fold0 test is [5, 9).
    const bars: OhlcvBar[] = Array.from({ length: 12 }, (_, i) =>
      bar(
        `2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
        i === 5 ? 99 : 100 + i,
      ),
    );
    const result = runBacktest(
      baseSpec({
        strategy: plantedStrategy(99),
        barsBySymbol: { SPY: bars },
      }),
    );
    expect(result.tradeCount).toBeGreaterThanOrEqual(1);
    expect(result.trades[0]?.side).toBe("buy");
    expect(result.trades[0]?.evidence).toEqual({ trigger: 99 });
    expect(result.trades[0]?.fold).toBe(0);
    expect(result.strategyId).toBe("planted-buy");
  });

  it("assigns fold indices from purged walk-forward test ranges", () => {
    const bars: OhlcvBar[] = Array.from({ length: 24 }, (_, i) =>
      bar(`2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`, 100 + i),
    );
    const folds = purgedWalkForwardFolds(bars.length, 2, 1);
    expect(folds.length).toBe(2);

    // Plant triggers at the first bar of each test segment.
    const triggers = new Set(folds.map((f) => f.testStart));
    const strategy: DeterministicStrategy = {
      id: "multi-fold",
      warmupBars: 1,
      evaluate(window) {
        const idx = window.length - 1;
        if (!triggers.has(idx)) return null;
        return {
          action: "buy",
          strength: 1,
          evidence: { idx },
          barWindowHash: hashBarWindow(window),
        };
      },
    };

    const result = runBacktest(
      baseSpec({
        strategy,
        folds: 2,
        foldConfig: { purge: 1 },
        exitPolicy: { maxHoldBars: 1 },
        barsBySymbol: { SPY: bars },
      }),
    );

    expect(result.tradeCount).toBe(2);
    expect(result.trades.map((t) => t.fold).sort()).toEqual([0, 1]);
    for (const trade of result.trades) {
      const entryIdx = bars.findIndex((b) => b.ts === trade.entryTs);
      expect(foldIndexForBar(entryIdx, folds)).toBe(trade.fold);
    }
  });

  it("skips bars in train/purge segments", () => {
    const bars: OhlcvBar[] = Array.from({ length: 12 }, (_, i) =>
      bar(
        `2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
        i === 1 ? 99 : 100, // index 1 is in train for folds=2, purge=1
      ),
    );
    const result = runBacktest(
      baseSpec({
        strategy: { ...plantedStrategy(99), warmupBars: 0 },
        barsBySymbol: { SPY: bars },
      }),
    );
    expect(result.tradeCount).toBe(0);
  });

  it("produces an identical runHash for an identical spec", () => {
    const bars: OhlcvBar[] = Array.from({ length: 12 }, (_, i) =>
      bar(
        `2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
        i === 5 ? 99 : 100 + i,
      ),
    );
    const spec = baseSpec({
      strategy: plantedStrategy(99),
      barsBySymbol: { SPY: bars },
    });
    const a = runBacktest(spec);
    const b = runBacktest(spec);
    expect(a.runHash).toBe(b.runHash);
    expect(a.runHash).toHaveLength(24);
  });

  it("models a partial target then a breakeven runner stop using bar high and low", () => {
    const bars: OhlcvBar[] = [
      bar("2026-01-01T00:00:00.000Z", 100),
      bar("2026-01-01T01:00:00.000Z", 100),
      bar("2026-01-01T02:00:00.000Z", 100),
      bar("2026-01-01T03:00:00.000Z", 100),
      bar("2026-01-01T04:00:00.000Z", 100),
      { ...bar("2026-01-01T05:00:00.000Z", 100), high: 111, low: 99 },
      { ...bar("2026-01-01T06:00:00.000Z", 100), high: 101, low: 99 },
    ];
    const strategy: DeterministicStrategy = {
      id: "partial-lifecycle",
      warmupBars: 3,
      evaluate(window) {
        if (window.length !== 5) return null;
        return {
          action: "buy",
          strength: 1,
          evidence: {},
          barWindowHash: hashBarWindow(window),
          lifecycle: {
            initialStopPrice: 90,
            firstTarget: { price: 110, closeFraction: 0.8 },
            sessionEndTs: "2026-01-01T06:00:00.000Z",
            sameBarPriority: "stop_before_target",
          },
        };
      },
    };

    const result = runBacktest(
      baseSpec({
        strategy,
        folds: 1,
        foldConfig: { purge: 0 },
        costs: { spreadBps: 0, feeBps: 0, slippageBps: 0 },
        barsBySymbol: { SPY: bars },
      }),
    );

    expect(result.trades[0]?.fills).toMatchObject([
      { kind: "tp1", price: 110, fraction: 0.8 },
      { kind: "runner_stop", price: 100 },
    ]);
    expect(result.trades[0]?.fills?.[1]?.fraction).toBeCloseTo(0.2);
    expect(result.trades[0]?.netReturnBps).toBeCloseTo(800);
  });
});

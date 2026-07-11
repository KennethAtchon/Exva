import { describe, expect, it } from "vitest";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import {
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
      end: "2026-01-02T00:00:00.000Z",
    },
    folds: 2,
    costs: { spreadBps: 5, feeBps: 2, slippageBps: 3 },
    exitPolicy: { maxHoldBars: 2, takeProfitPct: 0.1 },
    ...overrides,
  };
}

describe("runBacktest", () => {
  it("finds a planted setup and records a trade", () => {
    const bars: OhlcvBar[] = [
      bar("2026-01-01T00:00:00.000Z", 100),
      bar("2026-01-01T01:00:00.000Z", 101),
      bar("2026-01-01T02:00:00.000Z", 102),
      bar("2026-01-01T03:00:00.000Z", 99), // planted trigger after warmup
      bar("2026-01-01T04:00:00.000Z", 105),
      bar("2026-01-01T05:00:00.000Z", 110),
    ];
    const result = runBacktest(
      baseSpec({
        strategy: plantedStrategy(99),
        barsBySymbol: { SPY: bars },
      }),
    );
    expect(result.tradeCount).toBeGreaterThanOrEqual(1);
    expect(result.trades[0]?.side).toBe("buy");
    expect(result.trades[0]?.evidence).toEqual({ trigger: 99 });
    expect(result.strategyId).toBe("planted-buy");
  });

  it("produces an identical runHash for an identical spec", () => {
    const bars: OhlcvBar[] = [
      bar("2026-01-01T00:00:00.000Z", 100),
      bar("2026-01-01T01:00:00.000Z", 101),
      bar("2026-01-01T02:00:00.000Z", 102),
      bar("2026-01-01T03:00:00.000Z", 99),
      bar("2026-01-01T04:00:00.000Z", 108),
      bar("2026-01-01T05:00:00.000Z", 107),
    ];
    const spec = baseSpec({
      strategy: plantedStrategy(99),
      barsBySymbol: { SPY: bars },
    });
    const a = runBacktest(spec);
    const b = runBacktest(spec);
    expect(a.runHash).toBe(b.runHash);
    expect(a.runHash).toHaveLength(24);
  });
});

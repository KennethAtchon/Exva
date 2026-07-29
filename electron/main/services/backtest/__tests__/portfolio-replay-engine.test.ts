import { describe, expect, it } from "vitest";
import { PortfolioReplayEngine } from "../portfolio-replay-engine";
import type { BacktestRunSpecV2 } from "@electron/shared/domain/backtest-v2";
import {
  DEFAULT_BACKTEST_V2_EXECUTION,
  DEFAULT_BACKTEST_V2_PORTFOLIO,
} from "@electron/shared/domain/backtest-v2";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";
import type { DeterministicStrategy } from "../replay-engine";

function bar(
  ts: string,
  open: number,
  high: number,
  low: number,
  close: number,
): OhlcvBar {
  return { ts, open, high, low, close, volume: 1_000 };
}

describe("PortfolioReplayEngine", () => {
  it("fills on next-bar open and tracks dollar P&L", () => {
    const strategy: DeterministicStrategy = {
      id: "test",
      warmupBars: 1,
      evaluate(bars) {
        if (bars.length === 1 && bars[0]!.close === 100) {
          return {
            action: "buy",
            strength: 0.8,
            evidence: { close: 100 },
            barWindowHash: "h1",
          };
        }
        return null;
      },
    };

    const bars: OhlcvBar[] = [
      bar("2026-01-01T00:00:00.000Z", 100, 101, 99, 100),
      bar("2026-01-02T00:00:00.000Z", 105, 106, 104, 105),
      bar("2026-01-03T00:00:00.000Z", 110, 111, 109, 110),
    ];

    const spec: BacktestRunSpecV2 = {
      schemaVersion: 2,
      experienceId: "rules-mean-reversion",
      strategy: {
        id: "test",
        implementationVersion: 1,
        parameters: {},
      },
      instruments: [
        { symbol: "SPY", instrumentClass: "stock", timeframe: "1d" },
      ],
      window: {
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-03T00:00:00.000Z",
      },
      folds: { count: 1, purgeBars: 0 },
      portfolio: {
        ...DEFAULT_BACKTEST_V2_PORTFOLIO,
        sizing: { kind: "fixed_notional", notionalUsd: 500 },
      },
      execution: DEFAULT_BACKTEST_V2_EXECUTION,
      costs: { spreadBps: 0, commissionBps: 0, slippageBps: 0 },
    };

    const engine = new PortfolioReplayEngine();
    const result = engine.run({
      spec,
      strategy,
      barsBySymbol: new Map([["SPY", bars]]),
    });

    expect(result.fills.length).toBeGreaterThanOrEqual(1);
    expect(result.fills[0]!.price).toBe(105); // next-bar open
    expect(result.equity.length).toBe(3);
    expect(result.endingEquityUsd).not.toBe(result.startingCapitalUsd);
    // Accounting identity on every point
    for (const pt of result.equity) {
      expect(pt.equityUsd).toBeCloseTo(pt.cashUsd + pt.netMarketValueUsd, 6);
    }
  });
});

import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BacktestRunsRepo } from "../../../db/repositories/research/experiment-repos";
import { ExperienceExperimentsRepo } from "../../../db/repositories/experiences/experience-experiments-repo";
import { EventBus } from "../../infra/event-bus";
import { HistoricalBackfillService } from "../../marketdata/historical-backfill-service";
import { MarketDataService } from "../../marketdata/market-data-service";
import { BacktestLabService } from "../../operator/backtest-lab-service";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

function syntheticBars(startIso: string, count: number): OhlcvBar[] {
  const start = Date.parse(startIso);
  const bars: OhlcvBar[] = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + Math.sin(i / 7) * 4 + (i % 17 === 0 ? 3 : 0);
    bars.push({
      ts: new Date(start + i * 3_600_000).toISOString(),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + (i % 20 === 0 ? 5_000 : 0),
    });
  }
  return bars;
}

describe("backfill → Backtest Lab composition", () => {
  it("loads ranged bars then produces a hash-stable lab rerun", async () => {
    const db = createTestDb();
    const marketData = new MarketDataService(db);
    const allBars = syntheticBars("2026-01-01T00:00:00.000Z", 24 * 30 * 6);
    const backfill = new HistoricalBackfillService({
      marketData,
      eventBus: new EventBus(),
      resolveAdapter: async () => ({
        brokerType: "alpaca",
        getOhlcvRange: async (_symbol, _tf, window) =>
          allBars.filter(
            (bar) => bar.ts >= window.startIso && bar.ts < window.endIso,
          ),
      }),
      normalizeWireSymbol: ({ symbol }) => symbol,
      marketDataProviderForBroker: () => "alpaca",
      sleep: async () => undefined,
    });

    const firstBar = allBars[0];
    const lastBar = allBars.at(-1);
    expect(firstBar).toBeDefined();
    expect(lastBar).toBeDefined();
    if (!firstBar || !lastBar) throw new Error("Expected synthetic bars");
    const windowStart = firstBar.ts;
    const windowEnd = lastBar.ts;
    const written = await backfill.backfill({
      symbol: "SPY",
      instrumentClass: "stock",
      timeframe: "1h",
      startIso: windowStart,
      endIso: new Date(Date.parse(windowEnd) + 3_600_000).toISOString(),
    });
    expect(written.barsWritten).toBeGreaterThan(1000);

    const lab = new BacktestLabService({
      marketData,
      backtestRuns: new BacktestRunsRepo(db),
      experienceExperiments: new ExperienceExperimentsRepo(db),
      eventBus: new EventBus(),
    });
    const runInput = {
      experienceId: "composition-lab",
      strategyId: "mean-reversion",
      symbols: ["SPY"],
      timeframe: "1h" as const,
      windowStart,
      windowEnd,
      folds: 3,
      costs: { spreadBps: 1, feeBps: 0, slippageBps: 2 },
      exitPolicy: { maxHoldBars: 20, stopLossPct: 0.02 },
    };
    const first = await lab.run(runInput);
    expect(first.result.folds.length).toBe(3);
    expect(first.determinismHash).toBe(first.result.runHash);

    const second = await lab.run(runInput);
    expect(second.result.runHash).toBe(first.result.runHash);

    const rerun = await lab.rerunFromSpec(first.run.id);
    expect(rerun.hashMatches).toBe(true);
    expect(rerun.result.runHash).toBe(first.result.runHash);
  });
});

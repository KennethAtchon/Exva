import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BacktestRunsRepo } from "../../../db/repositories/research/experiment-repos";
import { BacktestDetailRepo } from "../../../db/repositories/research/backtest-detail-repo";
import { ExperienceExperimentsRepo } from "../../../db/repositories/experiences/experience-experiments-repo";
import { EventBus } from "../../infra/event-bus";
import { MarketDataService } from "../../marketdata/market-data-service";
import { BacktestLabService } from "../backtest-lab-service";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

function writeContinuousBars(
  marketData: MarketDataService,
  symbol: string,
  startIso: string,
  count: number,
): { first: string; last: string } {
  const start = Date.parse(startIso);
  const bars: OhlcvBar[] = Array.from({ length: count }, (_, i) => ({
    ts: new Date(start + i * 3_600_000).toISOString(),
    open: 100 + Math.sin(i / 5),
    high: 102,
    low: 98,
    close: 100 + Math.sin(i / 5) * 2,
    volume: 1000 + i,
  }));
  marketData.writeBars(symbol, "stock", "1h", bars, "alpaca");
  return { first: bars[0]!.ts, last: bars.at(-1)!.ts };
}

describe("BacktestLabService", () => {
  it("refuses non-OHLCV strategies", async () => {
    const db = createTestDb();
    const lab = new BacktestLabService({
      marketData: new MarketDataService(db),
      backtestRuns: new BacktestRunsRepo(db),
      experienceExperiments: new ExperienceExperimentsRepo(db),
      eventBus: new EventBus(),
      db,
    });

    await expect(
      lab.run({
        experienceId: "rules-mean-reversion",
        strategyId: "funding-basis",
        symbols: ["BTC-USD"],
        timeframe: "1h",
        windowStart: "2024-01-01T00:00:00.000Z",
        windowEnd: "2024-01-02T00:00:00.000Z",
        folds: 2,
      }),
    ).rejects.toThrow(/OHLCV/);
  });

  it("blocks runs when any symbol has incomplete data", async () => {
    const db = createTestDb();
    const marketData = new MarketDataService(db);
    const { first, last } = writeContinuousBars(
      marketData,
      "SPY",
      "2024-01-01T00:00:00.000Z",
      20,
    );
    const lab = new BacktestLabService({
      marketData,
      backtestRuns: new BacktestRunsRepo(db),
      experienceExperiments: new ExperienceExperimentsRepo(db),
      eventBus: new EventBus(),
      db,
    });

    await expect(
      lab.run({
        experienceId: "rules-mean-reversion",
        strategyId: "mean-reversion",
        symbols: ["SPY", "QQQ"],
        timeframe: "1h",
        windowStart: first,
        windowEnd: last,
        folds: 2,
      }),
    ).rejects.toThrow(/incomplete data for QQQ/);
  });

  it("persists promotion evidence and research contract hash on V2 runs", async () => {
    const db = createTestDb();
    const marketData = new MarketDataService(db);
    const { first, last } = writeContinuousBars(
      marketData,
      "SPY",
      "2024-01-01T00:00:00.000Z",
      120,
    );
    const lab = new BacktestLabService({
      marketData,
      backtestRuns: new BacktestRunsRepo(db),
      backtestDetail: new BacktestDetailRepo(db),
      experienceExperiments: new ExperienceExperimentsRepo(db),
      eventBus: new EventBus(),
      db,
    });

    const { run } = await lab.run({
      experienceId: "rules-mean-reversion",
      strategyId: "mean-reversion",
      symbols: ["SPY"],
      timeframe: "1h",
      windowStart: first,
      windowEnd: last,
      folds: 3,
    });

    expect(run.engineVersion).toBe(2);
    expect(run.researchContractHash).toMatch(/^c[0-9a-f]+$/);
    expect(run.verdict).not.toBe("pass");

    const metrics = JSON.parse(run.metricsJson) as {
      promotion?: {
        criteria?: Record<string, { pass: boolean; reason: string }>;
        dataQuality?: unknown[];
      };
    };
    expect(metrics.promotion?.criteria).toBeDefined();
    expect(metrics.promotion?.dataQuality).toHaveLength(1);

    const detail = lab.getDetail(run.id);
    expect(detail?.equity.length).toBeGreaterThan(0);
    expect(detail?.spec?.strategy.id).toBe("mean-reversion");
  });
});

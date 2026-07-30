import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../test-helpers";
import { BacktestRunsRepo } from "../experiment-repos";
import { BacktestDetailRepo } from "../backtest-detail-repo";
import { persistPortfolioReplayDetail } from "../../../../services/backtest/persist-portfolio-replay";
import {
  DEFAULT_BACKTEST_V2_EXECUTION,
  DEFAULT_BACKTEST_V2_PORTFOLIO,
} from "@electron/shared/domain/backtest-v2";
import { PortfolioReplayEngine } from "../../../../services/backtest/portfolio-replay-engine";
import { createMeanReversionStrategy } from "../../../../services/signals/strategy/mean-reversion-signal";
import type { OhlcvBar } from "../../../../services/broker/adapters/broker-adapter";

describe("BacktestDetailRepo", () => {
  it("loads equity, trades, fills, and spec for a V2 run", () => {
    const db = createTestDb();
    const runs = new BacktestRunsRepo(db);
    const detailRepo = new BacktestDetailRepo(db);
    const runId = crypto.randomUUID();

    const bars: OhlcvBar[] = Array.from({ length: 80 }, (_, i) => ({
      ts: new Date(Date.UTC(2024, 0, 1, i)).toISOString(),
      open: 100,
      high: 101,
      low: 99,
      close: 100 + Math.sin(i / 4),
      volume: 1000,
    }));

    runs.insert({
      id: runId,
      experienceId: "test",
      modelVersionId: null,
      contractHash: "abc",
      windowStart: bars[0]!.ts,
      windowEnd: bars.at(-1)!.ts,
      foldConfigJson: "{}",
      costModelJson: "{}",
      metricsJson: "{}",
      verdict: "inconclusive",
      createdAt: new Date().toISOString(),
      engineVersion: 2,
    });

    const spec = {
      schemaVersion: 2 as const,
      experienceId: "test",
      strategy: {
        id: "mean-reversion",
        implementationVersion: 1,
        parameters: { zScoreEntry: -2 },
      },
      instruments: [
        { symbol: "SPY", instrumentClass: "stock" as const, timeframe: "1h" as const },
      ],
      window: { start: bars[0]!.ts, end: bars.at(-1)!.ts },
      folds: { count: 2, purgeBars: 1 },
      portfolio: { ...DEFAULT_BACKTEST_V2_PORTFOLIO },
      execution: { ...DEFAULT_BACKTEST_V2_EXECUTION },
      costs: { spreadBps: 1, commissionBps: 0, slippageBps: 1 },
    };

    const portfolio = new PortfolioReplayEngine().run({
      spec,
      strategy: createMeanReversionStrategy({ zScoreEntry: -2 }),
      barsBySymbol: new Map([["SPY", bars]]),
    });

    persistPortfolioReplayDetail(db, {
      runId,
      spec,
      specHash: "spec123",
      datasetHash: "data123",
      researchContractHash: "cabc",
      portfolio,
      barsBySymbol: new Map([["SPY", { length: bars.length }]]),
    });

    const detail = detailRepo.getDetail(runId);
    expect(detail).not.toBeNull();
    expect(detail?.specHash).toBe("spec123");
    expect(detail?.equity.length).toBe(portfolio.equity.length);
    expect(detail?.trades.length).toBe(portfolio.trades.length);
    expect(detail?.fills.length).toBe(portfolio.fills.length);
  });
});

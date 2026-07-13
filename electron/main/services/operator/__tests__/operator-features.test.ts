import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BriefingsRepo } from "../../../db/repositories/system/briefings-repo";
import { EquitySnapshotsRepo } from "../../../db/repositories/system/equity-snapshots-repo";
import { BacktestLabService } from "../backtest-lab-service";
import { MarketDataService } from "../../marketdata/market-data-service";
import { BacktestRunsRepo } from "../../../db/repositories/research/experiment-repos";
import { ExperienceExperimentsRepo } from "../../../db/repositories/experiences/experience-experiments-repo";
import { EventBus } from "../../infra/event-bus";
import { KillSwitchService } from "../kill-switch-service";

describe("operator power tools (finish-line 08)", () => {
  it("persists briefings and equity snapshots", () => {
    const db = createTestDb();
    const briefings = new BriefingsRepo(db);
    const equity = new EquitySnapshotsRepo(db);

    const row = briefings.upsert({
      date: "2026-07-12",
      narrative: "+$10 yesterday.",
      doc: {
        date: "2026-07-12",
        yesterdayPnlUsd: 10,
        openPositions: 0,
        tradesOpened: 1,
        tradesClosed: 1,
        tradeSummaries: [],
        ladderNotes: [],
        calibrationNotes: [],
        calendarEvents: [],
        alarms: [],
        aiSpendUsd: 1,
        aiBudgetUsd: 25,
        dataCoverageStatus: "ok",
        headlineNumbers: { pnl: 10, trades: 2, open: 0 },
      },
    });
    expect(briefings.getByDate("2026-07-12")?.narrative).toBe(row.narrative);

    equity.insert({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      total: 10_000,
      perAccount: { a: 10_000 },
      perExperience: {},
      aiSpendUsd: 2,
    });
    expect(equity.latest()?.total).toBe(10_000);
  });

  it("threshold sweep writes experience_experiments rows", async () => {
    const db = createTestDb();
    const marketData = new MarketDataService(db);
    const bars = [];
    for (let i = 0; i < 80; i++) {
      bars.push({
        ts: new Date(Date.UTC(2024, 0, 1, i)).toISOString(),
        open: 100,
        high: 101,
        low: 99,
        close: 100 + Math.sin(i / 5) * 3,
        volume: 1000,
      });
    }
    marketData.writeBars("SPY", "stock", "1h", bars, "manual");

    const lab = new BacktestLabService({
      marketData,
      backtestRuns: new BacktestRunsRepo(db),
      experienceExperiments: new ExperienceExperimentsRepo(db),
      eventBus: new EventBus(),
    });

    const first = bars[0];
    const last = bars[bars.length - 1];
    expect(first && last).toBeTruthy();
    if (!first || !last) return;

    const result = await lab.sweep({
      experienceId: "rules-mean-reversion",
      strategyId: "mean-reversion",
      symbols: ["SPY"],
      timeframe: "1h",
      windowStart: first.ts,
      windowEnd: last.ts,
      folds: 2,
      paramKey: "zScoreEntry",
      values: [-2.5, -2, -1.5],
    });
    expect(result.experimentIds).toHaveLength(3);
    expect(result.trials).toHaveLength(3);
  });

  it("flatten requires typed FLATTEN confirmation", async () => {
    const kill = new KillSwitchService({
      sessions: { listByStatuses: () => [] } as never,
      trades: { listOpenAndPending: () => [] } as never,
      sessionService: {} as never,
      liveReadiness: {} as never,
      supervisor: {} as never,
      eventBus: new EventBus(),
      broker: {} as never,
      capitalReservation: { releaseOnClose: () => undefined } as never,
      loadGauges: () => [],
    });
    await expect(kill.flattenAll("nope")).rejects.toThrow(/FLATTEN/);
    const ok = await kill.flattenAll("FLATTEN");
    expect(ok.closed).toEqual([]);
  });
});

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
import { vi } from "vitest";

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
      sessionService: { pause: async () => undefined } as never,
      liveReadiness: {} as never,
      supervisor: {} as never,
      eventBus: new EventBus(),
      broker: {} as never,
      capitalReservation: {
        runInTransaction: <T>(fn: () => T) => fn(),
        releaseOnClose: () => undefined,
      } as never,
      loadGauges: () => [],
    });
    await expect(kill.flattenAll("nope")).rejects.toThrow(/FLATTEN/);
    const ok = await kill.flattenAll("FLATTEN");
    expect(ok.closed).toEqual([]);
    expect(ok.canceled).toEqual([]);
    expect(ok.complete).toBe(true);
  });

  it("engages order halt on pauseAll and clears via clearHalt", async () => {
    const kill = new KillSwitchService({
      sessions: { listByStatuses: () => [] } as never,
      trades: { listOpenAndPending: () => [] } as never,
      sessionService: { pause: async () => undefined } as never,
      liveReadiness: {} as never,
      supervisor: {} as never,
      eventBus: new EventBus(),
      broker: {} as never,
      capitalReservation: {
        runInTransaction: <T>(fn: () => T) => fn(),
        releaseOnClose: () => undefined,
      } as never,
      loadGauges: () => [],
    });
    expect(kill.isHalted()).toBe(false);
    await kill.pauseAll();
    expect(kill.isHalted()).toBe(true);
    kill.clearHalt();
    expect(kill.isHalted()).toBe(false);
  });

  it("flatten leaves trades open when broker identity is missing", async () => {
    const updateStatus = vi.fn();
    const releaseOnClose = vi.fn();
    const raiseDailyLoss = vi.fn(async () => undefined);
    const kill = new KillSwitchService({
      sessions: { listByStatuses: () => [] } as never,
      trades: {
        listOpenAndPending: () => [
          {
            id: "t-open",
            status: "open",
            sessionId: "s1",
            broker_order_id: null,
            brokerAccountId: null,
          },
          {
            id: "t-pending",
            status: "pending",
            sessionId: "s1",
            broker_order_id: "ord",
            brokerAccountId: null,
          },
        ],
        updateStatus,
      } as never,
      sessionService: { pause: async () => undefined } as never,
      liveReadiness: {} as never,
      supervisor: { raiseDailyLoss } as never,
      eventBus: new EventBus(),
      broker: {
        closeOrder: vi.fn(),
        cancelOrder: vi.fn(),
        getOrderStatus: vi.fn(),
      } as never,
      capitalReservation: {
        runInTransaction: <T>(fn: () => T) => fn(),
        releaseOnClose,
      } as never,
      loadGauges: () => [],
    });

    const result = await kill.flattenAll("FLATTEN");
    expect(result.complete).toBe(false);
    expect(result.attentionRequired.sort()).toEqual(
      ["t-open", "t-pending"].sort(),
    );
    expect(updateStatus).not.toHaveBeenCalled();
    expect(releaseOnClose).not.toHaveBeenCalled();
  });

  it("flatten confirms broker closure before DB close", async () => {
    const updateStatus = vi.fn((_id, _status, pnl) => ({
      id: "t1",
      status: "closed",
      final_pnl_usd: pnl,
    }));
    const releaseOnClose = vi.fn();
    let openCalls = 0;
    const kill = new KillSwitchService({
      sessions: { listByStatuses: () => [] } as never,
      trades: {
        listOpenAndPending: () => {
          openCalls += 1;
          return openCalls === 1
            ? [
                {
                  id: "t1",
                  status: "open",
                  sessionId: "s1",
                  broker_order_id: "ord-1",
                  brokerAccountId: "acct-1",
                },
              ]
            : [];
        },
        updateStatus,
      } as never,
      sessionService: { pause: async () => undefined } as never,
      liveReadiness: {} as never,
      supervisor: { raiseDailyLoss: vi.fn() } as never,
      eventBus: new EventBus(),
      broker: {
        getOrderStatus: vi
          .fn()
          .mockResolvedValueOnce({
            brokerOrderId: "ord-1",
            status: "open",
            latestPrice: 1,
            realizedPnlUsd: null,
          })
          .mockResolvedValueOnce({
            brokerOrderId: "ord-1",
            status: "closed",
            latestPrice: 1,
            realizedPnlUsd: 12,
          }),
        closeOrder: vi.fn(async () => ({
          brokerOrderId: "ord-1",
          realizedPnlUsd: 12,
        })),
        cancelOrder: vi.fn(),
      } as never,
      capitalReservation: {
        runInTransaction: <T>(fn: () => T) => fn(),
        releaseOnClose,
      } as never,
      loadGauges: () => [],
    });

    const result = await kill.flattenAll("FLATTEN");
    expect(result.closed).toEqual(["t1"]);
    expect(result.complete).toBe(true);
    expect(updateStatus).toHaveBeenCalledWith(
      "t1",
      "closed",
      12,
      "flatten_close",
    );
    expect(releaseOnClose).toHaveBeenCalledWith("t1");
  });
});

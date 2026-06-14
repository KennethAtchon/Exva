import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingCycleContext } from "../../trading-cycle-context";
import { handleResolvedInstruments } from "../instrument-queue";

describe("instrument-queue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("enqueues trade cycles in FIFO order", async () => {
    const ctx = createContext({ runtimeActive: true });
    const order: string[] = [];

    handleResolvedInstruments(
      ctx,
      [
        { symbol: "AAPL", instrumentClass: "stock" },
        { symbol: "MSFT", instrumentClass: "stock" },
        { symbol: "NVDA", instrumentClass: "stock" },
      ],
      "Selector complete",
      {
        scheduleSelectorCycle: vi.fn(async () => undefined),
        enqueueTradeCycle: async (instrument) => {
          order.push(instrument.symbol);
        },
      },
    );

    await ctx.queue.onIdle();
    expect(order).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("deduplicates resolved instruments by class:symbol key", async () => {
    const ctx = createContext({ runtimeActive: true });
    const enqueued: string[] = [];

    handleResolvedInstruments(
      ctx,
      [
        { symbol: "AAPL", instrumentClass: "stock" },
        { symbol: "AAPL", instrumentClass: "stock" },
        { symbol: "aapl", instrumentClass: "stock" },
        { symbol: "AAPL", instrumentClass: "crypto" },
      ],
      "Selector complete",
      {
        scheduleSelectorCycle: vi.fn(async () => undefined),
        enqueueTradeCycle: async (instrument) => {
          enqueued.push(`${instrument.instrumentClass}:${instrument.symbol}`);
        },
      },
    );

    await ctx.queue.onIdle();
    expect(enqueued).toEqual(["stock:AAPL", "crypto:AAPL"]);
  });

  it("schedules selector retry when no instruments are resolved", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ runtimeActive: true });
    const scheduleSelectorCycle = vi.fn(async () => undefined);

    handleResolvedInstruments(ctx, [], "Initial research cycle complete", {
      scheduleSelectorCycle,
      enqueueTradeCycle: vi.fn(async () => undefined),
    });

    expect(ctx.getFailureHistory()).toHaveLength(1);
    expect(ctx.getFailureHistory()[0]).toMatchObject({
      stage: "selector_cycle",
      outcome: "no_trade",
      reasonCategory: "model_no_trade",
    });

    vi.advanceTimersByTime(5 * 60 * 1000);
    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).toHaveBeenCalled();
  });

  it("skips enqueue when runtime is paused", async () => {
    const ctx = createContext({ runtimeActive: false });
    const enqueueTradeCycle = vi.fn(async () => undefined);

    handleResolvedInstruments(
      ctx,
      [{ symbol: "AAPL", instrumentClass: "stock" }],
      "Selector complete",
      {
        scheduleSelectorCycle: vi.fn(async () => undefined),
        enqueueTradeCycle,
      },
    );

    await ctx.queue.onIdle();
    expect(enqueueTradeCycle).not.toHaveBeenCalled();
  });

  it("skips handoff when runtime is stopped", async () => {
    const ctx = createContext({ runtimeActive: true });
    ctx.stopped = true;
    const enqueueTradeCycle = vi.fn(async () => undefined);

    handleResolvedInstruments(
      ctx,
      [{ symbol: "AAPL", instrumentClass: "stock" }],
      "Selector complete",
      {
        scheduleSelectorCycle: vi.fn(async () => undefined),
        enqueueTradeCycle,
      },
    );

    await ctx.queue.onIdle();
    expect(enqueueTradeCycle).not.toHaveBeenCalled();
  });
});

function createContext(options: { runtimeActive: boolean }) {
  return new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => "active",
    },
    strategyContextService: {
      get: () => ({
        rules: { setupType: "momentum" },
        riskConfig: {
          waitForOpenThreshold: 0.8,
          maxPositionUsd: 1000,
          maxConcurrentTrades: 3,
          stopLossPct: 2,
          takeProfitPct: 4,
          maxConsecutiveLosers: 3,
          dailyLossLimitUsd: 100,
          profitTargetUsd: 200,
          maxAiSpendUsd: 5,
          humanApprovalRequired: false,
        },
      }),
    },
    sessionSelectorSettingsRepo: {
      get: () => ({ noInstrumentRetryMinutes: 5 }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn(),
    },
    bus: {
      runtimeStatus: () => (options.runtimeActive ? "active" : "paused"),
      emit: vi.fn(),
    },
    eventsRepo: {
      insert: vi.fn((event) => ({ id: "event-1", ...event })),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    tradesRepo: {
      listOpenAndPending: () => [],
    },
  } as never);
}

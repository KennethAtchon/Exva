import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TradingCycleContext } from "../../trading-cycle-context";
import { registerDefaultInstrumentAnalyses } from "../../../../pipeline/implementations/registry/register-analyses";
import { handleResolvedInstruments } from "../instrument-queue";

// Researching pipeline so the no-instrument retry path schedules a refill.
const RESEARCHING_EXPERIENCE = "prediction-event-edge";

describe("instrument-queue", () => {
  beforeAll(() => {
    registerDefaultInstrumentAnalyses();
  });

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

  it("defers the retry to the market open when blocked by market hours", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ runtimeActive: true });
    const scheduleSelectorCycle = vi.fn(async () => undefined);

    // Market reopens in 2h — far past the 5-minute fixed retry interval.
    const openInMs = 2 * 60 * 60 * 1000;
    ctx.setMarketClosedRetryAt(Date.now() + openInMs);

    handleResolvedInstruments(ctx, [], "Selector complete", {
      scheduleSelectorCycle,
      enqueueTradeCycle: vi.fn(async () => undefined),
    });

    // Fixed interval elapses but the open hasn't arrived: no retry yet.
    vi.advanceTimersByTime(5 * 60 * 1000);
    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).not.toHaveBeenCalled();

    // At the open, the selector re-runs.
    vi.advanceTimersByTime(openInMs - 5 * 60 * 1000);
    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).toHaveBeenCalled();
  });

  it("never retries sooner than the fixed interval when the open is imminent", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ runtimeActive: true });
    const scheduleSelectorCycle = vi.fn(async () => undefined);

    // Open is only 30s out — under the 5-minute floor.
    ctx.setMarketClosedRetryAt(Date.now() + 30 * 1000);

    handleResolvedInstruments(ctx, [], "Selector complete", {
      scheduleSelectorCycle,
      enqueueTradeCycle: vi.fn(async () => undefined),
    });

    vi.advanceTimersByTime(30 * 1000);
    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).not.toHaveBeenCalled();

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
      requireById: () => ({
        id: "session-1",
        experienceId: RESEARCHING_EXPERIENCE,
      }),
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
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

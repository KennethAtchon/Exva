import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { scheduleCycleRefillIfIdle } from "../cycle-refill";
import { TradingCycleContext } from "../../trading-cycle-context";
import { registerDefaultInstrumentAnalyses } from "../../../../pipeline/implementations/registry/register-analyses";

// A pipeline that researches its own universe — autonomous refill only runs for
// pipelines whose experience declares selector workers.
const RESEARCHING_EXPERIENCE = "prediction-event-edge";

beforeAll(() => {
  registerDefaultInstrumentAnalyses();
});

describe("scheduleCycleRefillIfIdle", () => {
  it("queues a selector cycle when the orchestrator queue is idle", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({ openTradeCount: 0, maxConcurrentTrades: 3 });

    scheduleCycleRefillIfIdle(
      ctx,
      scheduleSelectorCycle,
      "No-trade cycle complete",
    );
    await ctx.queue.onIdle();
    await ctx.queue.onIdle();

    expect(scheduleSelectorCycle).toHaveBeenCalledWith(
      "No-trade cycle complete",
    );
    expect(ctx.cycleRestartInFlight).toBe(false);
  });

  it("skips refill while session is attention_required", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({
      openTradeCount: 0,
      maxConcurrentTrades: 3,
      sessionStatus: "attention_required",
    });

    scheduleCycleRefillIfIdle(ctx, scheduleSelectorCycle, "No-trade cycle");
    await ctx.queue.onIdle();

    expect(scheduleSelectorCycle).not.toHaveBeenCalled();
  });
});

describe("scheduleCycleRefillAfterDelayIfIdle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("schedules delayed selector refill using noInstrumentRetryMinutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({ openTradeCount: 0, maxConcurrentTrades: 3 });

    const { scheduleCycleRefillAfterDelayIfIdle } =
      await import("../cycle-refill");
    scheduleCycleRefillAfterDelayIfIdle(
      ctx,
      scheduleSelectorCycle,
      "Selector retry",
      5 * 60 * 1000,
    );

    expect(ctx.noInstrumentRetryTimer).not.toBeNull();

    vi.advanceTimersByTime(5 * 60 * 1000);
    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).toHaveBeenCalledWith("Selector retry");
  });

  it("clears noInstrumentRetryTimer on orchestrator stop", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ openTradeCount: 0, maxConcurrentTrades: 3 });
    const { scheduleCycleRefillAfterDelayIfIdle } =
      await import("../cycle-refill");
    scheduleCycleRefillAfterDelayIfIdle(
      ctx,
      vi.fn(async () => undefined),
      "Selector retry",
      5 * 60 * 1000,
    );
    expect(ctx.noInstrumentRetryTimer).not.toBeNull();

    ctx.clearNoInstrumentRetry();
    expect(ctx.noInstrumentRetryTimer).toBeNull();
    expect(ctx.getNearestRetryAt()).toBeNull();
  });
});

describe("scheduleCycleRefillIfIdle capacity guard", () => {
  it("does not queue a selector cycle while open trades remain", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({ openTradeCount: 3, maxConcurrentTrades: 3 });

    scheduleCycleRefillIfIdle(
      ctx,
      scheduleSelectorCycle,
      "No-trade cycle complete",
    );
    await ctx.queue.onIdle();

    expect(scheduleSelectorCycle).not.toHaveBeenCalled();
  });
});

function createContext(input: {
  openTradeCount: number;
  maxConcurrentTrades: number;
  sessionStatus?: "active" | "attention_required";
}): TradingCycleContext {
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => input.sessionStatus ?? "active",
      requireById: () => ({
        id: "session-1",
        experienceId: RESEARCHING_EXPERIENCE,
      }),
    },
    strategyContextService: {
      get: () => ({
        rules: { setupType: "momentum" },
        riskConfig: {
          waitForOpenThreshold: 0.8,
          maxPositionUsd: 1000,
          maxConcurrentTrades: input.maxConcurrentTrades,
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
      runtimeStatus: () => "active",
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
      listOpenAndPending: () =>
        Array.from({ length: input.openTradeCount }, (_, index) => ({
          id: `trade-${index}`,
          status: "open",
        })),
    },
  } as never);

  ctx.getSessionConfig = () =>
    ({
      max_concurrent_trades: input.maxConcurrentTrades,
    }) as never;

  return ctx;
}

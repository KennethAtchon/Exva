import { describe, expect, it, vi } from "vitest";
import { scheduleCycleRefillIfIdle } from "../cycle-refill";
import { TradingCycleContext } from "../../trading-cycle-context";

describe("scheduleCycleRefillIfIdle", () => {
  it("queues a selector cycle when the orchestrator queue is idle", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({ openTradeCount: 0, maxConcurrentTrades: 3 });

    scheduleCycleRefillIfIdle(ctx, scheduleSelectorCycle, "No-trade cycle complete");
    await ctx.queue.onIdle();
    await ctx.queue.onIdle();

    expect(scheduleSelectorCycle).toHaveBeenCalledWith("No-trade cycle complete");
    expect(ctx.cycleRestartInFlight).toBe(false);
  });

  it("does not queue a selector cycle while open trades remain", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({ openTradeCount: 3, maxConcurrentTrades: 3 });

    scheduleCycleRefillIfIdle(ctx, scheduleSelectorCycle, "No-trade cycle complete");
    await ctx.queue.onIdle();

    expect(scheduleSelectorCycle).not.toHaveBeenCalled();
  });
});

function createContext(input: {
  openTradeCount: number;
  maxConcurrentTrades: number;
}): TradingCycleContext {
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => "active",
    },
    strategyContextService: {
      get: () => ({
        riskConfig: { waitForOpenThreshold: 0.8 },
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

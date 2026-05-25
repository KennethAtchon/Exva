import { describe, expect, it } from "vitest";
import {
  canScheduleSelector,
  countOpenTrades,
  hasAnyOpenTrade,
} from "../session-trade-state";
import { TradingCycleContext } from "../../orchestration/cycle/trading-cycle-context";

describe("session-trade-state", () => {
  it("counts only open trades, not pending", () => {
    const tradesRepo = {
      listOpenAndPending: () => [
        { id: "t1", status: "open" },
        { id: "t2", status: "pending" },
      ],
    } as never;

    expect(countOpenTrades(tradesRepo, "session-1")).toBe(1);
    expect(hasAnyOpenTrade(tradesRepo, "session-1")).toBe(true);
  });

  it("blocks selector scheduling while open trades remain", () => {
    const ctx = createContext({ openTradeCount: 1, maxConcurrentTrades: 3 });
    expect(canScheduleSelector(ctx)).toBe(false);
  });

  it("allows selector scheduling when flat and under capacity", () => {
    const ctx = createContext({ openTradeCount: 0, maxConcurrentTrades: 3 });
    expect(canScheduleSelector(ctx)).toBe(true);
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
      upsert: () => undefined,
    },
    bus: {
      runtimeStatus: () => "active",
      emit: () => undefined,
    },
    eventsRepo: {
      insert: (event: object) => ({ id: "event-1", ...event }),
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
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

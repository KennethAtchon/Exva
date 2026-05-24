import { describe, expect, it, vi, afterEach } from "vitest";
import { TradingCycleContext } from "../trading-cycle-context";

describe("TradingCycleContext failure history", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("records instrument-scoped failures with retry timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
    const ctx = createContext();
    ctx.cycleContexts.set("cycle-1", {
      kind: "trade",
      cycleId: "cycle-1",
      instrument: { symbol: "AAPL", instrumentClass: "stock" },
    });

    ctx.recordFailure({
      cycleId: "cycle-1",
      stage: "trade_cycle",
      outcome: "no_trade",
      level: "WARN",
      code: null,
      message: "No trade for AAPL",
      reasonCategory: "model_no_trade",
    });

    expect(ctx.getFailureHistoryForInstrument("AAPL")).toEqual([
      expect.objectContaining({
        cycleId: "cycle-1",
        instrumentSymbol: "AAPL",
        instrumentClass: "stock",
        stage: "trade_cycle",
        outcome: "no_trade",
        level: "WARN",
        reasonCategory: "model_no_trade",
        retryAt: "2026-05-24T12:05:00.000Z",
      }),
    ]);
    expect(ctx.getNearestRetryAt()).toBe("2026-05-24T12:05:00.000Z");
  });

  it("prunes failure history entries older than one hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
    const ctx = createContext();

    ctx.recordFailure({
      cycleId: "selector-1",
      stage: "selector_cycle",
      outcome: "transient",
      level: "ERROR",
      code: "VALIDATION_FAILED",
      message: "selector failed",
      reasonCategory: "unexpected_bug",
    });
    expect(ctx.getFailureHistory()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-05-24T13:01:00.000Z"));
    expect(ctx.getFailureHistory()).toHaveLength(0);
  });
});

function createContext() {
  return new TradingCycleContext("session-1", {
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
      listOpenAndPending: () => [],
    },
  } as never);
}

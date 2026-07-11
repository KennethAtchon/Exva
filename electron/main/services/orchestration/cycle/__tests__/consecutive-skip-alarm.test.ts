import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingCycleContext } from "../trading-cycle-context";

describe("consecutive skip alarm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("raises attention_required after 10 identical no_trade reasons", () => {
    const setStatus = vi.fn(
      (next: "active" | "attention_required", _sessionId: string) => {
        status = next;
      },
    );
    const emit = vi.fn();
    let status: "active" | "attention_required" = "active";

    const ctx = new TradingCycleContext("session-skip-alarm", {
      sessionRepo: {
        getStatus: () => status,
        setStatus,
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
        emit,
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

    for (let i = 0; i < 9; i++) {
      ctx.recordFailure({
        cycleId: `cycle-${i}`,
        stage: "trade_cycle",
        outcome: "no_trade",
        level: "WARN",
        code: null,
        message: "No setup",
        reasonCategory: "model_no_trade",
      });
    }
    expect(status).toBe("active");
    expect(ctx.consecutiveSameSkipCount).toBe(9);

    ctx.recordFailure({
      cycleId: "cycle-9",
      stage: "trade_cycle",
      outcome: "no_trade",
      level: "WARN",
      code: null,
      message: "No setup",
      reasonCategory: "model_no_trade",
    });

    expect(ctx.consecutiveSameSkipCount).toBe(10);
    expect(status).toBe("attention_required");
    expect(setStatus).toHaveBeenCalledWith(
      "attention_required",
      "session-skip-alarm",
    );
    expect(emit).toHaveBeenCalledWith(
      "notification",
      expect.objectContaining({
        title: "Exva: consecutive skips",
        level: "ERROR",
      }),
    );
  });
});

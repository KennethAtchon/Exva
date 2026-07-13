import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { TradingCycleContext } from "../../trading-cycle-context";
import { registerDefaultInstrumentAnalyses } from "../../../../pipeline/implementations/registry/register-analyses";
import {
  attachTradeClosedListener,
  detachTradeClosedListener,
} from "../trade-closed-handler";

// A pipeline that researches its own universe vs. a purely signal-fed one — the
// runtime decides "should I autonomously restart research" from the session's
// experience, not from selectionMode.
const RESEARCHING_EXPERIENCE = "prediction-event-edge";
const SIGNAL_FED_EXPERIENCE = "rules-mean-reversion";

describe("attachTradeClosedListener", () => {
  beforeAll(() => {
    registerDefaultInstrumentAnalyses();
  });

  it("does not schedule selector restart while sibling trades remain open", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({
      openTradeCount: 1,
      runtimeActive: true,
    });

    attachTradeClosedListener(ctx, scheduleSelectorCycle);
    ctx.deps.bus.emit("trade_closed", {
      id: "trade-closed",
      sessionId: "session-1",
      status: "closed",
    } as Trade);

    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).not.toHaveBeenCalled();
    expect(ctx.cycleRestartInFlight).toBe(false);
  });

  it("schedules selector restart via enqueueTask when session is flat", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({
      openTradeCount: 0,
      runtimeActive: true,
    });

    attachTradeClosedListener(ctx, scheduleSelectorCycle);
    ctx.deps.bus.emit("trade_closed", {
      id: "trade-closed",
      sessionId: "session-1",
      status: "closed",
    } as Trade);

    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).toHaveBeenCalledTimes(1);
    expect(ctx.cycleRestartInFlight).toBe(false);
  });

  it("does not schedule selector restart for signal-driven sessions", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({
      openTradeCount: 0,
      runtimeActive: true,
      experienceId: SIGNAL_FED_EXPERIENCE,
    });

    attachTradeClosedListener(ctx, scheduleSelectorCycle);
    ctx.deps.bus.emit("trade_closed", {
      id: "trade-closed",
      sessionId: "session-1",
      status: "closed",
    } as Trade);

    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).not.toHaveBeenCalled();
    expect(ctx.cycleRestartInFlight).toBe(false);
  });

  it("does not schedule selector restart while draining to stop", async () => {
    const scheduleSelectorCycle = vi.fn(async () => undefined);
    const ctx = createContext({
      openTradeCount: 0,
      runtimeActive: true,
      sessionStatus: "monitoring_only",
    });

    attachTradeClosedListener(ctx, scheduleSelectorCycle);
    ctx.deps.bus.emit("trade_closed", {
      id: "trade-closed",
      sessionId: "session-1",
      status: "closed",
    } as Trade);

    await ctx.queue.onIdle();
    expect(scheduleSelectorCycle).not.toHaveBeenCalled();
    expect(ctx.cycleRestartInFlight).toBe(false);
  });

  it("detaches cleanly", () => {
    const ctx = createContext({ openTradeCount: 0, runtimeActive: true });
    attachTradeClosedListener(
      ctx,
      vi.fn(async () => undefined),
    );
    detachTradeClosedListener(ctx);
    expect(ctx.unsubscribeTradeClosed).toBeNull();
  });
});

function createContext(input: {
  openTradeCount: number;
  runtimeActive: boolean;
  sessionStatus?: "active" | "monitoring_only";
  experienceId?: string;
}): TradingCycleContext {
  const listeners = new Map<string, (payload: unknown) => void>();
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => input.sessionStatus ?? "active",
      requireById: () => ({
        id: "session-1",
        experienceId: input.experienceId ?? RESEARCHING_EXPERIENCE,
      }),
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        riskConfig: { waitForOpenThreshold: 0.8 },
      }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn(),
    },
    bus: {
      runtimeStatus: () => (input.runtimeActive ? "active" : "paused"),
      emit: (event: string, payload: unknown) => {
        listeners.get(event)?.(payload);
      },
      on: (event: string, handler: (payload: unknown) => void) => {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
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

  ctx.getStrategyContext = () =>
    ({
      riskConfig: {
        maxConcurrentTrades: 3,
      },
    }) as never;

  return ctx;
}

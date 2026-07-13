import { describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { TradingCycleContext } from "../../trading-cycle-context";
import {
  failRecheck,
  hasApprovalCallback,
  resolveApproval,
  waitForApproval,
} from "../approval-flow";

describe("approval-flow", () => {
  it("waitForApproval creates pending approval and reserves capital", async () => {
    const ctx = createContext();
    const trade = makeTrade();

    const pending = waitForApproval(
      ctx,
      trade,
      "stock",
      {
        symbol: "NVDA",
        action: "buy",
        executionStrategy: "breakout",
        entryPrice: 185,
        confidence: 0.85,
        reasoning: "strong setup",
      },
      "risk ok",
    );

    expect(ctx.deps.tradeApprovalsRepo.createPending).toHaveBeenCalled();
    expect(ctx.deps.capitalReservation.reserveForApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        amountUsd: trade.position_size_usd,
      }),
    );
    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "approval_required",
      expect.objectContaining({ trade_id: trade.id }),
    );
    expect(hasApprovalCallback(ctx, trade.id)).toBe(true);

    resolveApproval(ctx, trade.id, true);
    await expect(pending).resolves.toEqual({
      approved: true,
      approvalId: "approval-1",
    });
  });

  it("failRecheck releases capital and rejects trade", () => {
    const ctx = createContext();
    failRecheck(ctx, "trade-1", "approval-1", "Fresh decision is skip");

    expect(ctx.deps.capitalReservation.releaseByApproval).toHaveBeenCalledWith(
      "approval-1",
    );
    expect(ctx.deps.tradesRepo.updateStatus).toHaveBeenCalledWith(
      "trade-1",
      "rejected",
      0,
    );
    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "trade_closed",
      expect.objectContaining({ id: "trade-1", status: "rejected" }),
    );
  });

  it("resolveApproval returns false when no callback is registered", () => {
    const ctx = createContext();
    expect(resolveApproval(ctx, "missing-trade", true)).toBe(false);
  });
});

function makeTrade(): Trade {
  return {
    id: "trade-1",
    sessionId: "session-1",
    brokerAccountId: null,
    instrumentSymbol: "NVDA",
    instrumentDisplayName: null,
    predictionOutcome: null,
    instrumentMetadataJson: null,
    instrumentType: "stock",
    side: "BUY",
    entry_price: 185,
    position_size_usd: 500,
    stop_loss_price: 175,
    take_profit_price: 200,
    strategy: "momentum",
    execution_strategy: "breakout",
    status: "pending",
    opened_at: null,
    closed_at: null,
    final_pnl_usd: null,
    ai_cost_usd: 0.2,
    confidence_score: 0.85,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  };
}

function createContext() {
  return new TradingCycleContext("session-1", {
    sessionRepo: { getStatus: () => "active" },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        timeframe: {
          holdingStyle: "intraday_flat",
          primaryTradingTimeframe: "15m",
          targetHoldDays: 1,
          maxHoldDays: 1,
          timeframeNotes: "",
        },
      }),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: { runtimeStatus: () => "active", emit: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tradeApprovalsRepo: {
      createPending: vi.fn(() => ({ id: "approval-1" })),
    },
    tradesRepo: {
      patchPendingExecution: vi.fn(),
      updateStatus: vi.fn((id, status) => ({ id, status })),
    },
    capitalReservation: {
      reserveForApproval: vi.fn(),
      releaseByApproval: vi.fn(),
    },
    brokerRouting: {
      resolveBrokerAccountId: () => "broker-1",
    },
  } as never);
}

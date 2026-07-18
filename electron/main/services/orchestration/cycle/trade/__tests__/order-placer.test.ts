import { describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { TradingCycleContext } from "../../trading-cycle-context";
import { placeRoutedOrder } from "../order-placer";

describe("placeRoutedOrder", () => {
  it("places order through resolved adapter and returns broker ids", async () => {
    const ctx = createContext();
    const trade = makeTrade();

    const result = await placeRoutedOrder(
      ctx,
      trade,
      "stock",
      {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
      "cycle-1:trade-1",
    );

    expect(result).toEqual({
      brokerOrderId: "mock-order-1",
      filledAvgPrice: 185.5,
    });
    expect(ctx.deps.brokerRouting.resolveAdapter).toHaveBeenCalledWith(
      "session-1",
      "stock",
    );
    expect(ctx.deps.instrumentNormalizer.toBrokerSymbol).toHaveBeenCalled();
  });

  it("returns null when instrument conflict exists", async () => {
    const ctx = createContext({ instrumentConflict: true });
    const trade = makeTrade();

    const result = await placeRoutedOrder(
      ctx,
      trade,
      "stock",
      {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
      "cycle-1:trade-1",
    );

    expect(result).toBeNull();
  });

  it("returns null when adapter capabilities reject the order shape", async () => {
    const ctx = createContext({
      capabilities: {
        supportsLimit: false,
        supportsStop: false,
        supportsStopLimit: false,
        supportsBracket: true,
        supportsStreaming: false,
        quantityKinds: ["units"],
        timeInForce: ["day"],
        orderTypes: ["market"],
      },
    });
    const trade = makeTrade();

    const result = await placeRoutedOrder(
      ctx,
      trade,
      "stock",
      {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
      "cycle-1:trade-1",
    );

    expect(result).toBeNull();
    expect(ctx.deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining("quantity") }),
      "order skipped: adapter does not support order shape",
    );
  });

  it("patches broker account id when routing resolves a different account", async () => {
    const ctx = createContext({ brokerAccountId: "broker-alt" });
    const trade = makeTrade();

    await placeRoutedOrder(
      ctx,
      trade,
      "stock",
      {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
      "cycle-1:trade-1",
    );

    expect(ctx.deps.tradesRepo.patchPendingExecution).toHaveBeenCalledWith(
      "trade-1",
      { brokerAccountId: "broker-alt" },
    );
  });

  it("refuses submission when kill-switch halt is engaged after policy", async () => {
    const placeOrder = vi.fn(async () => ({
      brokerOrderId: "should-not-place",
      filledAvgPrice: 1,
    }));
    const ctx = createContext({
      isOrderHalted: () => true,
      placeOrder,
    });
    const trade = makeTrade();

    await expect(
      placeRoutedOrder(
        ctx,
        trade,
        "stock",
        {
          instrumentSymbol: "NVDA",
          instrumentType: "stock",
          side: "BUY",
          sizeUsd: 500,
        },
        "cycle-1:trade-1",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(placeOrder).not.toHaveBeenCalled();
  });
});

function makeTrade(): Trade {
  return {
    id: "trade-1",
    sessionId: "session-1",
    brokerAccountId: "broker-1",
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

function createContext(options?: {
  instrumentConflict?: boolean;
  brokerAccountId?: string;
  isOrderHalted?: () => boolean;
  placeOrder?: ReturnType<typeof vi.fn>;
  capabilities?: {
    supportsLimit: boolean;
    supportsStop: boolean;
    supportsStopLimit: boolean;
    supportsBracket: boolean;
    supportsStreaming: boolean;
    quantityKinds: Array<"notional_usd" | "units">;
    timeInForce: Array<"day" | "gtc" | "ioc" | "fok">;
    orderTypes: Array<"market" | "limit" | "stop" | "stop_limit">;
  };
}) {
  const adapter = {
    brokerType: "mock" as const,
    capabilities: options?.capabilities,
    placeOrder:
      options?.placeOrder ??
      vi.fn(async () => ({
        brokerOrderId: "mock-order-1",
        filledAvgPrice: 185.5,
      })),
  };

  return new TradingCycleContext("session-1", {
    sessionRepo: { getStatus: () => "active" },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({}),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: { runtimeStatus: () => "active", emit: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    brokerRouting: {
      resolveAdapter: vi.fn(async () => ({
        adapter,
        brokerAccountId: options?.brokerAccountId ?? "broker-1",
      })),
    },
    instrumentNormalizer: {
      toBrokerSymbol: vi.fn(({ symbol }: { symbol: string }) => symbol),
    },
    tradesRepo: {
      checkInstrumentConflict: vi.fn(
        () => options?.instrumentConflict ?? false,
      ),
      patchPendingExecution: vi.fn(),
    },
    isOrderHalted: options?.isOrderHalted,
  } as never);
}

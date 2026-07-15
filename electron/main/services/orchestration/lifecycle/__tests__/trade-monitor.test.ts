import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { EventBus } from "../../../infra/event-bus";
import { TradeMonitor, MOCK_POLL_INTERVAL_MS } from "../trade-monitor";

describe("TradeMonitor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("closes open trade on take-profit trigger", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T15:00:00.000Z"));
    const harness = createHarness({
      currentPrice: 221,
      entryPrice: 200,
      takeProfitPct: 10,
    });

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["tick"]();

    expect(harness.tradesRepo.updateStatus).toHaveBeenCalledWith(
      "trade-1",
      "closed",
      expect.any(Number),
      "take_profit",
      undefined,
    );
  });

  it("closes open trade on stop-loss trigger", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T15:00:00.000Z"));
    const harness = createHarness({
      currentPrice: 180,
      entryPrice: 200,
      stopLossPct: 5,
    });

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["tick"]();

    expect(harness.tradesRepo.updateStatus).toHaveBeenCalledWith(
      "trade-1",
      "closed",
      expect.any(Number),
      "stop_loss_fixed",
      undefined,
    );
  });

  it("closes trade when max hold days exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T15:00:00.000Z"));
    const harness = createHarness({
      openedAt: "2026-06-10T15:00:00.000Z",
      maxHoldDays: 5,
      currentPrice: 205,
      entryPrice: 200,
    });

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["tick"]();

    expect(harness.tradesRepo.updateStatus).toHaveBeenCalledWith(
      "trade-1",
      "closed",
      expect.any(Number),
      "max_hold_days",
      undefined,
    );
  });

  it("continues monitoring when session runtime is paused", async () => {
    const harness = createHarness({
      sessionStatus: "paused",
      runtimeStatus: "paused",
      currentPrice: 221,
      entryPrice: 200,
      takeProfitPct: 10,
    });

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["tick"]();

    expect(harness.tradesRepo.updateStatus).toHaveBeenCalled();
  });

  it("continues monitoring when session is monitoring_only", async () => {
    const harness = createHarness({
      sessionStatus: "monitoring_only",
      runtimeStatus: "active",
      currentPrice: 221,
      entryPrice: 200,
      takeProfitPct: 10,
    });

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["tick"]();

    expect(harness.tradesRepo.updateStatus).toHaveBeenCalled();
  });

  it("closes a trade immediately from a terminal stream event, tagged closureSource: stream", async () => {
    const harness = createHarness({
      currentPrice: 205,
      entryPrice: 200,
    });
    harness.tradesRepo.findOpenByBrokerOrderId = vi.fn((): Trade | null => ({
      ...harness.trade,
    }));
    const adapterGetOrderStatus = vi.fn(async () => ({
      status: "closed" as const,
      realizedPnlUsd: 42,
      latestPrice: 210,
    }));
    harness.brokerRegistry.get = vi.fn(async () => ({
      brokerType: "mock",
      getOrderStatus: adapterGetOrderStatus,
    })) as never;

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["onOrderEvent"]("broker-1", {
      brokerOrderId: "mock-order-1",
      kind: "fill",
      ts: new Date().toISOString(),
    });

    expect(adapterGetOrderStatus).toHaveBeenCalledWith("mock-order-1");
    expect(harness.tradesRepo.updateStatus).toHaveBeenCalledWith(
      "trade-1",
      "closed",
      42,
      "broker_closed",
      "stream",
    );
  });

  it("ignores a stream event with no matching open trade for that broker order", async () => {
    const harness = createHarness({ currentPrice: 205, entryPrice: 200 });
    harness.tradesRepo.findOpenByBrokerOrderId = vi.fn(() => null);
    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await monitor["onOrderEvent"]("broker-1", {
      brokerOrderId: "unknown-order",
      kind: "canceled",
      ts: new Date().toISOString(),
    });

    expect(harness.tradesRepo.updateStatus).not.toHaveBeenCalled();
  });

  it("retries on next tick after quote failure without escalating session", async () => {
    const harness = createHarness({
      currentPrice: 205,
      entryPrice: 200,
      quoteFailuresBeforeSuccess: 1,
    });

    const monitor = new TradeMonitor(
      "session-1",
      harness.tradesRepo as never,
      harness.statsRepo as never,
      harness.sessionRepo as never,
      harness.brokerRegistry as never,
      harness.strategyContextService as never,
      harness.capitalReservation as never,
      () => 5000,
      harness.eventBus,
      () => 10,
      undefined,
      harness.instrumentNormalizer as never,
      MOCK_POLL_INTERVAL_MS,
    );

    await expect(monitor["tick"]()).rejects.toThrow("quote unavailable");

    await monitor["tick"]();
    expect(harness.tradesRepo.updatePriceExtremes).toHaveBeenCalled();
    expect(harness.sessionRepo.setStatus).not.toHaveBeenCalled();
  });
});

function createHarness(options: {
  currentPrice: number;
  entryPrice?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  side?: "BUY" | "SELL";
  openedAt?: string;
  maxHoldDays?: number;
  sessionStatus?: "active" | "paused" | "monitoring_only";
  runtimeStatus?: "active" | "paused" | "stopping";
  quoteFailuresBeforeSuccess?: number;
}) {
  const eventBus = new EventBus();
  eventBus.setRuntimeStatus("session-1", options.runtimeStatus ?? "active");

  const trade: Trade = {
    id: "trade-1",
    sessionId: "session-1",
    brokerAccountId: "broker-1",
    instrumentSymbol: "NVDA",
    instrumentDisplayName: null,
    predictionOutcome: null,
    instrumentMetadataJson: null,
    instrumentType: "stock",
    side: options.side ?? "BUY",
    entry_price: options.entryPrice ?? 200,
    position_size_usd: 500,
    stop_loss_price: null,
    take_profit_price: null,
    strategy: "momentum",
    execution_strategy: "breakout",
    status: "open",
    opened_at: options.openedAt ?? "2026-06-13T14:00:00.000Z",
    closed_at: null,
    final_pnl_usd: null,
    ai_cost_usd: 0.2,
    confidence_score: 0.85,
    broker_order_id: "mock-order-1",
    high_water_mark_price: options.entryPrice ?? 200,
    low_water_mark_price: options.entryPrice ?? 200,
    exit_reason: null,
    created_at: "2026-06-13T13:00:00.000Z",
  };

  let quoteFailuresRemaining = options.quoteFailuresBeforeSuccess ?? 0;

  type MockAdapter = {
    brokerType: string;
    getMarketSnapshot?: ReturnType<typeof vi.fn>;
    getOrderStatus: ReturnType<typeof vi.fn>;
    closeOrder?: ReturnType<typeof vi.fn>;
    getOhlcv?: ReturnType<typeof vi.fn>;
  };

  return {
    eventBus,
    trade,
    tradesRepo: {
      listOpenAndPending: vi.fn(() => [trade]),
      require: vi.fn(() => trade),
      find: vi.fn(() => trade),
      findOpenByBrokerOrderId: vi.fn((): Trade | null => null),
      updatePriceExtremes: vi.fn(),
      updateLevelTouchTimes: vi.fn(),
      updateCloseSnapshot: vi.fn(),
      updateExitAnalytics: vi.fn(),
      updateStatus: vi.fn((id, status, pnl, exitReason) => ({
        ...trade,
        id,
        status,
        final_pnl_usd: pnl,
        exit_reason: exitReason ?? null,
      })),
    },
    statsRepo: {
      dashboardStats: vi.fn(() => ({
        daily_api_spend: 0,
        api_budget: 5,
      })),
    },
    sessionRepo: {
      getStatus: vi.fn(() => options.sessionStatus ?? "active"),
      setStatus: vi.fn(),
      uptimeMin: vi.fn(() => 10),
    },
    brokerRegistry: {
      get: vi.fn(
        async (): Promise<MockAdapter> => ({
          brokerType: "mock",
          getMarketSnapshot: vi.fn(async () => {
            if (quoteFailuresRemaining > 0) {
              quoteFailuresRemaining -= 1;
              throw new Error("quote unavailable");
            }
            return {
              price: options.currentPrice,
              timestamp: new Date().toISOString(),
            };
          }),
          getOrderStatus: vi.fn(async () => ({ status: "open" as const })),
          closeOrder: vi.fn(async () => ({ realizedPnlUsd: 25 })),
          getOhlcv: vi.fn(async () => []),
        }),
      ),
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: vi.fn(() => ({
        riskConfig: {
          stopLossType: "fixed_pct",
          stopLossPct: options.stopLossPct ?? 5,
          atrStopMultiplier: null,
          takeProfitPct: options.takeProfitPct ?? 10,
          maxExposureUsd: null,
        },
        timeframe: {
          holdingStyle: "multi_day_swing",
          maxHoldDays: options.maxHoldDays ?? null,
        },
      })),
    },
    capitalReservation: {
      releaseOnClose: vi.fn(),
    },
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    },
  };
}

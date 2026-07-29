import { describe, expect, it } from "vitest";
import {
  createInstrumentedBrokerAdapter,
  OPTIONAL_BROKER_METHODS,
} from "../instrumented-broker-adapter";
import type { BrokerAdapter } from "../adapters/broker-adapter";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";

describe("createInstrumentedBrokerAdapter", () => {
  it("preserves every optional method present on the inner adapter", () => {
    const inner = {
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"] as const,
      launchCapable: true,
      capabilities: {
        supportsLimit: true,
        supportsStop: true,
        supportsStopLimit: true,
        supportsBracket: true,
        supportsStreaming: true,
        quantityKinds: ["notional_usd", "units"] as const,
        timeInForce: ["day"] as const,
        orderTypes: ["market", "limit"] as const,
      },
      testConnection: async () => ({ ok: true, message: "ok" }),
      placeOrder: async () => ({ brokerOrderId: "1", filledAvgPrice: 1 }),
      placeOrderV2: async () => ({ brokerOrderId: "1", filledAvgPrice: 1 }),
      cancelOrder: async () => undefined,
      getPositions: async () => [],
      getAccountBalance: async () => 1,
      getMarketSnapshot: async () => ({
        instrumentSymbol: "SPY",
        price: 1,
        timestamp: new Date().toISOString(),
      }),
      getOrderStatus: async () => ({
        brokerOrderId: "1",
        status: "closed" as const,
        latestPrice: 1,
        realizedPnlUsd: 0,
      }),
      closeOrder: async () => ({ brokerOrderId: "1", realizedPnlUsd: 0 }),
      getOhlcv: async () => [],
      getOhlcvRange: async () => [],
      getOptionChain: async () => [],
      createOrderEventFeed: () => ({
        start: async () => undefined,
        stop: async () => undefined,
      }),
      getOpenOrders: async () => [],
      prepareClientOrderId: (id: string) => id.slice(0, 48),
      findOrderByClientOrderId: async () => null,
    } as unknown as BrokerAdapter;

    const apiCallLogRepo = {
      insert: () => undefined,
    } as unknown as ApiCallLogRepo;

    const outer = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo,
      brokerAccountId: "acct",
      provider: "alpaca",
    });

    for (const method of OPTIONAL_BROKER_METHODS) {
      const presentOnInner = method in inner && (inner as never)[method] != null;
      if (!presentOnInner) continue;
      expect(
        method in outer && (outer as never)[method] != null,
        `instrumentation dropped optional method: ${method}`,
      ).toBe(true);
    }
  });
});

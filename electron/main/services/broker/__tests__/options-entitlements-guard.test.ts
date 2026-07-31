import { describe, expect, it } from "vitest";
import {
  assertOptionsEntitlements,
  normalizeOptionsOrderShape,
} from "../options-entitlements-guard";
import type { BrokerAdapter } from "../adapters/broker-adapter";
import type { BrokerOrderV2 } from "../order-contract-v2";
import { createInstrumentedBrokerAdapter } from "../instrumented-broker-adapter";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";

describe("options entitlements guard", () => {
  it("rejects when options levels are insufficient", async () => {
    const adapter = {
      getTradingEntitlements: async () => ({
        tradingBlocked: false,
        buyingPower: 1000,
        optionsApprovedLevel: 0,
        optionsTradingLevel: 0,
        optionsBuyingPower: 0,
        equityDataFeed: "iex",
      }),
    } as BrokerAdapter;

    await expect(
      assertOptionsEntitlements(adapter, {
        clientOrderId: "x",
        instrument: { symbol: "SPY", instrumentClass: "options" },
        side: "BUY",
        quantity: { kind: "units", value: 1 },
        orderType: "limit",
        limitPrice: 1.5,
        timeInForce: "day",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Regression: the guard treats a missing getTradingEntitlements as FORBIDDEN,
  // and instrumentation used to drop the method — so every options order was
  // refused with "requires adapter trading entitlements" on an account that was
  // fully approved. The gate has to survive the wrapper the registry hands out.
  it("passes an approved account through instrumentation", async () => {
    const inner = {
      brokerType: "alpaca",
      supportedInstrumentClasses: ["options"] as const,
      launchCapable: true,
      testConnection: async () => ({ ok: true, message: "ok" }),
      placeOrder: async () => ({ brokerOrderId: "1", filledAvgPrice: 1 }),
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
      getTradingEntitlements: async () => ({
        tradingBlocked: false,
        buyingPower: 400_000,
        optionsApprovedLevel: 3,
        optionsTradingLevel: 3,
        optionsBuyingPower: 100_000,
        equityDataFeed: "iex",
      }),
    } as unknown as BrokerAdapter;

    const adapter = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo: { insert: () => undefined } as unknown as ApiCallLogRepo,
      brokerAccountId: "acct",
      provider: "alpaca",
    });

    await expect(
      assertOptionsEntitlements(adapter, {
        clientOrderId: "x",
        instrument: { symbol: "SPY", instrumentClass: "options" },
        side: "BUY",
        quantity: { kind: "units", value: 1 },
        orderType: "limit",
        limitPrice: 1.5,
        timeInForce: "day",
      }),
    ).resolves.toEqual({
      optionsApprovedLevel: 3,
      optionsTradingLevel: 3,
      optionsBuyingPower: 100_000,
    });
  });

  it("floors fractional contracts to whole units", () => {
    const order: BrokerOrderV2 = {
      clientOrderId: "x",
      instrument: { symbol: "SPY", instrumentClass: "options" },
      side: "BUY",
      quantity: { kind: "units", value: 2.7 },
      orderType: "market",
      timeInForce: "day",
      legs: [
        { symbol: "LEG1", side: "BUY", quantity: 1 },
        { symbol: "LEG2", side: "SELL", quantity: 1 },
      ],
    };
    const normalized = normalizeOptionsOrderShape(order);
    expect(normalized.quantity).toEqual({ kind: "units", value: 2 });
    expect(normalized.orderType).toBe("limit");
  });
});

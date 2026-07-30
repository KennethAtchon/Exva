import { describe, expect, it } from "vitest";
import {
  assertOptionsEntitlements,
  normalizeOptionsOrderShape,
} from "../options-entitlements-guard";
import type { BrokerAdapter } from "../adapters/broker-adapter";
import type { BrokerOrderV2 } from "../order-contract-v2";

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

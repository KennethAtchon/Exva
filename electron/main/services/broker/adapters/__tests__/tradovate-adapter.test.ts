import { describe, expect, it } from "vitest";
import { TradovateAdapter } from "../tradovate-adapter";

/**
 * The adapter is quarantined (Solution 04 / 10). It previously reported a
 * fabricated $250k balance and simulated fills, which made a dead venue look
 * like a working futures lane. Every mutating and balance method must now
 * refuse, so the futures gap stays visible instead of silently green.
 */
describe("TradovateAdapter (quarantined)", () => {
  const credentials = {
    username: "tv-user",
    password: "tv-pass",
    appId: "Exva",
  };

  const quarantined = /FUTURES_ADAPTER_SIMULATED/;

  it("refuses testConnection instead of reporting a fabricated balance", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");

    const connection = await adapter.testConnection();

    expect(connection.ok).toBe(false);
    expect(connection.message).toMatch(quarantined);
    expect(connection).not.toHaveProperty("account_balance", 250000);
  });

  it("throws on balance and quote reads", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");

    await expect(adapter.getAccountBalance()).rejects.toThrow(quarantined);
    await expect(adapter.getMarketSnapshot("ES")).rejects.toThrow(quarantined);
  });

  it("refuses every order, including well-formed futures orders", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "ES",
        instrumentType: "futures",
        side: "BUY",
        sizeUsd: 5000,
        clientOrderId: "tv-1",
      }),
    ).rejects.toThrow(quarantined);

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 1000,
        clientOrderId: "tv-stock",
      }),
    ).rejects.toThrow(quarantined);
  });

  it("throws on order status and positions rather than returning empty state", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");

    await expect(adapter.getOrderStatus("tv-order-1")).rejects.toThrow(
      quarantined,
    );
    await expect(adapter.getPositions()).rejects.toThrow(quarantined);
  });
});

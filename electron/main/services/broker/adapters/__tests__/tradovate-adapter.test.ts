import { describe, expect, it } from "vitest";
import { TradovateAdapter } from "../tradovate-adapter";

describe("TradovateAdapter", () => {
  const credentials = {
    username: "tv-user",
    password: "tv-pass",
    appId: "Exva",
  };

  it("accepts credentials and returns a simulated balance", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");

    const connection = await adapter.testConnection();
    const balance = await adapter.getAccountBalance();

    expect(connection).toMatchObject({
      ok: true,
      account_balance: 250000,
    });
    expect(balance).toBe(250000);
  });

  it("returns deterministic stub quotes and simulated futures orders", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");
    const quote = await adapter.getMarketSnapshot("ES");
    const order = await adapter.placeOrder({
      instrumentSymbol: "ES",
      instrumentType: "futures",
      side: "BUY",
      sizeUsd: 5000,
      clientOrderId: "tv-1",
    });

    expect(quote.price).toBeGreaterThan(5000);
    expect(order.brokerOrderId).toMatch(/^tv_sim_/);
    expect(order.filledAvgPrice).toBe(quote.price);
  });

  it("rejects non-futures instruments", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 1000,
        clientOrderId: "tv-stock",
      }),
    ).rejects.toThrow(/futures only/i);
  });

  it("reports closed order status without live HTTP", async () => {
    const adapter = new TradovateAdapter(credentials, "paper");
    const status = await adapter.getOrderStatus("tv-order-1");

    expect(status).toEqual({
      brokerOrderId: "tv-order-1",
      status: "closed",
      latestPrice: null,
      realizedPnlUsd: 0,
    });
    expect(await adapter.getPositions()).toEqual([]);
  });
});

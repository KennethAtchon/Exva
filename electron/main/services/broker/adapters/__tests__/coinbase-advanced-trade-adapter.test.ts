import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoinbaseAdvancedTradeAdapter } from "../coinbase-advanced-trade-adapter";

const mockExchange = vi.hoisted(() => ({
  fetchBalance: vi.fn(),
  fetchTicker: vi.fn(),
  loadMarkets: vi.fn(),
  createMarketBuyOrder: vi.fn(),
  createMarketSellOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrder: vi.fn(),
}));

vi.mock("ccxt", () => ({
  default: {
    coinbaseadvanced: vi.fn(function () {
      return mockExchange;
    }),
  },
}));

describe("CoinbaseAdvancedTradeAdapter", () => {
  const credentials = {
    apiKey: "cb-key",
    apiSecret: "cb-secret",
    passphrase: "cb-pass",
  };

  beforeEach(() => {
    mockExchange.fetchBalance.mockReset();
    mockExchange.fetchTicker.mockReset();
    mockExchange.loadMarkets.mockReset();
    mockExchange.createMarketBuyOrder.mockReset();
    mockExchange.createMarketSellOrder.mockReset();
    mockExchange.cancelOrder.mockReset();
    mockExchange.fetchOrder.mockReset();

    mockExchange.fetchBalance.mockResolvedValue({
      USD: { total: 1200 },
      USDC: { total: 300 },
    });
    mockExchange.fetchTicker.mockResolvedValue({
      last: 50_000,
      close: 50_000,
      bid: 49_900,
      datetime: "2026-06-13T12:00:00.000Z",
    });
    mockExchange.loadMarkets.mockResolvedValue({});
    mockExchange.createMarketBuyOrder.mockResolvedValue({
      id: "cb-buy-1",
      average: 50_000,
      price: 50_000,
    });
    mockExchange.createMarketSellOrder.mockResolvedValue({
      id: "cb-sell-1",
      average: 50_000,
      price: 50_000,
    });
    mockExchange.fetchOrder.mockResolvedValue({
      id: "cb-1",
      status: "closed",
      average: 50_000,
    });
  });

  it("rejects paper mode because Coinbase has no paper API", async () => {
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "paper");

    await expect(adapter.testConnection()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("no paper API"),
    });
    await expect(
      adapter.placeOrder({
        instrumentSymbol: "BTC-USD",
        instrumentType: "crypto",
        side: "BUY",
        sizeUsd: 100,
        clientOrderId: "cb-1",
      }),
    ).rejects.toThrow(/paper mode/i);
  });

  it("connects and reads USD balance in live mode", async () => {
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");

    const connection = await adapter.testConnection();
    const balance = await adapter.getAccountBalance();

    expect(connection).toMatchObject({
      ok: true,
      account_balance: 1500,
    });
    expect(balance).toBe(1500);
    expect(mockExchange.fetchBalance).toHaveBeenCalled();
  });

  it("places crypto market buy orders via CCXT", async () => {
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");
    const quote = await adapter.getMarketSnapshot("BTC-USD");
    const order = await adapter.placeOrder({
      instrumentSymbol: "BTC-USD",
      instrumentType: "crypto",
      side: "BUY",
      sizeUsd: 250,
      clientOrderId: "cb-buy",
    });

    expect(quote.price).toBe(50_000);
    expect(order).toEqual({
      brokerOrderId: "cb-buy-1",
      filledAvgPrice: 50_000,
    });
    expect(mockExchange.createMarketBuyOrder).toHaveBeenCalledWith(
      "BTC/USD",
      250,
    );
  });

  it("rejects non-crypto instruments", async () => {
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 250,
        clientOrderId: "cb-stock",
      }),
    ).rejects.toThrow(/crypto only/i);
  });

  it("throws BROKER_DATA when ticker price is missing", async () => {
    mockExchange.fetchTicker.mockResolvedValue({
      last: undefined,
      close: undefined,
      bid: undefined,
    });
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");

    await expect(adapter.getMarketSnapshot("BTC-USD")).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("throws BROKER_DATA when buy fill average is missing", async () => {
    mockExchange.createMarketBuyOrder.mockResolvedValue({
      id: "cb-buy-bad",
      average: undefined,
      price: undefined,
    });
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "BTC-USD",
        instrumentType: "crypto",
        side: "BUY",
        sizeUsd: 100,
        clientOrderId: "cb-bad-fill",
      }),
    ).rejects.toMatchObject({ code: "BROKER_DATA" });
  });

  it("allows explicit zero USD balance when USDC is present", async () => {
    mockExchange.fetchBalance.mockResolvedValue({
      USD: { total: 0 },
      USDC: { total: 50 },
    });
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");
    await expect(adapter.getAccountBalance()).resolves.toBe(50);
  });

  it("throws BROKER_DATA when quote currency totals are missing", async () => {
    mockExchange.fetchBalance.mockResolvedValue({
      BTC: { total: 1 },
    });
    const adapter = new CoinbaseAdvancedTradeAdapter(credentials, "live");
    await expect(adapter.getAccountBalance()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });
});

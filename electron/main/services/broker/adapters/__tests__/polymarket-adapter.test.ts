import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolymarketAdapter } from "../polymarket-adapter";

const clobClientMethods = vi.hoisted(() => ({
  getOk: vi.fn(),
  getBalanceAllowance: vi.fn(),
  getMarket: vi.fn(),
  getLastTradePrice: vi.fn(),
  getTickSize: vi.fn(),
  createAndPostMarketOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrder: vi.fn(),
  createOrDeriveApiKey: vi.fn(),
}));

vi.mock("@polymarket/clob-client", () => ({
  AssetType: { COLLATERAL: "COLLATERAL" },
  OrderType: { FOK: "FOK" },
  Side: { BUY: "BUY", SELL: "SELL" },
  ClobClient: vi.fn(function () {
    return clobClientMethods;
  }),
}));

vi.mock("viem", () => ({
  createWalletClient: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({})),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137 },
}));

describe("PolymarketAdapter", () => {
  const credentials = {
    privateKey:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    funderAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  };
  const metadata = JSON.stringify({
    conditionId: "cond-1",
    outcomeTokenId: "token-yes-1",
    slug: "will-x-happen",
  });

  beforeEach(() => {
    Object.values(clobClientMethods).forEach((fn) => fn.mockReset());
    clobClientMethods.getOk.mockResolvedValue(true);
    clobClientMethods.getBalanceAllowance.mockResolvedValue({ balance: "750" });
    clobClientMethods.getMarket.mockResolvedValue({
      question: "Will event X happen?",
      tokens: [{ outcome: "YES", price: "0.62" }],
      endDate: "2026-12-31T00:00:00.000Z",
    });
    clobClientMethods.getLastTradePrice.mockResolvedValue(0.62);
    clobClientMethods.getTickSize.mockResolvedValue("0.01");
    clobClientMethods.createOrDeriveApiKey.mockResolvedValue({
      apiKey: "pm-key",
      secret: "pm-secret",
      passphrase: "pm-pass",
    });
    clobClientMethods.createAndPostMarketOrder.mockResolvedValue({
      orderID: "pm-order-1",
    });
    clobClientMethods.getOrder.mockResolvedValue({
      id: "pm-order-1",
      status: "matched",
      asset_id: "token-yes-1",
      size_matched: "10",
      original_size: "10",
      market: "cond-1",
    });
  });

  it("connects and reads collateral balance", async () => {
    const adapter = new PolymarketAdapter(credentials);

    const connection = await adapter.testConnection();
    const balance = await adapter.getAccountBalance();

    expect(connection).toMatchObject({
      ok: true,
      account_balance: 750,
    });
    expect(balance).toBe(750);
    expect(clobClientMethods.getOk).toHaveBeenCalled();
  });

  it("fetches prediction market snapshots", async () => {
    const adapter = new PolymarketAdapter(credentials);
    const quote = await adapter.getMarketSnapshot("pm:cond-1");

    expect(quote).toMatchObject({
      instrumentSymbol: "pm:cond-1",
      instrumentDisplayName: "Will event X happen?",
      predictionOutcome: "YES",
      price: 0.62,
    });
  });

  it("places prediction market buy orders with metadata", async () => {
    const adapter = new PolymarketAdapter(credentials);
    const order = await adapter.placeOrder({
      instrumentSymbol: "pm:cond-1",
      instrumentType: "prediction_market",
      side: "BUY",
      sizeUsd: 100,
      clientOrderId: "pm-client-1",
      instrumentMetadataJson: metadata,
    });

    expect(order).toEqual({
      brokerOrderId: "pm-order-1",
      filledAvgPrice: 0.62,
    });
    expect(clobClientMethods.createAndPostMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenID: "token-yes-1",
        side: "BUY",
        amount: 100,
      }),
      expect.any(Object),
      "FOK",
    );
  });

  it("closes matched orders with an opposite-side market order", async () => {
    const adapter = new PolymarketAdapter(credentials);
    const closed = await adapter.closeOrder("pm-order-1");

    expect(closed.brokerOrderId).toBe("pm-order-1");
    expect(clobClientMethods.createAndPostMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenID: "token-yes-1",
        side: "SELL",
        amount: 10,
      }),
      expect.any(Object),
      "FOK",
    );
  });

  it("rejects orders without prediction metadata", async () => {
    const adapter = new PolymarketAdapter(credentials);

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "pm:cond-1",
        instrumentType: "prediction_market",
        side: "BUY",
        sizeUsd: 100,
        clientOrderId: "pm-missing-meta",
      }),
    ).rejects.toThrow(/metadata/i);
  });
});

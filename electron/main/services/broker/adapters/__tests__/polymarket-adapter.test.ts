import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolymarketAdapter } from "../polymarket-adapter";
import {
  DEFAULT_PAPER_STARTING_BALANCE_USD,
  PaperBalancesRepo,
} from "../../../../db/repositories/brokers/paper-balances-repo";
import { PaperPositionsRepo } from "../../../../db/repositories/brokers/paper-positions-repo";
import { BrokerAccountsRepo } from "../../../../db/repositories/brokers/broker-accounts-repo";
import { createTestDb } from "../../../../db/test-helpers";

const clobClientMethods = vi.hoisted(() => ({
  getOk: vi.fn(),
  getBalanceAllowance: vi.fn(),
  getMarket: vi.fn(),
  getLastTradePrice: vi.fn(),
  getTickSize: vi.fn(),
  createAndPostMarketOrder: vi.fn(),
  createAndPostOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrder: vi.fn(),
  createOrDeriveApiKey: vi.fn(),
}));

vi.mock("@polymarket/clob-client", () => ({
  AssetType: { COLLATERAL: "COLLATERAL" },
  OrderType: { FOK: "FOK", GTC: "GTC" },
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
      tokens: [
        { token_id: "token-yes-1", outcome: "YES", price: "0.62" },
        { token_id: "token-no-1", outcome: "NO", price: "0.38" },
      ],
      endDate: "2026-12-31T00:00:00.000Z",
      closed: false,
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            conditionId: "cond-1",
            closed: false,
            tokens: [
              { token_id: "token-yes-1", outcome: "YES", price: "0.62" },
            ],
          },
        ]),
      ),
    );
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

  describe("ghost (paper) mode", () => {
    const buy = {
      instrumentSymbol: "pm:cond-1",
      instrumentType: "prediction_market" as const,
      side: "BUY" as const,
      sizeUsd: 100,
      clientOrderId: "ghost-1",
      instrumentMetadataJson: metadata,
    };

    it("fills locally against the real price without posting to the CLOB", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const order = await adapter.placeOrder(buy);

      expect(order.brokerOrderId).toMatch(/^ghost-/);
      expect(order.filledAvgPrice).toBeCloseTo(0.62, 2);
      expect(clobClientMethods.createAndPostMarketOrder).not.toHaveBeenCalled();
    });

    it("deducts the cost from the paper balance and credits proceeds on close", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const order = await adapter.placeOrder(buy);

      const afterBuy = await adapter.getAccountBalance();
      expect(afterBuy).toBeLessThan(DEFAULT_PAPER_STARTING_BALANCE_USD);

      clobClientMethods.getLastTradePrice.mockResolvedValue(0.8);
      const closed = await adapter.closeOrder(order.brokerOrderId);
      expect(closed.realizedPnlUsd).toBeGreaterThan(0);
      expect(await adapter.getAccountBalance()).toBeGreaterThan(afterBuy);
    });

    it("reports a ghost order open until the real market resolves", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const order = await adapter.placeOrder(buy);

      const status = await adapter.getOrderStatus(order.brokerOrderId);
      expect(status.status).toBe("open");
    });

    it("rejects a ghost buy that exceeds the paper balance", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      await expect(
        adapter.placeOrder({ ...buy, sizeUsd: 999_999 }),
      ).rejects.toMatchObject({ code: "BROKER_INSUFFICIENT_FUNDS" });
    });

    it("testConnection reports ghost mode with the paper balance", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const conn = await adapter.testConnection();
      expect(conn).toMatchObject({
        ok: true,
        account_balance: DEFAULT_PAPER_STARTING_BALANCE_USD,
      });
      expect(conn.message).toMatch(/ghost|paper/i);
    });

    it("rests non-marketable limits then fills on quote cross", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const placed = await adapter.placeOrderV2?.({
        clientOrderId: "limit-rest-1",
        instrument: {
          symbol: "pm:cond-1",
          instrumentClass: "prediction_market",
          metadataJson: metadata,
        },
        side: "BUY",
        quantity: { kind: "units", value: 10 },
        orderType: "limit",
        limitPrice: 0.4,
        timeInForce: "gtc",
      });
      expect(placed).toBeDefined();
      if (!placed) throw new Error("expected placed order");
      expect(placed.brokerOrderId).toMatch(/^ghost-/);
      const open = await adapter.getOpenOrders?.();
      expect(open).toHaveLength(1);

      clobClientMethods.getLastTradePrice.mockResolvedValue(0.35);
      const status = await adapter.getOrderStatus(placed.brokerOrderId);
      expect(status.status).toBe("open");
      expect(await adapter.getOpenOrders?.()).toHaveLength(0);
    });

    it("cancels resting ghost limits", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const placed = await adapter.placeOrderV2?.({
        clientOrderId: "limit-cancel-1",
        instrument: {
          symbol: "pm:cond-1",
          instrumentClass: "prediction_market",
          metadataJson: metadata,
        },
        side: "BUY",
        quantity: { kind: "units", value: 5 },
        orderType: "limit",
        limitPrice: 0.1,
        timeInForce: "gtc",
      });
      expect(placed).toBeDefined();
      if (!placed) throw new Error("expected placed order");
      await adapter.cancelOrder(placed.brokerOrderId);
      expect(await adapter.getOpenOrders?.()).toHaveLength(0);
      const status = await adapter.getOrderStatus(placed.brokerOrderId);
      expect(status.status).toBe("closed");
    });

    it("settles ghost positions at real resolution outcome prices", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const order = await adapter.placeOrder(buy);
      clobClientMethods.getMarket.mockResolvedValue({
        question: "Will event X happen?",
        tokens: [
          {
            token_id: "token-yes-1",
            outcome: "YES",
            price: "1",
            winner: true,
          },
          {
            token_id: "token-no-1",
            outcome: "NO",
            price: "0",
            winner: false,
          },
        ],
        endDate: "2020-01-01T00:00:00.000Z",
        closed: true,
      });
      const status = await adapter.getOrderStatus(order.brokerOrderId);
      expect(status.status).toBe("closed");
      expect(status.realizedPnlUsd).not.toBeNull();
      // Bought YES at ~0.62; settles at 1 → profit
      expect(status.realizedPnlUsd).toBeGreaterThan(0);
    });

    it("exposes an OrderEventFeed for ghost fills", async () => {
      const adapter = new PolymarketAdapter(credentials, "paper");
      const feed = adapter.createOrderEventFeed?.();
      expect(feed).toMatchObject({
        start: expect.any(Function),
        stop: expect.any(Function),
        onEvent: expect.any(Function),
      });
      await feed?.stop();
    });

    it("calls onParityWarning when gamma market is missing", async () => {
      const onParityWarning = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json([])),
      );
      const adapter = new PolymarketAdapter(credentials, "paper", undefined, {
        onParityWarning,
      });
      await adapter.placeOrder(buy);
      expect(onParityWarning).toHaveBeenCalled();
    });

    describe("restart rehydration (persisted paper positions)", () => {
      function setupPersistence() {
        const db = createTestDb();
        const accounts = new BrokerAccountsRepo(db);
        accounts.insert({
          id: "pm-paper-restart",
          name: "Polymarket Paper",
          brokerType: "polymarket",
          supportedInstrumentClasses: ["prediction_market"],
          mode: "paper",
          secretRef: "secret:pm-paper-restart",
        });
        const paperBalances = new PaperBalancesRepo(db);
        const paperPositions = new PaperPositionsRepo(db);
        return { db, paperBalances, paperPositions };
      }

      it("survives an adapter rebuild: filled ghost positions rehydrate from the persisted store", async () => {
        const { db, paperBalances, paperPositions } = setupPersistence();
        const firstAdapter = new PolymarketAdapter(
          credentials,
          "paper",
          undefined,
          { accountId: "pm-paper-restart", paperBalances, paperPositions },
        );
        const order = await firstAdapter.placeOrder(buy);

        // Simulate app restart: brand-new adapter instance, no in-memory state.
        const rebuiltAdapter = new PolymarketAdapter(
          credentials,
          "paper",
          undefined,
          { accountId: "pm-paper-restart", paperBalances, paperPositions },
        );

        const status = await rebuiltAdapter.getOrderStatus(order.brokerOrderId);
        expect(status.status).toBe("open");

        clobClientMethods.getLastTradePrice.mockResolvedValue(0.8);
        const closed = await rebuiltAdapter.closeOrder(order.brokerOrderId);
        expect(closed.realizedPnlUsd).toBeGreaterThan(0);
        expect(paperPositions.get(order.brokerOrderId)?.open).toBe(false);
        db.sqlite.close();
      });

      it("survives an adapter rebuild: resting ghost limits rehydrate and can be canceled", async () => {
        const { db, paperBalances, paperPositions } = setupPersistence();
        const firstAdapter = new PolymarketAdapter(
          credentials,
          "paper",
          undefined,
          { accountId: "pm-paper-restart", paperBalances, paperPositions },
        );
        const placed = await firstAdapter.placeOrderV2?.({
          clientOrderId: "limit-restart-1",
          instrument: {
            symbol: "pm:cond-1",
            instrumentClass: "prediction_market",
            metadataJson: metadata,
          },
          side: "BUY",
          quantity: { kind: "units", value: 10 },
          orderType: "limit",
          limitPrice: 0.4,
          timeInForce: "gtc",
        });
        expect(placed).toBeDefined();
        if (!placed) throw new Error("expected placed order");
        expect(paperPositions.get(placed.brokerOrderId)?.resting).toBe(true);

        const rebuiltAdapter = new PolymarketAdapter(
          credentials,
          "paper",
          undefined,
          { accountId: "pm-paper-restart", paperBalances, paperPositions },
        );
        await rebuiltAdapter.cancelOrder(placed.brokerOrderId);
        const status = await rebuiltAdapter.getOrderStatus(
          placed.brokerOrderId,
        );
        expect(status.status).toBe("closed");
        db.sqlite.close();
      });

      it("survives an adapter rebuild: resting ghost limits rehydrate and fill on quote cross with a single debit", async () => {
        const { db, paperBalances, paperPositions } = setupPersistence();
        const firstAdapter = new PolymarketAdapter(
          credentials,
          "paper",
          undefined,
          { accountId: "pm-paper-restart", paperBalances, paperPositions },
        );
        const placed = await firstAdapter.placeOrderV2?.({
          clientOrderId: "limit-restart-fill-1",
          instrument: {
            symbol: "pm:cond-1",
            instrumentClass: "prediction_market",
            metadataJson: metadata,
          },
          side: "BUY",
          quantity: { kind: "units", value: 10 },
          orderType: "limit",
          limitPrice: 0.4,
          timeInForce: "gtc",
        });
        expect(placed).toBeDefined();
        if (!placed) throw new Error("expected placed order");

        // Never marketable on the placing instance — stays resting.
        const balanceBeforeFill = paperBalances.getBalance("pm-paper-restart");

        const rebuiltAdapter = new PolymarketAdapter(
          credentials,
          "paper",
          undefined,
          { accountId: "pm-paper-restart", paperBalances, paperPositions },
        );
        // Ask crosses below the resting limit — now marketable.
        clobClientMethods.getLastTradePrice.mockResolvedValue(0.35);
        const status = await rebuiltAdapter.getOrderStatus(
          placed.brokerOrderId,
        );
        expect(status.status).toBe("open");
        expect(paperPositions.get(placed.brokerOrderId)?.resting).toBe(false);
        expect(paperBalances.getBalance("pm-paper-restart")).toBeLessThan(
          balanceBeforeFill,
        );

        // A second status check must not double-debit.
        const balanceAfterFirstFill =
          paperBalances.getBalance("pm-paper-restart");
        await rebuiltAdapter.getOrderStatus(placed.brokerOrderId);
        expect(paperBalances.getBalance("pm-paper-restart")).toBe(
          balanceAfterFirstFill,
        );
        db.sqlite.close();
      });
    });
  });
});

describe("PolymarketAdapter money-field validation", () => {
  const credentials = {
    privateKey:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    funderAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  };

  beforeEach(() => {
    Object.values(clobClientMethods).forEach((fn) => fn.mockReset());
    clobClientMethods.getOk.mockResolvedValue(true);
    clobClientMethods.createOrDeriveApiKey.mockResolvedValue({
      apiKey: "pm-key",
      secret: "pm-secret",
      passphrase: "pm-pass",
    });
  });

  it("throws BROKER_DATA when collateral balance is missing", async () => {
    clobClientMethods.getBalanceAllowance.mockResolvedValue({});
    const adapter = new PolymarketAdapter(credentials);
    await expect(adapter.getAccountBalance()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("throws BROKER_DATA when market snapshot has no token price", async () => {
    clobClientMethods.getMarket.mockResolvedValue({
      question: "Will event X happen?",
      tokens: [{ token_id: "token-yes-1", outcome: "YES" }],
    });
    const adapter = new PolymarketAdapter(credentials);
    await expect(adapter.getMarketSnapshot("pm:cond-1")).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("throws BROKER_DATA when limit+notional is missing limitPrice", async () => {
    const adapter = new PolymarketAdapter(credentials, "live");
    await expect(
      adapter.placeOrderV2({
        clientOrderId: "pm-no-limit",
        instrument: {
          symbol: "pm:cond-1",
          instrumentClass: "prediction_market",
          metadataJson: JSON.stringify({
            conditionId: "cond-1",
            outcomeTokenId: "token-yes-1",
          }),
        },
        side: "BUY",
        quantity: { kind: "notional_usd", value: 25 },
        orderType: "limit",
        timeInForce: "gtc",
        // limitPrice intentionally omitted
      }),
    ).rejects.toMatchObject({ code: "BROKER_DATA" });
  });
});

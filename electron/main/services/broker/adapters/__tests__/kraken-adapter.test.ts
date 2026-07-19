import { beforeEach, describe, expect, it, vi } from "vitest";
import { KrakenAdapter } from "../kraken-adapter";
import {
  DEFAULT_PAPER_STARTING_BALANCE_USD,
  PaperBalancesRepo,
} from "../../../../db/repositories/brokers/paper-balances-repo";
import { PaperPositionsRepo } from "../../../../db/repositories/brokers/paper-positions-repo";
import { BrokerAccountsRepo } from "../../../../db/repositories/brokers/broker-accounts-repo";
import { createTestDb } from "../../../../db/test-helpers";

interface PriceState {
  price: number;
  bid: number;
  ask: number;
}

/** Minimal Kraken REST double: public ticker + private AddOrder/Balance/etc. */
function stubKrakenFetch(state: PriceState): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/0/public/Ticker")) {
      return Response.json({
        error: [],
        result: {
          XXBTZUSD: {
            c: [String(state.price)],
            b: [String(state.bid)],
            a: [String(state.ask)],
            v: ["10", "10"],
          },
        },
      });
    }
    if (u.includes("/0/private/AddOrder")) {
      return Response.json({
        error: [],
        result: { descr: { order: "validated" } },
      });
    }
    if (u.includes("/0/private/Balance")) {
      return Response.json({ error: [], result: { ZUSD: "500" } });
    }
    if (u.includes("/0/private/CancelOrder")) {
      return Response.json({ error: [] });
    }
    if (u.includes("/0/private/QueryOrders")) {
      return Response.json({ error: [], result: { open: {}, closed: {} } });
    }
    return Response.json({ error: ["Unknown endpoint"] });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("KrakenAdapter", () => {
  const credentials = {
    apiKey: "kraken-key",
    apiSecret: Buffer.from("kraken-secret").toString("base64"),
  };
  let priceState: PriceState;

  beforeEach(() => {
    priceState = { price: 50_000, bid: 49_990, ask: 50_010 };
    stubKrakenFetch(priceState);
  });

  it("reports the paper balance without hitting the real Balance endpoint", async () => {
    const fetchSpy = stubKrakenFetch(priceState);
    const adapter = new KrakenAdapter(credentials, "paper");
    const balance = await adapter.getAccountBalance();
    expect(balance).toBe(DEFAULT_PAPER_STARTING_BALANCE_USD);
    expect(
      fetchSpy.mock.calls.some((c) => String(c[0]).includes("/Balance")),
    ).toBe(false);
  });

  describe("ghost (paper) mode", () => {
    const buy = {
      instrumentSymbol: "BTC/USD",
      instrumentType: "crypto" as const,
      side: "BUY" as const,
      sizeUsd: 300,
      clientOrderId: "k-buy-1",
    };

    it("fills a ghost market buy locally and debits the paper balance", async () => {
      const adapter = new KrakenAdapter(credentials, "paper");
      const order = await adapter.placeOrder(buy);

      expect(order.brokerOrderId).toMatch(/^ghost-/);
      expect(order.filledAvgPrice).toBeGreaterThan(0);
      expect(order.filledSizeUsd).toBeDefined();
      const balance = await adapter.getAccountBalance();
      expect(balance).toBe(
        DEFAULT_PAPER_STARTING_BALANCE_USD - (order.filledSizeUsd ?? 0),
      );
    });

    it("rejects a ghost buy that exceeds the paper balance", async () => {
      const adapter = new KrakenAdapter(credentials, "paper");
      await expect(
        adapter.placeOrder({ ...buy, sizeUsd: 999_999 }),
      ).rejects.toMatchObject({ code: "BROKER_INSUFFICIENT_FUNDS" });
    });

    it("returns ghost positions rather than real balances in paper mode", async () => {
      const adapter = new KrakenAdapter(credentials, "paper");
      await adapter.placeOrder(buy);

      const positions = await adapter.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({
        instrumentSymbol: "BTC/USD",
        instrumentType: "crypto",
        side: "long",
      });
    });

    it("credits proceeds and computes realized P&L on close, idempotently", async () => {
      const adapter = new KrakenAdapter(credentials, "paper");
      const order = await adapter.placeOrder(buy);
      const afterBuy = await adapter.getAccountBalance();
      expect(afterBuy).toBeLessThan(DEFAULT_PAPER_STARTING_BALANCE_USD);

      priceState.price = 60_000;
      priceState.bid = 59_990;
      priceState.ask = 60_010;
      const closed = await adapter.closeOrder(order.brokerOrderId);
      expect(closed.realizedPnlUsd).toBeGreaterThan(0);
      const afterClose = await adapter.getAccountBalance();
      expect(afterClose).toBeGreaterThan(afterBuy);

      // Closing an already-closed ghost position must not re-credit.
      const closedAgain = await adapter.closeOrder(order.brokerOrderId);
      expect(closedAgain.realizedPnlUsd).toBe(0);
      expect(await adapter.getAccountBalance()).toBe(afterClose);
    });

    it("rests a non-marketable limit, then debits exactly once when the quote crosses", async () => {
      const adapter = new KrakenAdapter(credentials, "paper");
      const placed = await adapter.placeOrderV2?.({
        clientOrderId: "k-limit-1",
        instrument: { symbol: "BTC/USD", instrumentClass: "crypto" },
        side: "BUY",
        quantity: { kind: "units", value: 0.01 },
        orderType: "limit",
        limitPrice: 40_000,
        timeInForce: "gtc",
      });
      expect(placed).toBeDefined();
      if (!placed) throw new Error("expected placed order");
      expect(placed.brokerOrderId).toMatch(/^ghost-/);

      // Not marketable yet (limit below the ask) — no debit while resting.
      expect(await adapter.getAccountBalance()).toBe(
        DEFAULT_PAPER_STARTING_BALANCE_USD,
      );
      expect(await adapter.getPositions()).toHaveLength(0);

      // Cross the quote so the resting limit becomes marketable.
      priceState.price = 39_000;
      priceState.bid = 38_990;
      priceState.ask = 39_990;
      await adapter.getOrderStatus(placed.brokerOrderId);
      const balanceAfterFill = await adapter.getAccountBalance();
      expect(balanceAfterFill).toBeLessThan(DEFAULT_PAPER_STARTING_BALANCE_USD);
      expect(await adapter.getPositions()).toHaveLength(1);

      // Re-polling an already-filled order must not double-debit.
      await adapter.getOrderStatus(placed.brokerOrderId);
      expect(await adapter.getAccountBalance()).toBe(balanceAfterFill);
    });

    it("cancels a resting ghost limit without ever debiting", async () => {
      const adapter = new KrakenAdapter(credentials, "paper");
      const placed = await adapter.placeOrderV2?.({
        clientOrderId: "k-limit-cancel-1",
        instrument: { symbol: "BTC/USD", instrumentClass: "crypto" },
        side: "BUY",
        quantity: { kind: "units", value: 0.01 },
        orderType: "limit",
        limitPrice: 1,
        timeInForce: "gtc",
      });
      expect(placed).toBeDefined();
      if (!placed) throw new Error("expected placed order");

      await adapter.cancelOrder(placed.brokerOrderId);
      const status = await adapter.getOrderStatus(placed.brokerOrderId);
      expect(status.status).toBe("closed");
      expect(await adapter.getAccountBalance()).toBe(
        DEFAULT_PAPER_STARTING_BALANCE_USD,
      );
    });
  });

  describe("restart rehydration (persisted paper positions)", () => {
    function setupPersistence() {
      const db = createTestDb();
      const accounts = new BrokerAccountsRepo(db);
      accounts.insert({
        id: "kraken-paper-restart",
        name: "Kraken Paper",
        brokerType: "kraken",
        supportedInstrumentClasses: ["crypto"],
        mode: "paper",
        secretRef: "secret:kraken-paper-restart",
      });
      const paperBalances = new PaperBalancesRepo(db);
      const paperPositions = new PaperPositionsRepo(db);
      return { db, paperBalances, paperPositions };
    }

    it("survives an adapter rebuild: filled ghost positions rehydrate and close correctly", async () => {
      const { db, paperBalances, paperPositions } = setupPersistence();
      const first = new KrakenAdapter(credentials, "paper", undefined, {
        accountId: "kraken-paper-restart",
        paperBalances,
        paperPositions,
      });
      const order = await first.placeOrder({
        instrumentSymbol: "BTC/USD",
        instrumentType: "crypto",
        side: "BUY",
        sizeUsd: 1_000,
        clientOrderId: "k-restart-1",
      });

      // Simulate app restart: brand-new adapter instance, no in-memory state.
      const rebuilt = new KrakenAdapter(credentials, "paper", undefined, {
        accountId: "kraken-paper-restart",
        paperBalances,
        paperPositions,
      });
      const status = await rebuilt.getOrderStatus(order.brokerOrderId);
      expect(status.status).toBe("open");
      expect(await rebuilt.getPositions()).toHaveLength(1);

      priceState.price = 60_000;
      priceState.bid = 59_990;
      priceState.ask = 60_010;
      const closed = await rebuilt.closeOrder(order.brokerOrderId);
      expect(closed.realizedPnlUsd).toBeGreaterThan(0);
      expect(paperPositions.get(order.brokerOrderId)?.open).toBe(false);
      db.sqlite.close();
    });

    it("survives an adapter rebuild: resting ghost limits rehydrate and can be canceled", async () => {
      const { db, paperBalances, paperPositions } = setupPersistence();
      const first = new KrakenAdapter(credentials, "paper", undefined, {
        accountId: "kraken-paper-restart",
        paperBalances,
        paperPositions,
      });
      const placed = await first.placeOrderV2?.({
        clientOrderId: "k-restart-limit-1",
        instrument: { symbol: "BTC/USD", instrumentClass: "crypto" },
        side: "BUY",
        quantity: { kind: "units", value: 0.01 },
        orderType: "limit",
        limitPrice: 1,
        timeInForce: "gtc",
      });
      expect(placed).toBeDefined();
      if (!placed) throw new Error("expected placed order");
      expect(paperPositions.get(placed.brokerOrderId)?.resting).toBe(true);

      const rebuilt = new KrakenAdapter(credentials, "paper", undefined, {
        accountId: "kraken-paper-restart",
        paperBalances,
        paperPositions,
      });
      await rebuilt.cancelOrder(placed.brokerOrderId);
      const status = await rebuilt.getOrderStatus(placed.brokerOrderId);
      expect(status.status).toBe("closed");
      db.sqlite.close();
    });

    it("survives an adapter rebuild: resting ghost limits rehydrate and fill on quote cross with a single debit", async () => {
      const { db, paperBalances, paperPositions } = setupPersistence();
      const first = new KrakenAdapter(credentials, "paper", undefined, {
        accountId: "kraken-paper-restart",
        paperBalances,
        paperPositions,
      });
      const placed = await first.placeOrderV2?.({
        clientOrderId: "k-restart-limit-2",
        instrument: { symbol: "BTC/USD", instrumentClass: "crypto" },
        side: "BUY",
        quantity: { kind: "units", value: 0.01 },
        orderType: "limit",
        limitPrice: 40_000,
        timeInForce: "gtc",
      });
      expect(placed).toBeDefined();
      if (!placed) throw new Error("expected placed order");

      const rebuilt = new KrakenAdapter(credentials, "paper", undefined, {
        accountId: "kraken-paper-restart",
        paperBalances,
        paperPositions,
      });
      priceState.price = 39_000;
      priceState.bid = 38_990;
      priceState.ask = 39_990;
      await rebuilt.getOrderStatus(placed.brokerOrderId);

      const positions = await rebuilt.getPositions();
      expect(positions).toHaveLength(1);
      expect(paperBalances.getBalance("kraken-paper-restart")).toBeLessThan(
        DEFAULT_PAPER_STARTING_BALANCE_USD,
      );
      db.sqlite.close();
    });
  });
});

describe("KrakenAdapter money-field validation", () => {
  const credentials = {
    apiKey: "kraken-key",
    apiSecret: Buffer.from("kraken-secret").toString("base64"),
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/0/public/Ticker")) {
          return Response.json({ error: [], result: { XXBTZUSD: {} } });
        }
        if (u.includes("/0/private/Balance")) {
          return Response.json({ error: [], result: {} });
        }
        return Response.json({ error: ["Unknown endpoint"] });
      }),
    );
  });

  it("throws BROKER_DATA when ticker has no usable price", async () => {
    const adapter = new KrakenAdapter(credentials, "live");
    await expect(adapter.getMarketSnapshot("BTC/USD")).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("throws BROKER_DATA when live balance response is empty", async () => {
    const adapter = new KrakenAdapter(credentials, "live");
    await expect(adapter.getAccountBalance()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("allows explicit zero ticker volume", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/0/public/Ticker")) {
          return Response.json({
            error: [],
            result: {
              XXBTZUSD: {
                c: ["50000.0", "0.1"],
                b: ["49990.0", "1", "1"],
                a: ["50010.0", "1", "1"],
                v: ["0", "0"],
              },
            },
          });
        }
        return Response.json({ error: ["Unknown endpoint"] });
      }),
    );
    const adapter = new KrakenAdapter(credentials, "live");
    const snap = await adapter.getMarketSnapshot("BTC/USD");
    expect(snap.price).toBe(50000);
    expect(snap.volume).toBe(0);
  });
});

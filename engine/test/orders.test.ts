import { beforeEach, describe, expect, test } from "bun:test";
import { Orders } from "../src/broker/orders.ts";
import type { Broker, BrokerOrder, OrderRequest } from "../src/broker/types.ts";
import { SimClock } from "../src/core/clock.ts";
import { nullSink } from "../src/core/events.ts";
import { BrokerRejected, BrokerUnavailable } from "../src/errors.ts";
import { type OrderRow, Store } from "../src/store/store.ts";
import { bot, T0 } from "./helpers.ts";

/** Behaves like Alpaca: a filled entry order simply reports status "filled". */
class FakeAlpaca implements Broker {
  readonly kind = "alpaca" as const;
  orders = new Map<string, BrokerOrder>();
  mode: "ok" | "timeout" | "reject" | "lost" = "ok";
  positionQty = 0;
  canceled: string[] = [];

  async account() {
    return { equity: 100_000, cash: 100_000, buyingPower: 100_000, mode: "paper" as const };
  }
  async submit(req: OrderRequest): Promise<BrokerOrder> {
    if (this.mode === "reject") throw new BrokerRejected("Alpaca: insufficient qty");
    if (this.mode === "lost") throw new BrokerUnavailable("connection reset"); // never arrived
    const o: BrokerOrder = {
      brokerOrderId: `alp-${this.orders.size + 1}`,
      clientOrderId: req.clientOrderId,
      status: "submitted",
      filledQty: 0,
      avgFillPrice: null,
    };
    this.orders.set(req.clientOrderId, o);
    if (this.mode === "timeout") throw new BrokerUnavailable("timed out"); // the broker DID receive it
    return { ...o };
  }
  async getOrder(id: string) {
    return [...this.orders.values()].find((o) => o.brokerOrderId === id) ?? null;
  }
  async getByClientId(cid: string) {
    return this.orders.get(cid) ?? null;
  }
  async cancel(id: string) {
    this.canceled.push(id);
    const o = [...this.orders.values()].find((x) => x.brokerOrderId === id);
    if (o && o.status === "submitted") o.status = "canceled";
  }
  async positions() {
    return this.positionQty ? [{ symbol: "BTCUSD", qty: this.positionQty, avgPrice: 0 }] : [];
  }
  fill(
    cid: string,
    filledQty: number,
    avgFillPrice: number,
    status: BrokerOrder["status"] = "filled",
  ) {
    Object.assign(this.orders.get(cid) as BrokerOrder, {
      filledQty,
      avgFillPrice,
      status,
      filledAt: T0 + 1000,
    });
  }
}

describe("order lifecycle", () => {
  let store: Store;
  let broker: FakeAlpaca;
  let orders: Orders;
  let clock: SimClock;
  const b = bot();

  beforeEach(() => {
    store = Store.open(":memory:");
    store.upsertAccount({
      id: b.accountId,
      name: "Paper",
      broker: "alpaca",
      mode: "paper",
      startingCash: null,
      createdAt: T0,
    });
    store.saveBot(b);
    broker = new FakeAlpaca();
    clock = new SimClock(T0);
    orders = new Orders({
      store,
      brokerFor: () => broker,
      clock,
      events: nullSink,
    });
  });

  const buy = () =>
    orders.submit({
      bot: b,
      symbol: "BTC/USD",
      side: "buy",
      notional: 1000,
      refTs: T0,
      decisionId: null,
      reason: "signal",
    });

  test("REGRESSION: a filled entry opens a position and later polls keep it open", async () => {
    const o = await buy();
    broker.fill(o.clientOrderId, 0.01, 100_000);
    await orders.sync();
    await orders.sync(); // status stays "filled"; v1 read that as "trade closed by broker"
    const trade = store.openTrade(b.id, "BTC/USD");
    expect(trade?.status).toBe("open");
    expect(trade?.qty).toBeCloseTo(0.01, 10);
    expect(trade?.entryPrice).toBe(100_000);
    expect(store.fillsForOrders([o.id]).length).toBe(1);
    expect(store.getOrder(o.id)?.status).toBe("filled");
  });

  test("partial fills accumulate with the right prices and are never double counted", async () => {
    const o = await buy();
    broker.fill(o.clientOrderId, 0.004, 100, "partially_filled");
    await orders.sync();
    await orders.sync();
    broker.fill(o.clientOrderId, 0.01, 101);
    await orders.sync();
    const fills = store.fillsForOrders([o.id]);
    expect(fills.map((f) => f.qty)).toEqual([0.004, expect.closeTo(0.006, 10)]);
    expect(fills[1]?.price).toBeCloseTo((101 * 0.01 - 100 * 0.004) / 0.006, 8);
    expect(store.openTrade(b.id, "BTC/USD")?.entryPrice).toBeCloseTo(101, 8);
  });

  test("only filled sell quantity closes the position, with P&L", async () => {
    const entry = await buy();
    broker.fill(entry.clientOrderId, 0.01, 100_000);
    await orders.sync();
    const exit = await orders.submit({
      bot: b,
      symbol: "BTC/USD",
      side: "sell",
      qty: 0.01,
      refTs: T0,
      decisionId: null,
      reason: "signal",
    });
    expect(store.openTrade(b.id, "BTC/USD")).not.toBeNull(); // accepted, not filled yet
    broker.fill(exit.clientOrderId, 0.01, 110_000);
    await orders.sync();
    expect(store.openTrade(b.id, "BTC/USD")).toBeNull();
    const [closed] = store.listTrades({ botId: b.id });
    expect(closed?.pnlUsd).toBeCloseTo(100, 6);
    expect(closed?.pnlPct).toBeCloseTo(10, 6);
  });

  test("a fully filled exit that leaves only fee dust closes the trade", async () => {
    const entry = await buy();
    broker.fill(entry.clientOrderId, 0.01, 100_000);
    await orders.sync();
    const exit = await orders.submit({
      bot: b,
      symbol: "BTC/USD",
      side: "sell",
      qty: 0.009975,
      refTs: T0,
      decisionId: null,
      reason: "signal",
    });
    broker.fill(exit.clientOrderId, 0.009975, 100_000);
    await orders.sync();
    const [closed] = store.listTrades({ botId: b.id });
    expect(closed?.status).toBe("closed");
    expect(closed?.pnlUsd).toBeCloseTo(-2.5, 6); // the coin lost to fees is a real cost
  });

  test("a timed-out submit is reconciled by client order id, never resubmitted", async () => {
    broker.mode = "timeout";
    const o = await buy();
    expect(broker.orders.size).toBe(1);
    expect(o.status).toBe("submitted");
    expect(o.brokerOrderId).toBe("alp-1");
  });

  test("a rejected order is recorded with the broker's reason", async () => {
    broker.mode = "reject";
    const o = await buy();
    expect(o.status).toBe("rejected");
    expect(o.error).toContain("insufficient qty");
    expect(store.activeOrders().length).toBe(0);
  });

  test("a fill reported without a price waits for the next poll instead of being lost", async () => {
    const o = await buy();
    broker.fill(o.clientOrderId, 0.01, 0); // filled_avg_price not published yet
    await orders.sync();
    expect(store.getOrder(o.id)?.status).toBe("submitted");
    expect(store.getOrder(o.id)?.filledQty).toBe(0);
    expect(store.openTrade(b.id, "BTC/USD")).toBeNull();
    broker.fill(o.clientOrderId, 0.01, 100_000);
    await orders.sync();
    expect(store.getOrder(o.id)?.status).toBe("filled");
    expect(store.openTrade(b.id, "BTC/USD")?.qty).toBeCloseTo(0.01, 10);
  });

  test("a finished order never moves back to working", async () => {
    const o = await buy();
    broker.fill(o.clientOrderId, 0.01, 100_000);
    await orders.sync();
    // A stale or out-of-order broker response.
    orders.apply(store.getOrder(o.id) as OrderRow, {
      brokerOrderId: "alp-1",
      clientOrderId: o.clientOrderId,
      status: "submitted",
      filledQty: 0.01,
      avgFillPrice: 100_000,
    });
    expect(store.getOrder(o.id)?.status).toBe("filled");
    expect(store.activeOrders().length).toBe(0);
  });

  test("orders the broker can't find are written off after two minutes", async () => {
    const known = await buy();
    broker.orders.delete(known.clientOrderId); // acknowledged, then gone (e.g. account reset)
    broker.mode = "lost";
    const lost = await buy(); // never reached the broker
    expect(lost.status).toBe("submit_unknown");
    clock.set(T0 + 60_000);
    await orders.sync();
    expect(store.activeOrders().length).toBe(2); // a short grace period
    clock.set(T0 + 130_000);
    await orders.sync();
    expect(store.getOrder(known.id)?.status).toBe("canceled");
    expect(store.getOrder(lost.id)?.status).toBe("rejected");
  });

  test("a market order still working after 30 minutes of open market is canceled once", async () => {
    const o = await buy();
    clock.set(T0 + 29 * 60_000);
    await orders.sync();
    expect(broker.canceled).toEqual([]);
    clock.set(T0 + 31 * 60_000);
    await orders.sync();
    expect(broker.canceled).toEqual(["alp-1"]);
    await orders.sync();
    expect(store.getOrder(o.id)?.status).toBe("canceled");
    expect(broker.canceled.length).toBe(1);
  });

  test("a stock order queued while the market is closed is not treated as stuck", async () => {
    const queued = new Orders({
      store,
      brokerFor: () => broker,
      clock,
      events: nullSink,
      marketOpen: () => false,
    });
    await buy();
    clock.set(T0 + 8 * 3_600_000);
    await queued.sync();
    expect(broker.canceled).toEqual([]);
  });

  test("exits sell what the broker holds; a position the broker no longer has is closed", async () => {
    const entry = await buy();
    broker.fill(entry.clientOrderId, 0.01, 100_000);
    await orders.sync();
    const trade = store.openTrade(b.id, "BTC/USD");
    if (!trade) throw new Error("no trade");
    broker.positionQty = 0.009975; // the buy fee was taken in coin
    expect(await orders.sellableQty(trade)).toBeCloseTo(0.009975, 10);
    broker.positionQty = 0; // sold in Alpaca's dashboard
    expect(await orders.sellableQty(trade)).toBe(0);
    const closed = orders.closeOutside(trade, T0 + 5_000);
    expect(closed.status).toBe("closed");
    expect(closed.exitReason).toBe("closed_outside_exva");
    expect(closed.pnlUsd).toBeNull();
    expect(store.openTrade(b.id, "BTC/USD")).toBeNull();
  });

  test("cancelWorking cancels a bot's working entry orders", async () => {
    const o = await buy();
    expect(await orders.cancelWorking(b.id, "buy")).toBe(1);
    expect(store.getOrder(o.id)?.status).toBe("canceled");
  });
});

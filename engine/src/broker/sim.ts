// The built-in Simulator account. Used by every backtest, by demo mode, and by sim accounts.
// Market orders fill at the open of the first bar at or after the decision time, plus slippage and fees.
import type { Side } from "@shared/types.ts";
import type { Clock } from "../core/clock.ts";
import type { Store } from "../store/store.ts";
import type { Broker, BrokerAccount, BrokerOrder, BrokerPosition, OrderRequest } from "./types.ts";

export interface PriceSource {
  /** Open of the first bar starting at or after `ts` that had closed by `now`, if any. */
  firstOpenAtOrAfter(
    symbol: string,
    ts: number,
    now: number,
  ): Promise<{ price: number; ts: number } | null>;
  /** Latest known close by `now`, for marking positions. */
  lastClose(symbol: string, now: number): number | null;
}

interface Pending {
  req: OrderRequest;
  result: BrokerOrder;
}

export class SimBroker implements Broker {
  readonly kind = "sim" as const;
  private readonly orders = new Map<string, Pending>();

  constructor(
    private readonly o: {
      accountId: string;
      store: Store;
      prices: PriceSource;
      clock: Clock;
      startingCash: number;
      slippageBps: number;
      feeBps: number;
    },
  ) {}

  private cache: { version: number; cash: number; holdings: Map<string, number> } | null = null;

  /** Cash and holdings from this account's fills, recomputed only when a fill was added. */
  private holdings(): { cash: number; holdings: Map<string, number> } {
    const version = this.o.store.fillVersion;
    if (!this.cache || this.cache.version !== version) {
      const { cashDelta, holdings } = this.o.store.ledger(this.o.accountId);
      this.cache = { version, cash: this.o.startingCash + cashDelta, holdings };
    }
    return this.cache;
  }

  async account(): Promise<BrokerAccount> {
    const { cash, holdings } = this.holdings();
    const now = this.o.clock.now();
    let value = 0;
    for (const [symbol, qty] of holdings)
      value += qty * (this.o.prices.lastClose(symbol, now) ?? 0);
    let reserved = 0;
    for (const p of this.orders.values()) {
      if (p.req.side === "buy" && p.result.status === "submitted") reserved += p.req.notional ?? 0;
    }
    return { equity: cash + value, cash, buyingPower: Math.max(0, cash - reserved), mode: "sim" };
  }

  async positions(): Promise<BrokerPosition[]> {
    const { holdings } = this.holdings();
    return [...holdings]
      .filter(([, qty]) => Math.abs(qty) > 1e-12)
      .map(([symbol, qty]) => ({ symbol, qty, avgPrice: 0 }));
  }

  async submit(req: OrderRequest): Promise<BrokerOrder> {
    const brokerOrderId = `sim-${req.clientOrderId}`;
    const result: BrokerOrder = {
      brokerOrderId,
      clientOrderId: req.clientOrderId,
      status: "submitted",
      filledQty: 0,
      avgFillPrice: null,
    };
    if (req.side === "sell") {
      const held = this.holdings().holdings.get(req.symbol) ?? 0;
      if ((req.qty ?? 0) > held + 1e-9)
        Object.assign(result, { status: "rejected", error: "Not enough shares to sell" });
    } else if ((req.notional ?? 0) > (await this.account()).buyingPower + 1e-6) {
      Object.assign(result, { status: "rejected", error: "Insufficient buying power" });
    }
    this.orders.set(brokerOrderId, { req, result });
    return { ...result };
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrder | null> {
    const pending = this.orders.get(brokerOrderId) ?? this.restore(brokerOrderId);
    if (!pending) return null;
    if (pending.result.status === "submitted") await this.tryFill(pending);
    return { ...pending.result };
  }

  async getByClientId(clientOrderId: string): Promise<BrokerOrder | null> {
    return this.getOrder(`sim-${clientOrderId}`);
  }

  async cancel(brokerOrderId: string): Promise<void> {
    const p = this.orders.get(brokerOrderId);
    if (p && p.result.status === "submitted") p.result.status = "canceled";
  }

  /** After a restart, working orders are rebuilt from the database. */
  private restore(brokerOrderId: string): Pending | null {
    const row = this.o.store.getOrderByClientId(brokerOrderId.replace(/^sim-/, ""));
    if (!row || row.accountId !== this.o.accountId) return null;
    const pending: Pending = {
      req: {
        clientOrderId: row.clientOrderId,
        symbol: row.symbol,
        side: row.side,
        notional: row.notional ?? undefined,
        qty: row.qty ?? undefined,
        refTs: row.refTs,
      },
      result: {
        brokerOrderId,
        clientOrderId: row.clientOrderId,
        status: row.status === "filled" ? "filled" : "submitted",
        filledQty: row.filledQty,
        avgFillPrice: row.avgFillPrice,
      },
    };
    this.orders.set(brokerOrderId, pending);
    return pending;
  }

  private async tryFill(p: Pending): Promise<void> {
    const bar = await this.o.prices.firstOpenAtOrAfter(
      p.req.symbol,
      p.req.refTs,
      this.o.clock.now(),
    );
    if (!bar) return;
    const slip = this.o.slippageBps / 10_000;
    const price = bar.price * (p.req.side === "buy" ? 1 + slip : 1 - slip);
    const qty = p.req.qty ?? (p.req.notional ?? 0) / price;
    const fee = (qty * price * this.o.feeBps) / 10_000;
    if (!sufficient(this.holdings(), p.req.side, p.req.symbol, qty, price, fee)) {
      Object.assign(p.result, {
        status: "rejected",
        error: "Insufficient funds or shares at fill time",
      });
      return;
    }
    Object.assign(p.result, {
      status: "filled",
      filledQty: qty,
      avgFillPrice: price,
      fee,
      filledAt: bar.ts,
    });
  }
}

function sufficient(
  h: { cash: number; holdings: Map<string, number> },
  side: Side,
  symbol: string,
  qty: number,
  price: number,
  fee: number,
): boolean {
  if (side === "buy") return h.cash + 1e-6 >= qty * price + fee;
  return (h.holdings.get(symbol) ?? 0) + 1e-9 >= qty;
}

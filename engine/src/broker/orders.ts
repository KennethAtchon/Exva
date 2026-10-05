// Order lifecycle and positions. Fills are derived from changes in the broker's cumulative filled
// quantity, so polling and restarts can never double-count. A filled ENTRY opens a position;
// only filled SELL quantity closes it. Positions are never inferred from order status.
import type { Bot, Fill, Side, Trade } from "@shared/types.ts";
import { TERMINAL_ORDER_STATUSES } from "@shared/types.ts";
import type { Clock } from "../core/clock.ts";
import type { EventSink } from "../core/events.ts";
import { BrokerRejected } from "../errors.ts";
import type { OrderRow, Store } from "../store/store.ts";
import { errorMessage, newId, round } from "../util.ts";
import { type Broker, type BrokerOrder, symbolKey } from "./types.ts";

const DUST = 0.01; // an exit that leaves <1% of the position (e.g. crypto fees taken in coin) closes it
const LOST_MS = 120_000; // an order the broker can't find after this long is written off
const STUCK_MS = 30 * 60_000; // a market order still unfilled after this long is canceled

export interface SubmitInput {
  bot: Bot;
  symbol: string;
  side: Side;
  notional?: number;
  qty?: number;
  refTs: number;
  decisionId: string | null;
  reason: string;
  stopPct?: number | null;
  targetPct?: number | null;
}

export class Orders {
  private readonly cancelAsked = new Set<string>();

  constructor(
    private readonly d: {
      store: Store;
      brokerFor: (accountId: string) => Broker;
      clock: Clock;
      events: EventSink;
      /** Market hours; stock orders queued while the market is closed are not "stuck". */
      marketOpen?: (symbol: string, ts: number) => boolean;
    },
  ) {}

  /** Working for 30 minutes of open market without filling. */
  private stuck(order: OrderRow, now: number): boolean {
    const open = this.d.marketOpen ?? (() => true);
    return (
      now - order.createdAt > STUCK_MS &&
      open(order.symbol, now) &&
      open(order.symbol, now - STUCK_MS) &&
      !this.cancelAsked.has(order.id)
    );
  }

  async submit(input: SubmitInput): Promise<OrderRow> {
    const { store, clock } = this.d;
    const id = newId("ord");
    const now = clock.now();
    const row: OrderRow = {
      id,
      clientOrderId: `exva-${id}`,
      brokerOrderId: null,
      botId: input.bot.id,
      accountId: input.bot.accountId,
      symbol: input.symbol,
      side: input.side,
      notional: input.notional ?? null,
      qty: input.qty ?? null,
      refTs: input.refTs,
      status: "pending_submit",
      filledQty: 0,
      avgFillPrice: null,
      stopPct: input.stopPct ?? null,
      targetPct: input.targetPct ?? null,
      decisionId: input.decisionId,
      reason: input.reason,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    store.insertOrder(row); // written BEFORE the HTTP call, so a crash can always be reconciled
    const broker = this.d.brokerFor(input.bot.accountId);
    try {
      const b = await broker.submit({
        clientOrderId: row.clientOrderId,
        symbol: row.symbol,
        side: row.side,
        notional: input.notional,
        qty: input.qty,
        refTs: row.refTs,
      });
      this.apply(row, b);
    } catch (err) {
      if (err instanceof BrokerRejected) {
        store.updateOrder(id, { status: "rejected", error: errorMessage(err) }, clock.now());
      } else {
        store.updateOrder(id, { status: "submit_unknown", error: errorMessage(err) }, clock.now());
        const found = await broker.getByClientId(row.clientOrderId).catch(() => null);
        if (found) this.apply(store.getOrder(id) as OrderRow, found);
      }
    }
    const saved = store.getOrder(id) as OrderRow;
    this.d.events.emit({ type: "order", data: saved });
    return saved;
  }

  /** Poll the broker for every working order and apply what changed. */
  async sync(accountId?: string): Promise<void> {
    const { store, clock } = this.d;
    for (const order of store.activeOrders(accountId)) {
      try {
        const broker = this.d.brokerFor(order.accountId);
        const b = order.brokerOrderId
          ? await broker.getOrder(order.brokerOrderId)
          : await broker.getByClientId(order.clientOrderId);
        const age = clock.now() - order.createdAt;
        if (b) {
          this.apply(order, b);
          if (!isTerminal(b.status) && this.stuck(order, clock.now())) {
            this.cancelAsked.add(order.id);
            await broker.cancel(b.brokerOrderId);
            this.d.events.event(
              "warn",
              "order_stuck",
              `A ${order.side} order for ${order.symbol} was still unfilled after 30 minutes, so Exva canceled it`,
              { orderId: order.id, botId: order.botId },
            );
          }
        } else if (age > LOST_MS) {
          // Never acknowledged → it never arrived. Acknowledged but now unknown → the broker dropped it.
          const known = Boolean(order.brokerOrderId);
          store.updateOrder(
            order.id,
            known
              ? { status: "canceled", error: "The broker no longer has this order" }
              : { status: "rejected", error: "The order never reached the broker" },
            clock.now(),
          );
          this.d.events.emit({ type: "order", data: store.getOrder(order.id) as OrderRow });
        }
      } catch {
        // Broker unreachable: try again on the next sync.
      }
    }
  }

  /** Cancel a bot's working orders (stop, delete). Returns how many were asked to cancel. */
  async cancelWorking(botId: string, side?: Side): Promise<number> {
    const working = this.d.store
      .activeOrders()
      .filter((o) => o.botId === botId && (!side || o.side === side));
    for (const order of working) {
      const broker = this.d.brokerFor(order.accountId);
      const id =
        order.brokerOrderId ??
        (await broker.getByClientId(order.clientOrderId).catch(() => null))?.brokerOrderId;
      if (id) await broker.cancel(id).catch(() => {});
    }
    if (working.length) await this.sync().catch(() => {});
    return working.length;
  }

  /**
   * How much of an open trade can be sold. Crypto fees taken in coin leave the broker holding a bit
   * less than the fills add up to, so the broker's position caps it. 0 means the broker holds none.
   */
  async sellableQty(trade: Trade): Promise<number> {
    const remaining = trade.qty - trade.exitQty;
    const broker = this.d.brokerFor(trade.accountId);
    if (broker.kind === "sim") return remaining;
    const pos = (await broker.positions()).find(
      (p) => symbolKey(p.symbol) === symbolKey(trade.symbol),
    );
    return pos && pos.qty > 0 ? Math.min(remaining, pos.qty) : 0;
  }

  /** The broker holds none of this position any more (sold in the broker's own app): close it. */
  closeOutside(trade: Trade, ts: number): Trade {
    const closed: Trade = {
      ...trade,
      status: "closed",
      closedAt: ts,
      exitReason: "closed_outside_exva",
      pnlUsd: null,
      pnlPct: null,
    };
    this.d.store.saveTrade(closed);
    const bot = this.d.store.getBot(trade.botId);
    this.d.events.event(
      "warn",
      "position_gone",
      `${bot?.name ?? "A bot"} held ${round(trade.qty - trade.exitQty, 6)} ${trade.symbol} but the account has none. Exva closed the position without a P&L; it was probably sold outside Exva.`,
      { tradeId: trade.id, botId: trade.botId },
    );
    this.d.events.emit({ type: "trade", data: closed });
    return closed;
  }

  apply(order: OrderRow, b: BrokerOrder): void {
    const { store, clock } = this.d;
    const changed = store.tx(() => {
      const current = store.getOrder(order.id) as OrderRow;
      const prevQty = current.filledQty;
      let fill: Fill | null = null;
      if (b.filledQty > prevQty + 1e-12 && b.avgFillPrice) {
        const incQty = b.filledQty - prevQty;
        const prevValue = (current.avgFillPrice ?? 0) * prevQty;
        const incPrice = (b.avgFillPrice * b.filledQty - prevValue) / incQty;
        const prevFees = store.fillsForOrders([order.id]).reduce((s, f) => s + f.fee, 0);
        fill = {
          id: `${order.id}:${b.filledQty}`,
          orderId: order.id,
          qty: incQty,
          price: Number.isFinite(incPrice) && incPrice > 0 ? incPrice : b.avgFillPrice,
          fee: Math.max(0, (b.fee ?? 0) - prevFees),
          ts: b.filledAt ?? clock.now(),
        };
      }
      // A finished order never goes back to working, and a fill the broker reports without a price
      // keeps the order working so the next poll records it.
      const unpriced = b.filledQty > prevQty + 1e-12 && !fill;
      const status =
        unpriced || (isTerminal(current.status) && !isTerminal(b.status))
          ? current.status
          : b.status;
      const recorded = fill !== null && store.insertFill(fill);
      const statusChanged = current.status !== status || current.brokerOrderId !== b.brokerOrderId;
      store.updateOrder(
        order.id,
        {
          brokerOrderId: b.brokerOrderId,
          status,
          filledQty: recorded ? b.filledQty : prevQty,
          avgFillPrice: recorded ? b.avgFillPrice : current.avgFillPrice,
          error: b.error ?? current.error,
        },
        clock.now(),
      );
      const trade = recorded && fill ? this.applyFill(current, fill) : null;
      if (status === "filled" && current.side === "sell")
        this.finishExit(current, b.filledAt ?? clock.now());
      return { statusChanged, trade, fill: recorded ? fill : null };
    });
    if (changed.statusChanged || changed.fill) {
      const saved = store.getOrder(order.id) as OrderRow;
      this.d.events.emit({ type: "order", data: saved });
      if (changed.fill && saved.status === "filled") {
        const verb = saved.side === "buy" ? "Bought" : "Sold";
        const bot = store.getBot(saved.botId);
        this.d.events.event(
          "info",
          "fill",
          `${verb} ${round(saved.filledQty, 6)} ${saved.symbol} @ ${round(saved.avgFillPrice ?? 0, 4)} (${bot?.name ?? "bot"})`,
          {
            orderId: saved.id,
            botId: saved.botId,
          },
        );
      }
    }
    if (changed.trade) this.d.events.emit({ type: "trade", data: changed.trade });
  }

  private applyFill(order: OrderRow, fill: Fill): Trade | null {
    const { store } = this.d;
    const open = store.openTrade(order.botId, order.symbol);
    if (order.side === "buy") {
      const trade: Trade = open
        ? {
            ...open,
            entryPrice:
              (open.entryPrice * open.qty + fill.price * fill.qty) / (open.qty + fill.qty),
            qty: open.qty + fill.qty,
            fees: open.fees + fill.fee,
          }
        : {
            id: newId("trd"),
            botId: order.botId,
            accountId: order.accountId,
            symbol: order.symbol,
            status: "open",
            qty: fill.qty,
            entryPrice: fill.price,
            exitQty: 0,
            exitPrice: null,
            fees: fill.fee,
            stopPct: order.stopPct,
            targetPct: order.targetPct,
            openedAt: fill.ts,
            closedAt: null,
            pnlUsd: null,
            pnlPct: null,
            exitReason: null,
            entryOrderId: order.id,
            exitOrderId: null,
          };
      store.saveTrade(trade);
      return trade;
    }
    if (!open) {
      this.d.events.event(
        "warn",
        "orphan_fill",
        `Sell fill for ${order.symbol} with no open position in Exva`,
        {
          orderId: order.id,
        },
      );
      return null;
    }
    const exitQty = open.exitQty + fill.qty;
    const trade: Trade = {
      ...open,
      exitPrice: ((open.exitPrice ?? 0) * open.exitQty + fill.price * fill.qty) / exitQty,
      exitQty,
      fees: open.fees + fill.fee,
      exitOrderId: order.id,
      exitReason: order.reason,
    };
    const closed = exitQty >= open.qty * (1 - 1e-9) ? close(trade, fill.ts) : trade;
    store.saveTrade(closed);
    return closed;
  }

  /** A completely filled sell that leaves only dust closes the position. */
  private finishExit(order: OrderRow, ts: number): void {
    const open = this.d.store.openTrade(order.botId, order.symbol);
    if (open && open.exitOrderId === order.id && open.qty - open.exitQty <= open.qty * DUST) {
      this.d.store.saveTrade(close(open, ts));
    }
  }
}

function close(t: Trade, ts: number): Trade {
  const cost = t.qty * t.entryPrice;
  const pnlUsd = t.exitQty * (t.exitPrice ?? 0) - cost - t.fees;
  return {
    ...t,
    status: "closed",
    closedAt: ts,
    pnlUsd: round(pnlUsd, 4),
    pnlPct: round((pnlUsd / cost) * 100, 4),
  };
}

export const isTerminal = (status: OrderRow["status"]) => TERMINAL_ORDER_STATUSES.includes(status);

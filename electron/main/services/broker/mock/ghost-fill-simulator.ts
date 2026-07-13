import type { BrokerOrderV2 } from "../order-contract-v2";

export interface GhostQuote {
  bid: number;
  ask: number;
  last: number;
}

export type GhostFillStatus = "open" | "filled" | "canceled";

export interface GhostFillReceipt {
  ghostOrderId: string;
  clientOrderId: string;
  status: GhostFillStatus;
  filledAvgPrice: number | null;
  filledQty: number;
  remainingQty: number;
  realizedPnlUsd: number | null;
  message?: string;
}

interface GhostOrderState {
  order: BrokerOrderV2;
  status: GhostFillStatus;
  filledAvgPrice: number | null;
  filledQty: number;
  remainingQty: number;
  createdAt: string;
}

function mid(quote: GhostQuote): number {
  if (quote.bid > 0 && quote.ask > 0) return (quote.bid + quote.ask) / 2;
  return quote.last;
}

function isMarketable(order: BrokerOrderV2, quote: GhostQuote): boolean {
  if (order.orderType === "market") return true;
  if (order.orderType === "limit" && order.limitPrice != null) {
    if (order.side === "BUY") return order.limitPrice >= quote.ask;
    return order.limitPrice <= quote.bid;
  }
  if (
    (order.orderType === "stop" || order.orderType === "stop_limit") &&
    order.stopPrice != null
  ) {
    if (order.side === "BUY") return quote.last >= order.stopPrice;
    return quote.last <= order.stopPrice;
  }
  return false;
}

function fillPrice(order: BrokerOrderV2, quote: GhostQuote): number {
  if (order.orderType === "limit" && order.limitPrice != null) {
    // Marketable limit: fill at the more favorable of limit vs touch.
    if (order.side === "BUY") return Math.min(order.limitPrice, quote.ask);
    return Math.max(order.limitPrice, quote.bid);
  }
  return mid(quote);
}

function resolveQty(order: BrokerOrderV2, price: number): number {
  if (order.quantity.kind === "units") return order.quantity.value;
  if (!(price > 0)) return 0;
  return order.quantity.value / price;
}

/**
 * Adapter-agnostic paper fill simulator for venues without a sandbox
 * (Kraken validate-only, Polymarket ghost trades). Market orders fill at mid;
 * limits rest until marketable against a fresh quote.
 */
export class GhostFillSimulator {
  private readonly orders = new Map<string, GhostOrderState>();

  simulateFill(order: BrokerOrderV2, quote: GhostQuote): GhostFillReceipt {
    const ghostOrderId = `ghost-${order.clientOrderId}`;
    const price = fillPrice(order, quote);
    const qty = resolveQty(order, price);

    if (isMarketable(order, quote) && qty > 0 && price > 0) {
      const receipt: GhostFillReceipt = {
        ghostOrderId,
        clientOrderId: order.clientOrderId,
        status: "filled",
        filledAvgPrice: price,
        filledQty: qty,
        remainingQty: 0,
        realizedPnlUsd: null,
      };
      this.orders.set(ghostOrderId, {
        order,
        status: "filled",
        filledAvgPrice: price,
        filledQty: qty,
        remainingQty: 0,
        createdAt: new Date().toISOString(),
      });
      return receipt;
    }

    this.orders.set(ghostOrderId, {
      order,
      status: "open",
      filledAvgPrice: null,
      filledQty: 0,
      remainingQty: qty,
      createdAt: new Date().toISOString(),
    });
    return {
      ghostOrderId,
      clientOrderId: order.clientOrderId,
      status: "open",
      filledAvgPrice: null,
      filledQty: 0,
      remainingQty: qty,
      realizedPnlUsd: null,
      message: "Resting ghost limit — waiting for marketable quote",
    };
  }

  /** Re-check resting ghosts against a fresh quote. */
  poll(ghostOrderId: string, quote: GhostQuote): GhostFillReceipt | null {
    const state = this.orders.get(ghostOrderId);
    if (!state) return null;
    if (state.status !== "open") {
      return this.toReceipt(ghostOrderId, state);
    }
    if (!isMarketable(state.order, quote)) {
      return this.toReceipt(ghostOrderId, state);
    }
    const price = fillPrice(state.order, quote);
    const qty = resolveQty(state.order, price);
    state.status = "filled";
    state.filledAvgPrice = price;
    state.filledQty = qty;
    state.remainingQty = 0;
    return this.toReceipt(ghostOrderId, state);
  }

  cancel(ghostOrderId: string): GhostFillReceipt | null {
    const state = this.orders.get(ghostOrderId);
    if (!state) return null;
    if (state.status === "filled") return this.toReceipt(ghostOrderId, state);
    state.status = "canceled";
    state.remainingQty = 0;
    return this.toReceipt(ghostOrderId, state);
  }

  get(ghostOrderId: string): GhostFillReceipt | null {
    const state = this.orders.get(ghostOrderId);
    if (!state) return null;
    return this.toReceipt(ghostOrderId, state);
  }

  /** Resting (unfilled, uncanceled) ghost orders — for getOpenOrders. */
  listOpen(): GhostFillReceipt[] {
    const out: GhostFillReceipt[] = [];
    for (const [id, state] of this.orders) {
      if (state.status === "open") out.push(this.toReceipt(id, state));
    }
    return out;
  }

  private toReceipt(
    ghostOrderId: string,
    state: GhostOrderState,
  ): GhostFillReceipt {
    return {
      ghostOrderId,
      clientOrderId: state.order.clientOrderId,
      status: state.status,
      filledAvgPrice: state.filledAvgPrice,
      filledQty: state.filledQty,
      remainingQty: state.remainingQty,
      realizedPnlUsd: null,
    };
  }
}

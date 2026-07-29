import type {
  BacktestEquityPoint,
  BacktestRunSpecV2,
} from "@electron/shared/domain/backtest-v2";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import type { DeterministicStrategy } from "./replay-engine";

export interface PortfolioPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  side: "long" | "short";
}

export interface PortfolioFill {
  ts: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  feeUsd: number;
  orderId: string;
}

export interface PortfolioTrade {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryTs: string;
  exitTs: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  realizedPnlUsd: number;
  feesUsd: number;
  returnBps: number | null;
}

export interface PortfolioReplayResult {
  equity: BacktestEquityPoint[];
  fills: PortfolioFill[];
  trades: PortfolioTrade[];
  orders: Array<{
    id: string;
    ts: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    status: "filled" | "canceled";
  }>;
  startingCapitalUsd: number;
  endingEquityUsd: number;
  netPnlUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
}

interface PendingOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  notionalUsd: number;
  signalBarTs: string;
  createdAtTs: string;
}

/**
 * Chronological multi-symbol portfolio simulator (Solution 03).
 * Default entry: next-bar open. Equity = cash + marked positions.
 */
export class PortfolioReplayEngine {
  run(input: {
    spec: BacktestRunSpecV2;
    strategy: DeterministicStrategy;
    barsBySymbol: Map<string, OhlcvBar[]>;
  }): PortfolioReplayResult {
    const { spec, strategy, barsBySymbol } = input;
    const starting = spec.portfolio.startingCapitalUsd;
    let cash = starting;
    let realizedPnl = 0;
    let feesTotal = 0;
    let peakEquity = starting;
    let maxDrawdownUsd = 0;
    let maxDrawdownPct = 0;

    const positions = new Map<string, PortfolioPosition>();
    const pending: PendingOrder[] = [];
    const fills: PortfolioFill[] = [];
    const trades: PortfolioTrade[] = [];
    const orders: PortfolioReplayResult["orders"] = [];
    const equity: BacktestEquityPoint[] = [];
    const openTrades = new Map<string, PortfolioTrade>();

    const timeline = buildTimeline(barsBySymbol);
    const history = new Map<string, OhlcvBar[]>();
    for (const symbol of barsBySymbol.keys()) history.set(symbol, []);

    const bpsCost =
      (spec.costs.spreadBps +
        spec.costs.commissionBps +
        spec.costs.slippageBps) /
      10_000;

    for (const event of timeline) {
      const { ts, symbol, bar } = event;
      const hist = history.get(symbol)!;
      hist.push(bar);

      // 1. Mark existing positions / fill next-bar entries at this open.
      const stillPending: PendingOrder[] = [];
      for (const order of pending) {
        if (order.symbol !== symbol) {
          stillPending.push(order);
          continue;
        }
        if (spec.execution.entry === "next_bar_open") {
          // Fill on first bar strictly after the signal bar.
          if (bar.ts <= order.signalBarTs) {
            stillPending.push(order);
            continue;
          }
        } else if (bar.ts !== order.signalBarTs) {
          stillPending.push(order);
          continue;
        }

        const fillPrice =
          spec.execution.entry === "next_bar_open" ? bar.open : bar.close;
        const qty = Math.max(1e-8, order.notionalUsd / fillPrice);
        const fee = order.notionalUsd * bpsCost;
        const signedQty = order.side === "buy" ? qty : -qty;

        cash -= signedQty * fillPrice + fee;
        feesTotal += fee;
        applyFill(positions, symbol, signedQty, fillPrice);

        const fill: PortfolioFill = {
          ts: bar.ts,
          symbol,
          side: order.side,
          quantity: qty,
          price: fillPrice,
          feeUsd: fee,
          orderId: order.id,
        };
        fills.push(fill);
        orders.push({
          id: order.id,
          ts: bar.ts,
          symbol,
          side: order.side,
          quantity: qty,
          status: "filled",
        });

        const existing = openTrades.get(symbol);
        if (order.side === "buy" && !existing) {
          const trade: PortfolioTrade = {
            id: order.id,
            symbol,
            side: "long",
            entryTs: bar.ts,
            exitTs: null,
            entryPrice: fillPrice,
            exitPrice: null,
            quantity: qty,
            realizedPnlUsd: 0,
            feesUsd: fee,
            returnBps: null,
          };
          openTrades.set(symbol, trade);
        } else if (order.side === "sell" && existing) {
          const pnl =
            (fillPrice - existing.entryPrice) * existing.quantity - fee;
          realizedPnl += pnl;
          existing.exitTs = bar.ts;
          existing.exitPrice = fillPrice;
          existing.realizedPnlUsd = pnl;
          existing.feesUsd += fee;
          existing.returnBps =
            ((fillPrice - existing.entryPrice) / existing.entryPrice) * 10_000;
          trades.push(existing);
          openTrades.delete(symbol);
        }
      }
      pending.length = 0;
      pending.push(...stillPending);

      // 2. Evaluate strategy on history available at this bar.
      if (hist.length >= strategy.warmupBars) {
        const signal = strategy.evaluate(hist, {
          symbol,
          timeframe: spec.instruments.find((i) => i.symbol === symbol)
            ?.timeframe ?? "1h",
        });
        if (signal && !openTrades.has(symbol)) {
          const notional =
            spec.portfolio.sizing.kind === "fixed_notional"
              ? spec.portfolio.sizing.notionalUsd
              : cash * spec.portfolio.sizing.fraction;
          if (
            notional > 0 &&
            cash >= notional &&
            (!spec.portfolio.allowOverlappingPositions ||
              !positions.has(symbol))
          ) {
            pending.push({
              id: crypto.randomUUID(),
              symbol,
              side: signal.action,
              notionalUsd: notional,
              signalBarTs: bar.ts,
              createdAtTs: ts,
            });
          }
        }
      }

      // 3. Record equity point.
      const marked = markPositions(positions, barsBySymbol, ts);
      const equityUsd = cash + marked.net;
      peakEquity = Math.max(peakEquity, equityUsd);
      const ddUsd = peakEquity - equityUsd;
      const ddPct = peakEquity > 0 ? ddUsd / peakEquity : 0;
      maxDrawdownUsd = Math.max(maxDrawdownUsd, ddUsd);
      maxDrawdownPct = Math.max(maxDrawdownPct, ddPct);

      equity.push({
        ts,
        cashUsd: cash,
        grossMarketValueUsd: Math.abs(marked.gross),
        netMarketValueUsd: marked.net,
        realizedPnlUsd: realizedPnl,
        unrealizedPnlUsd: marked.unrealized,
        feesUsd: feesTotal,
        equityUsd,
        drawdownUsd: ddUsd,
        drawdownPct: ddPct,
      });
    }

    // End-of-data: mark open trades (default) or liquidate.
    if (spec.execution.endOfData === "liquidate_at_close") {
      for (const [symbol, trade] of openTrades) {
        const bars = barsBySymbol.get(symbol) ?? [];
        const last = bars[bars.length - 1];
        if (!last) continue;
        const pnl = (last.close - trade.entryPrice) * trade.quantity;
        realizedPnl += pnl;
        cash += trade.quantity * last.close;
        trade.exitTs = last.ts;
        trade.exitPrice = last.close;
        trade.realizedPnlUsd = pnl;
        trade.returnBps =
          ((last.close - trade.entryPrice) / trade.entryPrice) * 10_000;
        trades.push(trade);
        positions.delete(symbol);
      }
      openTrades.clear();
    } else {
      for (const trade of openTrades.values()) {
        trades.push(trade);
      }
    }

    const ending =
      equity.length > 0 ? equity[equity.length - 1]!.equityUsd : starting;

    return {
      equity,
      fills,
      trades,
      orders,
      startingCapitalUsd: starting,
      endingEquityUsd: ending,
      netPnlUsd: ending - starting,
      maxDrawdownUsd,
      maxDrawdownPct,
    };
  }
}

function buildTimeline(
  barsBySymbol: Map<string, OhlcvBar[]>,
): Array<{ ts: string; symbol: string; bar: OhlcvBar }> {
  const events: Array<{ ts: string; symbol: string; bar: OhlcvBar }> = [];
  for (const [symbol, bars] of barsBySymbol) {
    for (const bar of bars) {
      events.push({ ts: bar.ts, symbol, bar });
    }
  }
  events.sort((a, b) => {
    const cmp = a.ts.localeCompare(b.ts);
    if (cmp !== 0) return cmp;
    return a.symbol.localeCompare(b.symbol);
  });
  return events;
}

function applyFill(
  positions: Map<string, PortfolioPosition>,
  symbol: string,
  signedQty: number,
  price: number,
): void {
  const existing = positions.get(symbol);
  if (!existing) {
    positions.set(symbol, {
      symbol,
      quantity: Math.abs(signedQty),
      avgCost: price,
      side: signedQty >= 0 ? "long" : "short",
    });
    return;
  }
  const signedExisting =
    existing.side === "long" ? existing.quantity : -existing.quantity;
  const newSigned = signedExisting + signedQty;
  if (Math.abs(newSigned) < 1e-10) {
    positions.delete(symbol);
    return;
  }
  positions.set(symbol, {
    symbol,
    quantity: Math.abs(newSigned),
    avgCost: price,
    side: newSigned >= 0 ? "long" : "short",
  });
}

function markPositions(
  positions: Map<string, PortfolioPosition>,
  barsBySymbol: Map<string, OhlcvBar[]>,
  asOfTs: string,
): { net: number; gross: number; unrealized: number } {
  let net = 0;
  let gross = 0;
  let unrealized = 0;
  for (const pos of positions.values()) {
    const bars = barsBySymbol.get(pos.symbol) ?? [];
    let mark = pos.avgCost;
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      if (bars[i]!.ts <= asOfTs) {
        mark = bars[i]!.close;
        break;
      }
    }
    const signed = pos.side === "long" ? pos.quantity : -pos.quantity;
    const mv = signed * mark;
    net += mv;
    gross += Math.abs(mv);
    unrealized += signed * (mark - pos.avgCost);
  }
  return { net, gross, unrealized };
}

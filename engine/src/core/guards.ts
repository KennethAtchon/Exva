// Hard safety rules checked before any order, and the per-bot exits checked before the strategy.
import type { ReasonCode } from "@shared/reasons.ts";
import type { Bar, Bot, Side, Trade } from "@shared/types.ts";
import { TIMEFRAME_MS } from "@shared/types.ts";
import type { Broker } from "../broker/types.ts";
import type { Store } from "../store/store.ts";
import { localDayStart, round, usd } from "../util.ts";

export interface Block {
  code: ReasonCode;
  message?: string;
  values?: Record<string, number>;
}

export interface GuardInput {
  bot: Bot;
  symbol: string;
  side: Side;
  trade: Trade | null;
  notional: number;
  now: number;
  killSwitch: boolean;
  accountMode: "paper" | "sim";
  broker: Broker;
  store: Store;
  lastPrice: (symbol: string) => number | null;
}

/** First failing guard wins. Exits (sells) are only stopped by the kill switch, mode and working orders. */
export async function checkGuards(g: GuardInput): Promise<Block | null> {
  if (g.killSwitch) return { code: "kill_switch" };
  if (g.accountMode !== "paper" && g.accountMode !== "sim") return { code: "paper_only" };
  const working = g.store.activeOrderFor(g.bot.id, g.symbol);
  if (working)
    return {
      code: "order_pending",
      message: `A ${working.side} order for ${g.symbol} is still ${working.status}`,
    };

  if (g.side === "sell") return g.trade ? null : { code: "no_position" };

  if (g.trade) return { code: "already_in_position" };
  const others = g.store
    .openTradesOnAccountSymbol(g.bot.accountId, g.symbol)
    .filter((t) => t.botId !== g.bot.id);
  if (others.length) return { code: "symbol_owned_by_other_bot" };
  const open = g.store.listTrades({ botId: g.bot.id, status: "open" });
  if (open.length >= g.bot.risk.maxPositions) {
    return { code: "max_positions", values: { open: open.length, max: g.bot.risk.maxPositions } };
  }
  const limit = g.bot.risk.dailyLossLimitUsd;
  if (limit > 0) {
    const realized = g.store.realizedPnlSince(g.bot.id, localDayStart(g.now));
    const unrealized = open.reduce((sum, t) => {
      const px = g.lastPrice(t.symbol);
      return sum + (px === null ? 0 : (px - t.entryPrice) * (t.qty - t.exitQty));
    }, 0);
    const pnl = realized + unrealized;
    if (-pnl >= limit) {
      return {
        code: "daily_loss_limit",
        message: `Down ${usd(-pnl)} today, limit is ${usd(limit)}. No new buys today; exits still run.`,
        values: { pnlToday: round(pnl), limit },
      };
    }
  }
  const account = await g.broker.account();
  if (account.buyingPower < g.notional) {
    return {
      code: "insufficient_buying_power",
      message: `Needs ${usd(g.notional)}, buying power is ${usd(account.buyingPower)}`,
      values: { buyingPower: round(account.buyingPower) },
    };
  }
  return null;
}

export interface ExitSignal {
  action: "sell";
  code: "stop_loss" | "take_profit" | "max_hold";
  reason: string;
  values: Record<string, number>;
}

/** Stop-loss / take-profit against the just-closed bar's low/high; max hold in bars. */
export function checkExits(bot: Bot, trade: Trade, bar: Bar, held: number): ExitSignal | null {
  const stopPct = trade.stopPct ?? bot.risk.stopLossPct;
  const targetPct = trade.targetPct ?? bot.risk.takeProfitPct;
  if (stopPct) {
    const stop = trade.entryPrice * (1 - stopPct / 100);
    if (bar.l <= stop) {
      return {
        action: "sell",
        code: "stop_loss",
        reason: `Stop-loss hit: low ${round(bar.l, 4)} ≤ stop ${round(stop, 4)} (−${stopPct}%)`,
        values: { low: bar.l, stop: round(stop, 4) },
      };
    }
  }
  if (targetPct) {
    const target = trade.entryPrice * (1 + targetPct / 100);
    if (bar.h >= target) {
      return {
        action: "sell",
        code: "take_profit",
        reason: `Take-profit hit: high ${round(bar.h, 4)} ≥ target ${round(target, 4)} (+${targetPct}%)`,
        values: { high: bar.h, target: round(target, 4) },
      };
    }
  }
  if (bot.risk.maxHoldBars && held >= bot.risk.maxHoldBars) {
    return {
      action: "sell",
      code: "max_hold",
      reason: `Held ${held} bars, the maximum is ${bot.risk.maxHoldBars}`,
      values: { barsHeld: held },
    };
  }
  return null;
}

/** Bars since the decision that opened the trade (not the fill time, which differs per broker). */
export function barsHeld(entryDecisionTs: number, now: number, bot: Bot): number {
  return Math.max(0, Math.floor((now - entryDecisionTs) / TIMEFRAME_MS[bot.timeframe]));
}

// The tick: one bot, one symbol, one closed bar → exactly one Decision. Backtests and live trading
// both run this code; only the clock, the bar feed and the broker differ.
import type { Bot, Decision, Trade } from "@shared/types.ts";
import { TIMEFRAME_MS } from "@shared/types.ts";
import type { Orders } from "../broker/orders.ts";
import type { Broker } from "../broker/types.ts";
import { symbolKey } from "../broker/types.ts";
import type { BarFeed } from "../data/bar-store.ts";
import type { Store } from "../store/store.ts";
import { getStrategy, parseParams } from "../strategies/index.ts";
import type { AnalystAi, PositionView } from "../strategies/types.ts";
import { hhmm, round } from "../util.ts";
import type { Clock } from "./clock.ts";
import { DecisionBuilder } from "./decision.ts";
import type { EventSink } from "./events.ts";
import { barsHeld, checkExits, checkGuards } from "./guards.ts";

export interface RunnerDeps {
  store: Store;
  feed: BarFeed;
  orders: Orders;
  brokerFor: (accountId: string) => Broker;
  accountMode: (accountId: string) => "paper" | "sim";
  ai: AnalystAi | null;
  clock: Clock;
  events: EventSink;
  killSwitch: () => boolean;
}

export class Runner {
  constructor(private readonly d: RunnerDeps) {}

  /** Returns null when this bar was already decided for this bot and symbol (ticks are idempotent). */
  async tick(bot: Bot, symbol: string, barClose: number): Promise<Decision | null> {
    if (this.d.store.hasDecision(bot.id, symbol, barClose)) return null;
    const builder = new DecisionBuilder(bot, symbol, barClose, this.d.clock.now());
    let decision: Decision;
    try {
      decision = await this.evaluate(bot, symbol, barClose, builder);
    } catch (err) {
      decision = builder.fromError(err);
    }
    if (!this.d.store.insertDecision(decision)) return null;
    this.d.events.emit({ type: "decision", data: decision });
    return decision;
  }

  /** Record a failure that happened before the tick could run (e.g. market data unreachable). */
  recordError(bot: Bot, symbol: string, barClose: number, err: unknown): Decision | null {
    if (this.d.store.hasDecision(bot.id, symbol, barClose)) return null;
    const decision = new DecisionBuilder(bot, symbol, barClose, this.d.clock.now()).fromError(err);
    if (!this.d.store.insertDecision(decision)) return null;
    this.d.events.emit({ type: "decision", data: decision });
    return decision;
  }

  private async evaluate(
    bot: Bot,
    symbol: string,
    barClose: number,
    d: DecisionBuilder,
  ): Promise<Decision> {
    const { store, feed } = this.d;
    const strategy = getStrategy(bot.strategyId);
    const params = parseParams(strategy, bot.params);
    const warmup = strategy.warmup(params);
    const tf = TIMEFRAME_MS[bot.timeframe];
    const bars = feed.closedBars(symbol, bot.timeframe, barClose, warmup + 50);
    const lastBar = bars[bars.length - 1];
    if (!lastBar || lastBar.ts !== barClose - tf) {
      const have = lastBar ? `the latest bar is from ${hhmm(lastBar.ts)}` : "no bars are stored";
      return d.make(
        "skip",
        "stale_data",
        `No ${hhmm(barClose - tf)} bar for ${symbol} yet (${have})`,
        {
          lastBarTs: lastBar?.ts ?? 0,
        },
      );
    }
    if (bars.length < warmup) {
      return d.make(
        "skip",
        "insufficient_history",
        `Have ${bars.length} bars, ${strategy.name} needs ${warmup}`,
        {
          have: bars.length,
          need: warmup,
        },
      );
    }

    const trade = store.openTrade(bot.id, symbol);
    const entryTs = trade ? (store.getOrder(trade.entryOrderId ?? "")?.refTs ?? trade.openedAt) : 0;
    const held = trade ? barsHeld(entryTs, barClose, bot) : 0;
    const position: PositionView | null = trade
      ? {
          qty: trade.qty - trade.exitQty,
          entryPrice: trade.entryPrice,
          openedAt: trade.openedAt,
          barsHeld: held,
          unrealizedPct: round(((lastBar.c - trade.entryPrice) / trade.entryPrice) * 100, 3),
        }
      : null;

    const exit = trade ? checkExits(bot, trade, lastBar, held) : null;
    const signal =
      exit ??
      (await strategy.decide({
        botId: bot.id,
        symbol,
        timeframe: bot.timeframe,
        bars,
        position,
        params,
        now: barClose,
        ai: this.d.ai,
      }));
    const aiCallId = "aiCallId" in signal ? (signal.aiCallId ?? null) : null;
    if (signal.action === "hold") {
      return d.make(
        "hold",
        signal.code ?? "no_signal",
        signal.reason,
        signal.values,
        null,
        aiCallId,
      );
    }

    const code = exit ? exit.code : "signal";
    const broker = this.d.brokerFor(bot.accountId);
    const block = await checkGuards({
      bot,
      symbol,
      side: signal.action,
      trade,
      notional: bot.dollarsPerTrade,
      now: barClose,
      killSwitch: this.d.killSwitch(),
      accountMode: this.d.accountMode(bot.accountId),
      broker,
      store,
      lastPrice: (s) => feed.closedBars(s, bot.timeframe, barClose, 1)[0]?.c ?? null,
    });
    if (block) {
      const wanted = `${signal.action === "buy" ? "Wanted to buy" : "Wanted to sell"}: ${signal.reason}`;
      return d.make(
        "skip",
        block.code,
        block.message ? `${block.message}. ${wanted}` : undefined,
        { ...signal.values, ...block.values },
        null,
        aiCallId,
      );
    }

    const sizing =
      signal.action === "buy"
        ? { notional: bot.dollarsPerTrade }
        : { qty: await sellQty(broker, trade as Trade) };
    const order = await this.d.orders.submit({
      bot,
      symbol,
      side: signal.action,
      ...sizing,
      refTs: barClose,
      decisionId: d.id,
      reason: code,
      stopPct: "stopLossPct" in signal ? signal.stopLossPct : null,
      targetPct: "takeProfitPct" in signal ? signal.takeProfitPct : null,
    });
    if (order.status === "rejected") {
      return d.make(
        "error",
        "broker_rejected",
        `${order.error ?? "Rejected"}. Wanted: ${signal.reason}`,
        signal.values,
        order.id,
        aiCallId,
      );
    }
    if (order.status === "submit_unknown") {
      return d.make(
        "error",
        "broker_unavailable",
        `Broker did not confirm the order; it will be reconciled. ${signal.reason}`,
        signal.values,
        order.id,
        aiCallId,
      );
    }
    return d.make(signal.action, code, signal.reason, signal.values, order.id, aiCallId);
  }
}

/**
 * Sell what this bot holds. With one bot per symbol per account, the broker's position is the truth;
 * crypto fees taken in coin leave the broker holding slightly less than the fills add up to.
 */
async function sellQty(broker: Broker, trade: Trade): Promise<number> {
  const remaining = trade.qty - trade.exitQty;
  if (broker.kind === "sim") return remaining;
  const pos = (await broker.positions()).find(
    (p) => symbolKey(p.symbol) === symbolKey(trade.symbol),
  );
  return pos && pos.qty > 0 ? Math.min(remaining, pos.qty) : remaining;
}

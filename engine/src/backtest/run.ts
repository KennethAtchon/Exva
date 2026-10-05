// Backtests replay history through the SAME Runner as live trading, with a simulated clock,
// a historical feed and the Simulator broker, all inside a throwaway in-memory database.
import type {
  Account,
  Backtest,
  BacktestFill,
  BacktestSpec,
  Bar,
  Bot,
  Decision,
  EquityPoint,
  Timeframe,
} from "@shared/types.ts";
import { assetClassOf, TIMEFRAME_MS } from "@shared/types.ts";
import { Orders } from "../broker/orders.ts";
import { type PriceSource, SimBroker } from "../broker/sim.ts";
import { isCheckTime, type UsEquityCalendar } from "../core/calendar.ts";
import { type Clock, SimClock } from "../core/clock.ts";
import { type EventSink, nullSink } from "../core/events.ts";
import { Runner } from "../core/runner.ts";
import type { BarFeed, BarStore } from "../data/bar-store.ts";
import { DataError } from "../errors.ts";
import { Store } from "../store/store.ts";
import { getStrategy, parseParams } from "../strategies/index.ts";
import type { AnalystAi } from "../strategies/types.ts";
import { newId } from "../util.ts";
import { computeMetrics, downsample } from "./metrics.ts";

/** Bars held in memory, served as of the simulated clock. Doubles as the Simulator's price source. */
export class HistoricalFeed implements BarFeed, PriceSource {
  constructor(
    private readonly bars: Map<string, Bar[]>,
    private readonly tf: number,
  ) {}

  /** Index of the first bar with ts > maxTs. */
  private upper(list: Bar[], maxTs: number): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as Bar).ts <= maxTs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  closedBars(symbol: string, _timeframe: Timeframe, upTo: number, count: number): Bar[] {
    const list = this.bars.get(symbol) ?? [];
    const end = this.upper(list, upTo - this.tf);
    return list.slice(Math.max(0, end - count), end);
  }

  async firstOpenAtOrAfter(
    symbol: string,
    ts: number,
    now: number,
  ): Promise<{ price: number; ts: number } | null> {
    const list = this.bars.get(symbol) ?? [];
    const i = this.upper(list, ts - 1);
    const bar = list[i];
    return bar && bar.ts + this.tf <= now ? { price: bar.o, ts: bar.ts } : null;
  }

  lastClose(symbol: string, now: number): number | null {
    const list = this.bars.get(symbol) ?? [];
    const bar = list[this.upper(list, now - this.tf) - 1];
    return bar ? bar.c : null;
  }
}

export interface BacktestDeps {
  bars: BarStore;
  calendar: UsEquityCalendar;
  /** Builds the AI used for AI strategies; it must respect spec.aiMaxCalls. */
  ai?: (clock: Clock) => (AnalystAi & { calls: number; costUsd: number }) | null;
  onProgress?: (fraction: number) => void;
  /** Receives every decision (tests use this for look-ahead and parity checks). */
  onDecision?: (d: Decision) => void;
}

/** History needed before `from` so indicators are warm on the first bar. */
export function warmupMs(
  spec: Pick<BacktestSpec, "symbols" | "timeframe">,
  warmupBars: number,
): number {
  const stocks = spec.symbols.some((s) => assetClassOf(s) === "stock");
  return (warmupBars + 50) * TIMEFRAME_MS[spec.timeframe] * (stocks ? 6 : 1.2);
}

export async function runBacktest(
  spec: BacktestSpec,
  deps: BacktestDeps,
  id = newId("bt"),
): Promise<Backtest> {
  const strategy = getStrategy(spec.strategyId);
  const params = parseParams(strategy, spec.params);
  const tf = TIMEFRAME_MS[spec.timeframe];
  const start = spec.from - warmupMs(spec, strategy.warmup(params));
  await deps.bars.ensureRange(spec.symbols, spec.timeframe, start, spec.to);
  const data = new Map(
    spec.symbols.map((s) => [s, deps.bars.range(s, spec.timeframe, start, spec.to)]),
  );
  if ([...data.values()].every((b) => b.length === 0)) {
    throw new DataError(
      `No ${spec.timeframe} bars stored for ${spec.symbols.join(", ")} in that range`,
    );
  }

  const mem = Store.open(":memory:");
  const clock = new SimClock(spec.from);
  const account: Omit<Account, "hasKeys"> = {
    id: "acct_backtest",
    name: "Backtest",
    broker: "sim",
    mode: "sim",
    startingCash: spec.startingCash,
    createdAt: spec.from,
  };
  mem.upsertAccount(account);
  const bot: Bot = {
    id: "bot_backtest",
    name: "Backtest",
    strategyId: spec.strategyId,
    params,
    symbols: spec.symbols,
    timeframe: spec.timeframe,
    accountId: account.id,
    dollarsPerTrade: spec.dollarsPerTrade,
    risk: spec.risk,
    status: "running",
    backtestId: null,
    createdAt: spec.from,
    updatedAt: spec.from,
  };
  mem.saveBot(bot);

  const feed = new HistoricalFeed(data, tf);
  const sim = new SimBroker({
    accountId: account.id,
    store: mem,
    prices: feed,
    clock,
    startingCash: spec.startingCash,
    slippageBps: spec.slippageBps,
    feeBps: spec.feeBps,
  });
  const orders = new Orders({ store: mem, brokerFor: () => sim, clock, events: nullSink });
  const ai = strategy.usesAi ? (deps.ai?.(clock) ?? null) : null;
  const events: EventSink = deps.onDecision
    ? { emit: (m) => m.type === "decision" && deps.onDecision?.(m.data), event() {} }
    : nullSink;
  const runner = new Runner({
    store: mem,
    feed,
    orders,
    brokerFor: () => sim,
    accountMode: () => "sim",
    ai,
    clock,
    events,
    killSwitch: () => false,
  });

  const closes = new Set<number>();
  for (const list of data.values()) {
    for (const b of list) if (b.ts + tf > spec.from && b.ts + tf <= spec.to) closes.add(b.ts + tf);
  }
  const timeline = [...closes].sort((a, b) => a - b);
  const equity: EquityPoint[] = [];
  let exposed = 0;
  let lastReport = 0;
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i] as number;
    clock.set(t);
    await orders.sync();
    for (const symbol of spec.symbols) {
      if (isCheckTime(deps.calendar, symbol, t)) await runner.tick(bot, symbol, t);
    }
    const acct = await sim.account();
    equity.push({ ts: t, equity: acct.equity, cash: acct.cash });
    if ((await sim.positions()).length) exposed++;
    if (deps.onProgress && i / timeline.length - lastReport >= 0.05) {
      lastReport = i / timeline.length;
      deps.onProgress(lastReport);
    }
  }

  const trades = mem.listTrades({ botId: bot.id, limit: 1_000_000 }).reverse();
  const allOrders = mem.listOrders({ botId: bot.id, limit: 1_000_000 });
  const byId = new Map(allOrders.map((o) => [o.id, o]));
  const fills: BacktestFill[] = mem.fillsForOrders(allOrders.map((o) => o.id)).map((f) => {
    const o = byId.get(f.orderId);
    return {
      symbol: o?.symbol ?? "",
      side: o?.side ?? "buy",
      ts: f.ts,
      price: f.price,
      qty: f.qty,
    };
  });
  const metrics = computeMetrics({
    spec,
    equity,
    trades,
    exposureSteps: exposed,
    totalSteps: timeline.length,
    bars: data,
    aiCalls: ai?.calls ?? 0,
    aiCostUsd: ai?.costUsd ?? 0,
  });
  const decisionCounts = mem.decisionCounts(bot.id, 0) as Backtest["decisionCounts"];
  mem.db.close();
  return {
    id,
    createdAt: Date.now(),
    status: "done",
    spec: { ...spec, params },
    metrics,
    trades,
    equity: downsample(equity, 1500),
    fills,
    decisionCounts,
    error: null,
  };
}

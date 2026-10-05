// Composition root. Builds every part once and exposes the operations the API and the CLI share.
import { existsSync, rmSync } from "node:fs";
import type { AccountInput, BacktestInput, BotInput } from "@shared/schemas.ts";
import type {
  Account,
  Backtest,
  BacktestSpec,
  Bot,
  BotSummary,
  DecisionKind,
  Status,
  Trade,
} from "@shared/types.ts";
import { assetClassOf, TIMEFRAME_MS } from "@shared/types.ts";
import { BacktestAnalyst, LiveAnalyst } from "./ai/analyst.ts";
import { AiClient } from "./ai/client.ts";
import { runBacktest } from "./backtest/run.ts";
import { Orders } from "./broker/orders.ts";
import { Brokers } from "./broker/registry.ts";
import type { PriceSource } from "./broker/sim.ts";
import { paths, SecretsFile, VERSION } from "./config.ts";
import { nextCheckTime, UsEquityCalendar } from "./core/calendar.ts";
import { type Clock, FastClock, realClock } from "./core/clock.ts";
import { EventBus } from "./core/events.ts";
import { Runner } from "./core/runner.ts";
import { Scheduler } from "./core/scheduler.ts";
import { SettingsService } from "./core/settings.ts";
import { AlpacaData, type BarProvider } from "./data/alpaca-data.ts";
import { BarStore } from "./data/bar-store.ts";
import { SyntheticData } from "./data/synthetic.ts";
import { InputError } from "./errors.ts";
import { Store } from "./store/store.ts";
import { getStrategy, parseParams } from "./strategies/index.ts";
import { errorMessage, localDayStart, newId, round } from "./util.ts";

const DAY = 86_400_000;

export interface EngineOptions {
  home?: string;
  demo?: boolean;
  /** Start the demo from a fresh database (only `exva run --demo` does this). */
  resetDemo?: boolean;
  dbFile?: string;
  clock?: Clock;
  provider?: BarProvider;
  alpacaBaseUrl?: string;
  alpacaDataUrl?: string;
  fetch?: typeof fetch;
}

export class Engine {
  readonly mode: "live" | "demo";
  readonly startedAt: number;
  readonly store: Store;
  readonly secrets: SecretsFile;
  readonly settings: SettingsService;
  readonly calendar = new UsEquityCalendar();
  readonly clock: Clock;
  readonly events: EventBus;
  readonly bars: BarStore;
  readonly brokers: Brokers;
  readonly orders: Orders;
  readonly ai: AiClient;
  readonly runner: Runner;
  readonly scheduler: Scheduler;
  private readonly provider: BarProvider;
  private readonly lastSync = new Map<string, number>();

  constructor(o: EngineOptions = {}) {
    const p = paths(o.home);
    this.mode = o.demo ? "demo" : "live";
    if (o.demo && o.resetDemo && !o.dbFile) {
      for (const f of [p.demoDb, `${p.demoDb}-wal`, `${p.demoDb}-shm`])
        if (existsSync(f)) rmSync(f);
    }
    this.store = Store.open(o.dbFile ?? (o.demo ? p.demoDb : p.db));
    this.secrets = new SecretsFile(o.demo ? `${p.home}/demo-secrets.json` : p.secrets);
    this.settings = new SettingsService(this.store, this.secrets);
    this.clock = o.clock ?? (o.demo ? new FastClock(demoStart(this.calendar), 60) : realClock);
    this.startedAt = this.clock.now();
    this.events = new EventBus(this.store, this.clock);
    this.provider =
      o.provider ??
      (o.demo
        ? new SyntheticData(this.calendar)
        : new AlpacaData({
            keys: () => this.brokers.dataKeys(),
            stockFeed: () => this.settings.get().data.stockFeed,
            baseUrl: o.alpacaDataUrl,
            fetch: o.fetch,
          }));
    this.bars = new BarStore(
      this.store,
      () => this.provider,
      this.clock,
      (s) => this.feedFor(s),
    );
    this.brokers = new Brokers({
      store: this.store,
      secrets: this.secrets,
      clock: this.clock,
      prices: this.simPrices(),
      alpacaBaseUrl: o.alpacaBaseUrl,
      fetch: o.fetch,
    });
    this.orders = new Orders({
      store: this.store,
      brokerFor: (id) => this.brokers.get(id),
      clock: this.clock,
      events: this.events,
    });
    this.ai = new AiClient({
      store: this.store,
      settings: () => this.settings.get().ai,
      apiKey: () => this.settings.aiKey(),
      clock: this.clock,
      fetch: o.fetch,
    });
    this.runner = new Runner({
      store: this.store,
      feed: this.bars,
      orders: this.orders,
      brokerFor: (id) => this.brokers.get(id),
      accountMode: (id) => this.brokers.mode(id),
      ai: new LiveAnalyst({ ai: this.ai, store: this.store, clock: this.clock }),
      clock: this.clock,
      events: this.events,
      killSwitch: () => this.settings.get().killSwitch,
    });
    this.scheduler = new Scheduler({
      store: this.store,
      runner: this.runner,
      bars: this.bars,
      orders: this.orders,
      brokers: this.brokers,
      calendar: this.calendar,
      clock: this.clock,
      events: this.events,
      settings: this.settings,
      writeJournal: async () => (await import("./ai/insights.ts")).writeJournal(this),
      journalReady: () => true,
    });
    if (o.demo && this.store.listAccounts().length === 0) this.seedDemo();
  }

  /** Feed key for stored bars: crypto, iex/sip for stocks, synthetic in demo mode. */
  feedFor(symbol: string): string {
    if (this.provider.name !== "alpaca") return this.provider.name;
    return assetClassOf(symbol) === "crypto" ? "crypto" : this.settings.get().data.stockFeed;
  }

  /** Simulator accounts fill at the open of the first 5-minute bar after the decision. */
  private simPrices(): PriceSource {
    return {
      firstOpenAtOrAfter: async (symbol, ts, now) => {
        const last = this.lastSync.get(symbol) ?? 0;
        if (now - last > 20_000) {
          this.lastSync.set(symbol, now);
          await this.bars.sync([symbol], "5m", now, 10).catch(() => {});
        }
        const bar = this.bars.range(symbol, "5m", ts, now).find((b) => b.ts + 300_000 <= now);
        return bar ? { price: bar.o, ts: bar.ts } : null;
      },
      lastClose: (symbol, now) => {
        for (const tf of ["5m", "15m", "1h"] as const) {
          const bar = this.bars.closedBars(symbol, tf, now, 1)[0];
          if (bar) return bar.c;
        }
        return null;
      },
    };
  }

  async start(): Promise<void> {
    await this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  // ---------------- accounts ----------------

  private hasKeys = (id: string) => Boolean(this.secrets.read().accounts[id]);

  listAccounts(): Account[] {
    return this.store.listAccounts(this.hasKeys);
  }

  saveAccount(input: AccountInput): Account {
    const existing = input.id ? this.store.getAccount(input.id) : null;
    if (input.id && !existing) throw new InputError(`Unknown account ${input.id}`);
    const id = existing?.id ?? newId("acct");
    this.store.upsertAccount({
      id,
      name: input.name,
      broker: existing?.broker ?? input.broker,
      mode: (existing?.broker ?? input.broker) === "alpaca" ? "paper" : "sim",
      startingCash:
        input.broker === "sim" ? (input.startingCash ?? existing?.startingCash ?? 100_000) : null,
      createdAt: existing?.createdAt ?? this.clock.now(),
    });
    if (input.keyId && input.secretKey) {
      const keys = { keyId: input.keyId, secretKey: input.secretKey };
      this.secrets.update((s) => {
        s.accounts[id] = keys;
      });
    }
    this.brokers.invalidate(id);
    if (!existing && input.broker === "sim") {
      const cash = input.startingCash ?? 100_000;
      this.store.insertEquity(id, { ts: this.clock.now(), equity: cash, cash });
    }
    return this.store.getAccount(id, this.hasKeys) as Account;
  }

  async testAccount(id: string): Promise<{ ok: boolean; message: string; equity: number | null }> {
    try {
      const a = await this.brokers.get(id).account();
      this.store.insertEquity(id, { ts: this.clock.now(), equity: a.equity, cash: a.cash });
      const kind = a.mode === "paper" ? "Paper account" : "Simulator";
      return {
        ok: true,
        message: `${kind} connected, equity $${round(a.equity).toLocaleString("en-US")}`,
        equity: a.equity,
      };
    } catch (err) {
      return { ok: false, message: errorMessage(err), equity: null };
    }
  }

  // ---------------- bots ----------------

  listBots(): Bot[] {
    return this.store.listBots();
  }

  getBot(id: string): Bot {
    const bot = this.store.getBot(id);
    if (!bot) throw new InputError(`Unknown bot ${id}`);
    return bot;
  }

  private validate(input: BotInput): BotInput {
    const strategy = getStrategy(input.strategyId);
    if (!this.store.getAccount(input.accountId))
      throw new InputError("Pick an account for this bot");
    if (!strategy.timeframes.includes(input.timeframe))
      throw new InputError(`${strategy.name} does not support ${input.timeframe}`);
    return {
      ...input,
      symbols: [...new Set(input.symbols)],
      params: parseParams(strategy, input.params),
    };
  }

  createBot(input: BotInput): { bot: Bot; warnings: string[] } {
    const v = this.validate(input);
    const now = this.clock.now();
    const bot: Bot = {
      ...v,
      id: newId("bot"),
      status: "stopped",
      backtestId: v.backtestId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveBot(bot);
    this.events.emit({ type: "bot", data: bot });
    return { bot, warnings: this.botWarnings(bot) };
  }

  updateBot(id: string, patch: Partial<BotInput>): { bot: Bot; warnings: string[] } {
    const cur = this.getBot(id);
    const v = this.validate({ ...cur, ...patch, backtestId: patch.backtestId ?? cur.backtestId });
    const bot: Bot = {
      ...cur,
      ...v,
      backtestId: v.backtestId ?? null,
      updatedAt: this.clock.now(),
    };
    this.store.saveBot(bot);
    this.events.emit({ type: "bot", data: bot });
    return { bot, warnings: this.botWarnings(bot) };
  }

  deleteBot(id: string): void {
    const bot = this.getBot(id);
    if (this.store.listTrades({ botId: id, status: "open" }).length) {
      throw new InputError(
        `${bot.name} still holds positions. Stop it with "close positions" first.`,
      );
    }
    this.store.deleteBot(id);
    this.events.event("info", "bot_deleted", `Deleted ${bot.name}`, { botId: id });
  }

  botWarnings(bot: Bot): string[] {
    const warnings: string[] = [];
    const strategy = getStrategy(bot.strategyId);
    for (const other of this.store.listBots()) {
      if (other.id === bot.id || other.accountId !== bot.accountId) continue;
      const shared = other.symbols.filter((s) => bot.symbols.includes(s));
      if (shared.length) {
        warnings.push(
          `${other.name} also trades ${shared.join(", ")} on this account. Only one bot can hold a symbol at a time.`,
        );
      }
    }
    if (bot.symbols.some((s) => assetClassOf(s) === "stock")) {
      warnings.push(
        "Stock symbols only trade 9:30–16:00 ET on market days. Crypto trades around the clock.",
      );
    }
    if (strategy.usesAi && !this.ai.configured())
      warnings.push("This strategy needs an AI key. Add one in Settings.");
    const account = this.store.getAccount(bot.accountId);
    if (account?.broker === "alpaca" && !this.hasKeys(account.id))
      warnings.push(`${account.name} has no API keys yet.`);
    return warnings;
  }

  async startBot(id: string): Promise<Bot> {
    const bot = this.getBot(id);
    this.brokers.get(bot.accountId); // fails early on missing keys
    const started: Bot = { ...bot, status: "running", updatedAt: this.clock.now() };
    this.store.saveBot(started);
    this.events.emit({ type: "bot", data: started });
    const next = nextCheckTime(this.calendar, bot.symbols, bot.timeframe, this.clock.now());
    this.events.event("info", "bot_started", `Started ${bot.name}`, {
      botId: id,
      nextCheckAt: next,
    });
    const strategy = getStrategy(bot.strategyId);
    const warm = strategy.warmup(parseParams(strategy, bot.params));
    this.bars.sync(bot.symbols, bot.timeframe, this.clock.now(), warm + 50).catch((err) => {
      this.events.event(
        "warn",
        "data_error",
        `Could not backfill ${bot.name}: ${errorMessage(err)}`,
        { botId: id },
      );
    });
    return started;
  }

  async stopBot(id: string, closePositions = false): Promise<Bot> {
    const bot = this.getBot(id);
    const stopped: Bot = { ...bot, status: "stopped", updatedAt: this.clock.now() };
    this.store.saveBot(stopped);
    this.events.emit({ type: "bot", data: stopped });
    let closed = 0;
    if (closePositions) {
      for (const t of this.store.listTrades({ botId: id, status: "open" })) {
        if (this.store.activeOrderFor(id, t.symbol)) continue;
        await this.orders.submit({
          bot,
          symbol: t.symbol,
          side: "sell",
          qty: t.qty - t.exitQty,
          refTs: this.clock.now(),
          decisionId: null,
          reason: "manual_close",
        });
        closed++;
      }
    }
    this.events.event(
      "info",
      "bot_stopped",
      `Stopped ${bot.name}${closed ? `, closing ${closed} position(s)` : ""}`,
      { botId: id },
    );
    return stopped;
  }

  summary(botId: string): BotSummary {
    const bot = this.getBot(botId);
    const now = this.clock.now();
    const since = localDayStart(now);
    const byCode = this.store.decisionCounts(botId, since) as BotSummary["byCode"];
    const counts: Record<DecisionKind, number> = { buy: 0, sell: 0, hold: 0, skip: 0, error: 0 };
    for (const c of byCode) counts[c.kind] += c.count;
    let closest: BotSummary["closest"] = null;
    let best = Number.POSITIVE_INFINITY;
    for (const d of this.store.listDecisions(botId, { since, kinds: ["hold"], limit: 5_000 })) {
      const dist = d.values.distance;
      if (dist !== undefined && dist < best) {
        best = dist;
        closest = { symbol: d.symbol, barTs: d.barTs, message: d.message };
      }
    }
    const today = this.store.listTrades({ botId, since });
    const closedToday = today.filter((t) => t.status === "closed" && (t.closedAt ?? 0) >= since);
    const open = this.withMarks(this.store.listTrades({ botId, status: "open" }));
    const nextCheckAt =
      bot.status === "running"
        ? nextCheckTime(this.calendar, bot.symbols, bot.timeframe, now)
        : null;
    const stocksOnly = bot.symbols.every((s) => assetClassOf(s) === "stock");
    return {
      botId,
      since,
      checks: byCode.reduce((s, c) => s + c.count, 0),
      counts,
      byCode,
      closest,
      tradesToday: closedToday.length,
      pnlToday: round(
        closedToday.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) +
          open.reduce((s, t) => s + (t.unrealizedPnl ?? 0), 0),
      ),
      openPositions: open.length,
      lastDecision: this.store.listDecisions(botId, { limit: 1 })[0] ?? null,
      nextCheckAt,
      sleepingUntil:
        stocksOnly && nextCheckAt && !this.calendar.isOpen(now)
          ? (this.calendar.nextOpen(now) ?? nextCheckAt)
          : null,
    };
  }

  // ---------------- trades, charts, equity ----------------

  /** Adds the latest price and unrealized P&L to open trades. */
  withMarks(trades: Trade[]): Trade[] {
    const now = this.clock.now();
    return trades.map((t) => {
      if (t.status !== "open") return t;
      const tf = this.store.getBot(t.botId)?.timeframe ?? "5m";
      const px = this.bars.closedBars(t.symbol, tf, now, 1)[0]?.c ?? null;
      return {
        ...t,
        lastPrice: px,
        unrealizedPnl: px === null ? null : round((px - t.entryPrice) * (t.qty - t.exitQty)),
      };
    });
  }

  async chart(
    symbol: string,
    timeframe: Bot["timeframe"],
    from: number,
    to: number,
    botId?: string,
  ) {
    await this.bars.ensureRange([symbol], timeframe, from, to).catch(() => {});
    const bars = this.bars.range(symbol, timeframe, from, to);
    const markers = this.store
      .fillsForSymbol(symbol, from, to + TIMEFRAME_MS[timeframe], botId)
      .map((f) => ({
        ts: f.ts,
        side: f.side as "buy" | "sell",
        price: f.price,
        qty: f.qty,
        botId: f.botId,
      }));
    return { symbol, timeframe, bars, markers };
  }

  equity(accountId: string | undefined, from: number, to: number) {
    const id = accountId ?? this.store.listAccounts()[0]?.id;
    return id ? this.store.equitySeries(id, from, to) : [];
  }

  setKillSwitch(on: boolean): void {
    this.settings.setKillSwitch(on);
    this.events.event(
      on ? "warn" : "info",
      "kill_switch",
      on ? "Kill switch ON: all trading stopped" : "Kill switch off: trading resumed",
    );
    this.events.emit({ type: "status" });
  }

  status(): Status {
    const now = this.clock.now();
    const s = this.settings.get();
    const accounts = this.store.listAccounts(this.hasKeys).map((a) => {
      const last = this.store.equitySeries(a.id, now - 15 * 60_000, now).at(-1);
      if (a.broker === "sim") {
        // The simulator is local and always reachable; before its first snapshot it holds its starting cash.
        const equity =
          last?.equity ?? this.store.equitySeries(a.id, 0, now).at(-1)?.equity ?? a.startingCash;
        const sim = { id: a.id, name: a.name, broker: a.broker, ok: true, message: "Simulator" };
        return { ...sim, equity, cash: last?.cash ?? equity };
      }
      const ok = Boolean(last) && a.hasKeys;
      const message = !a.hasKeys ? "No API keys" : last ? "Connected" : "No response in 15 min";
      return {
        id: a.id,
        name: a.name,
        broker: a.broker,
        ok,
        message,
        equity: last?.equity ?? null,
        cash: last?.cash ?? null,
      };
    });
    const recent = this.store.decisionCounts(null, now - 30 * 60_000);
    const dataErrors = recent
      .filter((c) => c.code === "data_fetch_failed")
      .reduce((n, c) => n + c.count, 0);
    const stale = recent.filter((c) => c.code === "stale_data").reduce((n, c) => n + c.count, 0);
    const spent = round(this.ai.spentToday(), 4);
    const gaps = this.store
      .listEvents({ kind: "sleep_gap", since: now - DAY, limit: 20 })
      .map((e) => ({ from: Number(e.data?.from), to: Number(e.data?.to) }));
    const running = this.store.listBots().filter((b) => b.status === "running").length;
    const ai = {
      configured: s.ai.hasKey,
      model: s.ai.model,
      spentTodayUsd: spent,
      budgetUsd: s.ai.dailyBudgetUsd,
      ok: s.ai.hasKey && spent < s.ai.dailyBudgetUsd,
    };
    const data = dataErrors
      ? { ok: false, message: `${dataErrors} market-data error(s) in the last 30 min` }
      : stale
        ? { ok: true, message: `${stale} stale bar(s) in the last 30 min` }
        : { ok: true, message: "Fresh" };
    const accountProblem = running > 0 && accounts.some((a) => !a.ok);
    const health =
      s.killSwitch || accountProblem || !data.ok
        ? "error"
        : (s.ai.hasKey && !ai.ok) || gaps.length
          ? "warn"
          : "ok";
    return {
      version: VERSION,
      mode: this.mode,
      startedAt: this.startedAt,
      now,
      killSwitch: s.killSwitch,
      botsRunning: running,
      accounts,
      data,
      ai,
      market: {
        stocksOpen: this.calendar.isOpen(now),
        nextOpen: this.calendar.nextOpen(now),
        nextClose: this.calendar.nextClose(now),
      },
      sleepGaps: gaps,
      health,
    };
  }

  // ---------------- backtests ----------------

  backtestSpec(input: BacktestInput): BacktestSpec {
    const strategy = getStrategy(input.strategyId);
    const tf = TIMEFRAME_MS[input.timeframe];
    const to = input.to ?? Math.floor(this.clock.now() / tf) * tf;
    const from = input.from ?? to - input.days * DAY;
    if (from >= to) throw new InputError("The backtest start must be before its end");
    return { ...input, params: parseParams(strategy, input.params), from, to };
  }

  async backtest(
    spec: BacktestSpec,
    id = newId("bt"),
    onProgress?: (p: number) => void,
  ): Promise<Backtest> {
    return runBacktest(
      spec,
      {
        bars: this.bars,
        calendar: this.calendar,
        ai: () =>
          this.ai.configured() && spec.aiMaxCalls > 0
            ? new BacktestAnalyst(this.ai, spec.aiMaxCalls)
            : null,
        onProgress,
      },
      id,
    );
  }

  /** Starts a saved backtest in the background and returns its id immediately. */
  startBacktest(input: BacktestInput): string {
    const spec = this.backtestSpec(input);
    const id = newId("bt");
    const pending: Backtest = {
      id,
      createdAt: this.clock.now(),
      status: "running",
      spec,
      metrics: null,
      trades: [],
      equity: [],
      fills: [],
      decisionCounts: [],
      error: null,
    };
    this.store.saveBacktest(pending);
    const progress = (p: number) =>
      this.events.emit({ type: "backtest", data: { id, status: "running", progress: p } });
    this.backtest(spec, id, progress)
      .then((bt) => this.store.saveBacktest({ ...bt, createdAt: pending.createdAt }))
      .catch((err) =>
        this.store.saveBacktest({ ...pending, status: "error", error: errorMessage(err) }),
      )
      .finally(() =>
        this.events.emit({
          type: "backtest",
          data: { id, status: this.store.getBacktest(id)?.status ?? "error", progress: 1 },
        }),
      );
    return id;
  }

  private seedDemo(): void {
    const now = this.clock.now();
    this.store.upsertAccount({
      id: "acct_demo",
      name: "Simulator",
      broker: "sim",
      mode: "sim",
      startingCash: 100_000,
      createdAt: now,
    });
    const risk = {
      stopLossPct: null,
      takeProfitPct: null,
      maxHoldBars: null,
      maxPositions: 10,
      dailyLossLimitUsd: 500,
    };
    const bots: Omit<
      Bot,
      "id" | "createdAt" | "updatedAt" | "backtestId" | "accountId" | "status"
    >[] = [
      {
        name: "Heartbeat",
        strategyId: "heartbeat",
        params: { holdBars: 1 },
        symbols: ["BTC/USD"],
        timeframe: "5m",
        dollarsPerTrade: 100,
        risk,
      },
      {
        name: "Crypto Trend",
        strategyId: "ema-cross",
        params: { fast: 9, slow: 21 },
        symbols: ["ETH/USD", "SOL/USD"],
        timeframe: "15m",
        dollarsPerTrade: 1_000,
        risk,
      },
      {
        name: "ETF Dip Buyer",
        strategyId: "rsi-dip",
        params: { period: 2, buyBelow: 10, sellAbove: 70 },
        symbols: ["SPY", "QQQ", "IWM"],
        timeframe: "15m",
        dollarsPerTrade: 1_000,
        risk,
      },
    ];
    for (const b of bots) {
      this.store.saveBot({
        ...b,
        id: newId("bot"),
        accountId: "acct_demo",
        status: "running",
        backtestId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.settings.patch({ onboarded: true });
  }
}

/** Demo time starts 30 minutes before the most recent regular session opened, so stock bots trade soon. */
function demoStart(calendar: UsEquityCalendar): number {
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    const s = calendar.sessionAt(now - i * DAY);
    if (s && s.open < now) return s.open - 30 * 60_000;
  }
  return now;
}

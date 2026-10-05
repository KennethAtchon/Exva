// The live loop: wake at each bar close, fetch the bar, tick every due bot. Plus order sync,
// position reconcile, equity snapshots, sleep-gap detection and the daily journal.
import type { Bot, Trade } from "@shared/types.ts";
import { assetClassOf, TIMEFRAME_MS } from "@shared/types.ts";
import type { Orders } from "../broker/orders.ts";
import type { Brokers } from "../broker/registry.ts";
import { symbolKey } from "../broker/types.ts";
import type { BarStore } from "../data/bar-store.ts";
import type { Store } from "../store/store.ts";
import { getStrategy, parseParams } from "../strategies/index.ts";
import { errorMessage, hhmm, localDateKey, mapLimit, round } from "../util.ts";
import { etDateKey, isCheckTime, nextCheckTime, type UsEquityCalendar } from "./calendar.ts";
import type { Clock } from "./clock.ts";
import type { EventBus } from "./events.ts";
import type { Runner } from "./runner.ts";
import type { SettingsService } from "./settings.ts";

const SETTLE_MS = 5_000; // give the provider a moment to publish the just-closed bar
const MISSING_BAR_WAIT_MS = 60_000;
const GAP_MS = 3 * 60_000;
const MAX_LATE_MS = 60_000;

export interface SchedulerDeps {
  store: Store;
  runner: Runner;
  bars: BarStore;
  orders: Orders;
  brokers: Brokers;
  calendar: UsEquityCalendar;
  clock: Clock;
  events: EventBus;
  settings: SettingsService;
  writeJournal: () => Promise<unknown>;
  journalReady: () => boolean;
}

export class Scheduler {
  private stopped = false;
  private lastDue = 0;
  private readonly driftWarned = new Map<string, number>();
  private readonly goneSince = new Map<string, number>();
  /** Bots with a check in progress, and the bar it is for. */
  private readonly busy = new Map<string, number>();

  constructor(private readonly d: SchedulerDeps) {}

  async start(): Promise<void> {
    this.beat();
    await this.d.orders.sync().catch(() => {});
    await this.reconcile().catch(() => {});
    await this.refreshCalendar().catch(() => {});
    const running = this.runningBots();
    this.d.events.event(
      "info",
      "engine_started",
      running.length ? `Engine started; ${running.length} bot(s) resumed` : "Engine started",
      {
        bots: running.map((b) => b.name),
      },
    );
    this.loop(() => this.tickLoop());
    this.every(3_000, () => this.d.orders.sync());
    this.every(60_000, async () => {
      this.beat();
      await this.reconcile();
    });
    this.every(300_000, () => this.snapshotEquity());
    this.every(60_000, () => this.maybeJournal());
    this.every(6 * 3_600_000, () => this.refreshCalendar());
    this.snapshotEquity().catch(() => {});
  }

  stop(): void {
    this.stopped = true;
  }

  private runningBots(): Bot[] {
    return this.d.store.listBots().filter((b) => b.status === "running");
  }

  private loop(fn: () => Promise<void>): void {
    fn().catch((err) => {
      console.error("scheduler loop crashed", err);
      this.d.events.event("error", "engine_error", `Scheduler error: ${errorMessage(err)}`);
      if (!this.stopped) setTimeout(() => this.loop(fn), 5_000);
    });
  }

  private every(ms: number, fn: () => Promise<unknown> | unknown): void {
    this.loop(async () => {
      while (!this.stopped) {
        await this.d.clock.sleep(ms);
        if (this.stopped) return;
        try {
          await fn();
        } catch (err) {
          console.error("periodic task failed", err);
        }
      }
    });
  }

  /** Earliest upcoming bar close across running bots. */
  nextDue(after: number): number | null {
    let next: number | null = null;
    for (const bot of this.runningBots()) {
      const t = nextCheckTime(this.d.calendar, bot.symbols, bot.timeframe, after);
      if (t !== null && (next === null || t < next)) next = t;
    }
    return next;
  }

  private async tickLoop(): Promise<void> {
    while (!this.stopped) {
      const now = this.d.clock.now();
      // Next bar after the last one we processed. A late wake-up (up to a minute) still runs its bar;
      // older bars are not replayed after a sleep. Those are reported as a sleep gap instead.
      const due = this.nextDue(Math.max(this.lastDue, now - SETTLE_MS - MAX_LATE_MS));
      if (due === null) {
        await this.d.clock.sleep(15_000);
        continue;
      }
      const wait = due + SETTLE_MS - now;
      if (wait > 0) {
        await this.d.clock.sleep(Math.min(wait, 15_000)); // re-plan often so new bots are picked up
        continue;
      }
      this.lastDue = due;
      // Not awaited: a slow bot (AI calls, a late bar) must not make the others miss their next bar.
      this.runDue(due).catch((err) => console.error("bar check failed", err));
    }
  }

  /**
   * Check every running bot whose bar closes at `t`. Bots run independently; a bot whose previous
   * check is still going records `check_overrun` for this bar instead of piling up.
   */
  async runDue(t: number): Promise<void> {
    const runs: Promise<void>[] = [];
    for (const bot of this.runningBots()) {
      if (t % TIMEFRAME_MS[bot.timeframe] !== 0) continue;
      const symbols = bot.symbols.filter((s) => isCheckTime(this.d.calendar, s, t));
      if (!symbols.length) continue;
      if (this.busy.has(bot.id)) {
        const msg = `The ${hhmm(this.busy.get(bot.id) ?? t)} check was still running, so this bar was skipped`;
        for (const s of symbols) this.d.runner.recordSkip(bot, s, t, "check_overrun", msg);
        continue;
      }
      this.busy.set(bot.id, t);
      runs.push(
        this.runBot(bot, symbols, t)
          .catch((err) => {
            for (const s of symbols) this.d.runner.recordError(bot, s, t, err);
          })
          .finally(() => this.busy.delete(bot.id)),
      );
    }
    await Promise.all(runs);
  }

  private async runBot(bot: Bot, symbols: string[], t: number): Promise<void> {
    const strategy = getStrategy(bot.strategyId);
    let warmup = 100;
    try {
      warmup = strategy.warmup(parseParams(strategy, bot.params));
    } catch {}
    let ok = symbols;
    try {
      await this.d.bars.sync(symbols, bot.timeframe, t, warmup + 50);
    } catch {
      // One bad symbol must not fail the rest: retry one at a time and record who failed.
      ok = [];
      for (const s of symbols) {
        try {
          await this.d.bars.sync([s], bot.timeframe, t, warmup + 50);
          ok.push(s);
        } catch (err) {
          this.d.runner.recordError(bot, s, t, err);
        }
      }
    }
    if (!ok.length) return;
    await this.waitForBars(bot, ok, t, warmup).catch(() => {});
    await this.d.orders.sync(bot.accountId).catch(() => {});
    // The user may have stopped or edited the bot while bars were loading.
    const fresh = this.d.store.getBot(bot.id);
    if (fresh?.status !== "running" || fresh.timeframe !== bot.timeframe) return;
    const still = ok.filter((s) => fresh.symbols.includes(s));
    await mapLimit(still, 4, (s) => this.d.runner.tick(fresh, s, t));
  }

  /** Providers sometimes publish a bar a few seconds late. Retry briefly before calling it stale. */
  private async waitForBars(bot: Bot, symbols: string[], t: number, warmup: number): Promise<void> {
    const tf = TIMEFRAME_MS[bot.timeframe];
    const missing = () =>
      symbols.filter((s) => this.d.bars.closedBars(s, bot.timeframe, t, 1)[0]?.ts !== t - tf);
    const deadline = this.d.clock.now() + MISSING_BAR_WAIT_MS;
    while (missing().length && this.d.clock.now() < deadline && !this.stopped) {
      await this.d.clock.sleep(10_000);
      await this.d.bars.sync(missing(), bot.timeframe, t, warmup + 50);
    }
  }

  /** Records a gap when the engine (or the computer) was not running. */
  beat(): void {
    const now = this.d.clock.now();
    const last = this.d.store.getJson<number>("engine.lastBeat");
    if (last && now - last > GAP_MS) {
      this.d.events.event(
        "warn",
        "sleep_gap",
        `Exva wasn't running from ${hhmm(last)} to ${hhmm(now)} (computer asleep or app closed). Checks in that window were missed.`,
        { from: last, to: now },
      );
    }
    this.d.store.setJson("engine.lastBeat", now);
  }

  /**
   * Compare what each bot thinks it holds with what the broker holds. A position missing on two
   * checks a minute apart was sold outside Exva and is closed; a stock split is applied to it.
   */
  async reconcile(): Promise<void> {
    const now = this.d.clock.now();
    for (const account of this.d.store.listAccounts()) {
      if (account.broker !== "alpaca") continue;
      const broker = this.d.brokers.get(account.id);
      const held = new Map((await broker.positions()).map((p) => [symbolKey(p.symbol), p]));
      for (const t of this.d.store.listTrades({ accountId: account.id, status: "open" })) {
        if (this.d.store.activeOrderFor(t.botId, t.symbol)) continue;
        const mine = t.qty - t.exitQty;
        const pos = held.get(symbolKey(t.symbol));
        const theirs = pos?.qty ?? 0;
        if (theirs <= mine * 0.01) {
          const since = this.goneSince.get(t.id);
          if (since === undefined) this.goneSince.set(t.id, now);
          else if (now - since >= 60_000) {
            this.d.orders.closeOutside(t, now);
            this.goneSince.delete(t.id);
          }
          continue;
        }
        this.goneSince.delete(t.id);
        if (Math.abs(theirs - mine) <= mine * 0.01) continue; // fee dust
        // A split changes the share count AND the broker's cost basis; selling part of the
        // position outside Exva changes only the count.
        const split = splitRatio(t.symbol, theirs / mine);
        if (split && pos && Math.abs((pos.avgPrice * split) / t.entryPrice - 1) < 0.05) {
          this.applySplit(t, split, account.name);
          continue;
        }
        const lastWarned = this.driftWarned.get(t.id) ?? 0;
        if (now - lastWarned < 3_600_000) continue;
        this.driftWarned.set(t.id, now);
        this.d.events.event(
          "warn",
          "position_drift",
          `Exva thinks a bot holds ${round(mine, 6)} ${t.symbol} but ${account.name} shows ${round(theirs, 6)}. Was it traded outside Exva?`,
          { tradeId: t.id, botId: t.botId },
        );
      }
    }
  }

  /** After a split the broker holds `ratio` times the shares at 1/ratio the price; bars are refetched adjusted. */
  private applySplit(t: Trade, ratio: number, accountName: string): void {
    this.d.store.saveTrade({
      ...t,
      qty: t.qty * ratio,
      exitQty: t.exitQty * ratio,
      entryPrice: t.entryPrice / ratio,
      exitPrice: t.exitPrice === null ? null : t.exitPrice / ratio,
    });
    this.d.bars.forget(t.symbol);
    const label = ratio >= 1 ? `${round(ratio, 2)}-for-1` : `1-for-${round(1 / ratio, 2)}`;
    this.d.events.event(
      "info",
      "stock_split",
      `${t.symbol} split ${label} (${accountName} shows the new share count). Exva adjusted the position and reloaded its bars.`,
      { tradeId: t.id, botId: t.botId, ratio },
    );
  }

  async snapshotEquity(): Promise<void> {
    for (const account of this.d.store.listAccounts()) {
      try {
        const a = await this.d.brokers.get(account.id).account();
        this.d.store.insertEquity(account.id, {
          ts: this.d.clock.now(),
          equity: a.equity,
          cash: a.cash,
        });
      } catch {}
    }
    this.d.events.emit({ type: "status" });
  }

  private async maybeJournal(): Promise<void> {
    const hour = this.d.settings.get().ai.journalHour;
    const now = new Date(this.d.clock.now());
    if (hour < 0 || now.getHours() !== hour || !this.d.journalReady()) return;
    const latest = this.d.store.listEvents({ kind: "journal", limit: 1 })[0];
    if (latest && localDateKey(latest.ts) === localDateKey(now.getTime())) return;
    await this.d.writeJournal();
  }

  /** Use the broker's official calendar (holidays, special closures) when one is available. */
  private async refreshCalendar(): Promise<void> {
    for (const account of this.d.store.listAccounts()) {
      if (account.broker !== "alpaca") continue;
      const broker = this.d.brokers.get(account.id);
      if (!broker.calendar) continue;
      const now = this.d.clock.now();
      const from = etDateKey(now - 86_400_000);
      const to = etDateKey(now + 30 * 86_400_000);
      this.d.calendar.setSessions(await broker.calendar(from, to), from, to);
      return;
    }
  }
}

/** A share-count change that looks like a stock split (2-for-1, 1-for-10, ...), else null. */
export function splitRatio(symbol: string, ratio: number): number | null {
  if (assetClassOf(symbol) !== "stock" || !Number.isFinite(ratio) || ratio <= 0) return null;
  const n = ratio >= 1 ? ratio : 1 / ratio;
  const whole = Math.round(n);
  if (whole < 2 || whole > 100 || Math.abs(n - whole) > whole * 0.002) return null;
  return ratio >= 1 ? whole : 1 / whole;
}

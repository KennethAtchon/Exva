// The one reader of market data. Live ticks, AI context, exits, backtests and charts all use it.
import type { Bar, Timeframe } from "@shared/types.ts";
import { TIMEFRAME_MS } from "@shared/types.ts";
import type { Clock } from "../core/clock.ts";
import type { Store } from "../store/store.ts";
import type { BarProvider } from "./alpaca-data.ts";

const DAY = 86_400_000;

/** What the Runner needs: closed bars up to a time. */
export interface BarFeed {
  closedBars(symbol: string, timeframe: Timeframe, upTo: number, count: number): Bar[];
}

export class BarStore implements BarFeed {
  private inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly provider: () => BarProvider | null,
    private readonly clock: Clock,
    readonly feedFor: (symbol: string) => string,
  ) {}

  /** Bars that had closed by `upTo` (start + timeframe <= upTo), oldest first. */
  closedBars(symbol: string, timeframe: Timeframe, upTo: number, count: number): Bar[] {
    const end = upTo - TIMEFRAME_MS[timeframe] + 1;
    return this.store.barsBefore(symbol, timeframe, this.feedFor(symbol), end, count);
  }

  range(symbol: string, timeframe: Timeframe, from: number, to: number): Bar[] {
    return this.store.barsBetween(symbol, timeframe, this.feedFor(symbol), from, to);
  }

  /** Fetch any bars missing since the last stored one (or a backfill window), storing closed bars only. */
  async sync(symbols: string[], timeframe: Timeframe, upTo: number, minBars = 100): Promise<void> {
    const provider = this.provider();
    if (!provider || !symbols.length) return;
    const tf = TIMEFRAME_MS[timeframe];
    const backfill = Math.max(30 * DAY, minBars * tf * 6);
    let from = upTo;
    for (const s of symbols) {
      const last = this.store.lastBarTs(s, timeframe, this.feedFor(s));
      from = Math.min(from, last === null || last < upTo - backfill ? upTo - backfill : last + tf);
    }
    if (from >= upTo) return;
    await this.fetchAndStore(provider, symbols, timeframe, from, upTo);
  }

  /** Make sure [from, to) is stored, fetching the missing head and tail. Used by backtests and charts. */
  async ensureRange(
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<void> {
    const provider = this.provider();
    if (!provider) return;
    const tf = TIMEFRAME_MS[timeframe];
    const slack = 3 * DAY;
    for (const s of symbols) {
      const feed = this.feedFor(s);
      const first = this.store.firstBarTs(s, timeframe, feed);
      const last = this.store.lastBarTs(s, timeframe, feed);
      if (first === null || last === null || first > from + slack || last < to - slack - tf) {
        if (first !== null && last !== null && first <= from + slack) {
          await this.fetchAndStore(provider, [s], timeframe, last + tf, to);
        } else {
          await this.fetchAndStore(provider, [s], timeframe, from, to);
        }
      }
    }
  }

  private fetchAndStore(
    provider: BarProvider,
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
  ) {
    const key = `${symbols.join(",")}|${timeframe}|${from}|${to}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = (async () => {
      const tf = TIMEFRAME_MS[timeframe];
      const closedBefore = this.clock.now();
      const fetched = await provider.fetchBars(symbols, timeframe, from, to);
      for (const [symbol, bars] of fetched) {
        const closed = bars.filter((b) => b.ts + tf <= closedBefore && b.ts + tf <= to);
        if (closed.length) this.store.upsertBars(symbol, timeframe, this.feedFor(symbol), closed);
      }
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }
}

import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { dataCoverage, ohlcvBars } from "../../db/schema";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";

export type MarketDataProviderId = "alpaca" | "tradier" | "kraken" | "manual";

export interface BarWindow {
  start: string;
  end: string;
}

export interface GetBarsInput {
  symbol: string;
  instrumentClass: string;
  timeframe: TradingTimeframe;
  /** Live read-through: last N bars ending at now. */
  barCount?: number;
  /** Backtest / explicit window. */
  window?: BarWindow;
  /** When true, gaps throw instead of fetching provider. */
  failOnGaps?: boolean;
  provider?: MarketDataProviderId;
  /** Session-routed fetch that already normalized the wire symbol. */
  fetchOverride?: () => Promise<OhlcvBar[]>;
}

export type BarFetcher = (input: {
  symbol: string;
  instrumentClass: string;
  timeframe: TradingTimeframe;
  barCount: number;
}) => Promise<OhlcvBar[]>;

function mergeBarsByTs(a: OhlcvBar[], b: OhlcvBar[]): OhlcvBar[] {
  const byTs = new Map<string, OhlcvBar>();
  for (const bar of a) byTs.set(bar.ts, bar);
  for (const bar of b) byTs.set(bar.ts, bar);
  return [...byTs.values()].sort((left, right) =>
    left.ts.localeCompare(right.ts),
  );
}

/**
 * Point-in-time OHLCV store. Live cycles: DB first, provider on miss, write-back.
 * Backtests: DB only, fail-loud on gaps.
 */
export class MarketDataService {
  private fetchers = new Map<MarketDataProviderId, BarFetcher>();

  constructor(private readonly db: DbClient) {}

  registerFetcher(provider: MarketDataProviderId, fetcher: BarFetcher): void {
    this.fetchers.set(provider, fetcher);
  }

  async getBars(input: GetBarsInput): Promise<OhlcvBar[]> {
    if (input.window) {
      return this.getBarsInWindow(input);
    }
    const barCount = input.barCount ?? 100;
    const cached = this.readRecent(input.symbol, input.timeframe, barCount);
    if (cached.length >= barCount) return cached;

    if (input.failOnGaps) {
      throw new Error(
        `MarketData gap: ${input.symbol} ${input.timeframe} has ${cached.length}/${barCount} bars in store.`,
      );
    }

    const provider = input.provider ?? "alpaca";
    let fetched: OhlcvBar[];
    if (input.fetchOverride) {
      fetched = await input.fetchOverride();
    } else {
      const fetcher = this.fetchers.get(provider);
      if (!fetcher) {
        if (cached.length > 0) return cached;
        throw new Error(`No market-data fetcher registered for ${provider}.`);
      }
      fetched = await fetcher({
        symbol: input.symbol,
        instrumentClass: input.instrumentClass,
        timeframe: input.timeframe,
        barCount,
      });
    }
    this.writeBars(
      input.symbol,
      input.instrumentClass,
      input.timeframe,
      fetched,
      provider,
    );
    return mergeBarsByTs(cached, fetched).slice(-barCount);
  }

  freshnessLagMs(
    symbol: string,
    timeframe: TradingTimeframe,
    nowMs: number = Date.now(),
  ): number | null {
    const coverage = this.getCoverage(symbol, timeframe);
    if (!coverage) return null;
    return nowMs - Date.parse(coverage.lastTs);
  }

  getCoverage(
    symbol: string,
    timeframe: string,
  ): { firstTs: string; lastTs: string; provider: string } | null {
    const row =
      this.db.db
        .select()
        .from(dataCoverage)
        .where(
          and(
            eq(dataCoverage.symbol, symbol),
            eq(dataCoverage.timeframe, timeframe),
          ),
        )
        .get() ?? null;
    if (!row) return null;
    return {
      firstTs: row.firstTs,
      lastTs: row.lastTs,
      provider: row.provider,
    };
  }

  writeBars(
    symbol: string,
    instrumentClass: string,
    timeframe: string,
    bars: OhlcvBar[],
    provider: MarketDataProviderId,
  ): void {
    if (bars.length === 0) return;
    const ingestedAt = new Date().toISOString();
    for (const bar of bars) {
      this.db.db
        .insert(ohlcvBars)
        .values({
          id: crypto.randomUUID(),
          symbol,
          instrumentClass,
          timeframe,
          ts: bar.ts,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          provider,
          ingestedAt,
        })
        .onConflictDoNothing()
        .run();
    }
    const seed = bars[0];
    if (!seed) return;
    const firstTs = bars.reduce((min, b) => (b.ts < min ? b.ts : min), seed.ts);
    const lastTs = bars.reduce((max, b) => (b.ts > max ? b.ts : max), seed.ts);
    const existing = this.getCoverage(symbol, timeframe);
    this.db.db
      .insert(dataCoverage)
      .values({
        id: existing
          ? (this.db.db
              .select({ id: dataCoverage.id })
              .from(dataCoverage)
              .where(
                and(
                  eq(dataCoverage.symbol, symbol),
                  eq(dataCoverage.timeframe, timeframe),
                ),
              )
              .get()?.id ?? crypto.randomUUID())
          : crypto.randomUUID(),
        symbol,
        timeframe,
        firstTs: existing
          ? existing.firstTs < firstTs
            ? existing.firstTs
            : firstTs
          : firstTs,
        lastTs: existing
          ? existing.lastTs > lastTs
            ? existing.lastTs
            : lastTs
          : lastTs,
        provider,
        updatedAt: ingestedAt,
      })
      .onConflictDoUpdate({
        target: [dataCoverage.symbol, dataCoverage.timeframe],
        set: {
          firstTs: existing
            ? existing.firstTs < firstTs
              ? existing.firstTs
              : firstTs
            : firstTs,
          lastTs: existing
            ? existing.lastTs > lastTs
              ? existing.lastTs
              : lastTs
            : lastTs,
          provider,
          updatedAt: ingestedAt,
        },
      })
      .run();
  }

  private getBarsInWindow(input: GetBarsInput): OhlcvBar[] {
    const window = input.window;
    if (!window) return [];
    const rows = this.db.db
      .select()
      .from(ohlcvBars)
      .where(
        and(
          eq(ohlcvBars.symbol, input.symbol),
          eq(ohlcvBars.timeframe, input.timeframe),
          gte(ohlcvBars.ts, window.start),
          lte(ohlcvBars.ts, window.end),
        ),
      )
      .orderBy(asc(ohlcvBars.ts))
      .all();

    if (input.failOnGaps && rows.length === 0) {
      throw new Error(
        `MarketData gap: no bars for ${input.symbol} ${input.timeframe} in [${window.start}, ${window.end}].`,
      );
    }

    return rows.map((r) => ({
      ts: r.ts,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }

  private readRecent(
    symbol: string,
    timeframe: string,
    barCount: number,
  ): OhlcvBar[] {
    const rows = this.db.db
      .select()
      .from(ohlcvBars)
      .where(
        and(eq(ohlcvBars.symbol, symbol), eq(ohlcvBars.timeframe, timeframe)),
      )
      .orderBy(asc(ohlcvBars.ts))
      .all();
    return rows.slice(-barCount).map((r) => ({
      ts: r.ts,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }
}

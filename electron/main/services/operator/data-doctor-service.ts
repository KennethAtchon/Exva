import { and, eq, gte, sql } from "drizzle-orm";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { DbClient } from "../../db/client";
import { apiCallLog, dataCoverage, ohlcvBars } from "../../db/schema";
import type { EventBus } from "../infra/event-bus";
import type {
  MarketDataService,
  MarketDataProviderId,
} from "../marketdata/market-data-service";
import type { NotificationService } from "../infra/notification-service";
import type { SupervisorService } from "../supervisor/supervisor-service";
import {
  expectedBarMs,
  listBarsInCoverage,
  listCoverageSymbols,
} from "./palette-query-service";

export interface CoverageCell {
  symbol: string;
  timeframe: string;
  firstTs: string;
  lastTs: string;
  provider: string;
  feed: string | null;
  lagMs: number | null;
  freshness: "fresh" | "stale" | "dead" | "unknown";
  gapCount: number;
  gapSample: Array<{ from: string; to: string }>;
}

export interface ProviderHealthRow {
  provider: string;
  lastSuccessAt: string | null;
  errorCount24h: number;
  successCount24h: number;
  errorRate: number;
  enabled: boolean;
}

/**
 * Data Doctor: coverage matrix, gap detection, backfill, provider health,
 * nightly gap job (finish-line 08 T3).
 */
export class DataDoctorService {
  private disabledProviders = new Set<string>();

  constructor(
    private readonly deps: {
      db: DbClient;
      marketData: MarketDataService;
      eventBus: EventBus;
      notifications?: NotificationService;
      supervisor?: SupervisorService;
    },
  ) {}

  coverageMatrix(nowMs = Date.now()): CoverageCell[] {
    const rows = listCoverageSymbols(this.deps.db);
    return rows.map((row) => {
      const lagMs = this.deps.marketData.freshnessLagMs(
        row.symbol,
        row.timeframe as TradingTimeframe,
        nowMs,
      );
      const expected = expectedBarMs(row.timeframe);
      let freshness: CoverageCell["freshness"] = "unknown";
      if (lagMs == null) freshness = "unknown";
      else if (lagMs <= expected * 3) freshness = "fresh";
      else if (lagMs <= expected * 24) freshness = "stale";
      else freshness = "dead";

      const gaps = this.detectGaps(row.symbol, row.timeframe);
      const feed =
        row.feed ??
        (row.provider === "alpaca"
          ? this.deps.marketData.equityDataFeed
          : null);
      return {
        ...row,
        feed,
        lagMs,
        freshness,
        gapCount: gaps.length,
        gapSample: gaps.slice(0, 5),
      };
    });
  }

  detectGaps(
    symbol: string,
    timeframe: string,
  ): Array<{ from: string; to: string }> {
    const stamps = listBarsInCoverage(this.deps.db, symbol, timeframe);
    if (stamps.length < 2) return [];
    const expected = expectedBarMs(timeframe);
    const gaps: Array<{ from: string; to: string }> = [];
    const threshold = expected * 1.6;
    for (let i = 1; i < stamps.length; i++) {
      const prev = stamps[i - 1];
      const cur = stamps[i];
      if (!prev || !cur) continue;
      const delta = Date.parse(cur) - Date.parse(prev);
      if (!Number.isFinite(delta) || delta <= threshold) continue;
      if (timeframe === "1d" && isWeekendGap(prev, cur)) continue;
      gaps.push({ from: prev, to: cur });
    }
    return gaps;
  }

  async backfill(input: {
    symbol: string;
    timeframe: TradingTimeframe;
    instrumentClass?: string;
    provider?: MarketDataProviderId;
    barCount?: number;
  }): Promise<{ fetched: number; gapsRemaining: number }> {
    const provider = input.provider ?? "alpaca";
    if (this.disabledProviders.has(provider)) {
      throw new Error(`Provider ${provider} is disabled in Data Doctor.`);
    }
    const bars = await this.deps.marketData.getBars({
      symbol: input.symbol,
      instrumentClass: input.instrumentClass ?? "stock",
      timeframe: input.timeframe,
      barCount: input.barCount ?? 200,
      provider,
      failOnGaps: false,
    });
    const gaps = this.detectGaps(input.symbol, input.timeframe);
    this.deps.eventBus.emit("notification", {
      title: "Data Doctor backfill",
      body: `${input.symbol} ${input.timeframe}: ${bars.length} bars, ${gaps.length} gaps remain`,
      level: gaps.length > 0 ? "WARN" : "INFO",
    });
    if (gaps.length > 0 && this.deps.supervisor) {
      await this.deps.supervisor.raiseDataFreshness(
        input.symbol,
        `Gap remains after backfill (${gaps.length})`,
      );
    }
    return { fetched: bars.length, gapsRemaining: gaps.length };
  }

  providerHealth(now = new Date()): ProviderHealthRow[] {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const rows = this.deps.db.db
      .select({
        provider: apiCallLog.provider,
        status: apiCallLog.status,
        createdAt: apiCallLog.createdAt,
      })
      .from(apiCallLog)
      .where(gte(apiCallLog.createdAt, since))
      .all();

    const byProvider = new Map<
      string,
      { success: number; error: number; lastSuccess: string | null }
    >();
    for (const row of rows) {
      const cur = byProvider.get(row.provider) ?? {
        success: 0,
        error: 0,
        lastSuccess: null,
      };
      const ok = row.status === "ok" || row.status === "success";
      if (ok) {
        cur.success += 1;
        if (!cur.lastSuccess || row.createdAt > cur.lastSuccess) {
          cur.lastSuccess = row.createdAt;
        }
      } else {
        cur.error += 1;
      }
      byProvider.set(row.provider, cur);
    }

    // Always surface known market-data providers.
    for (const p of ["alpaca", "tradier", "kraken", "manual"]) {
      if (!byProvider.has(p)) {
        byProvider.set(p, { success: 0, error: 0, lastSuccess: null });
      }
    }

    return [...byProvider.entries()].map(([provider, stats]) => {
      const total = stats.success + stats.error;
      const noTraffic = total === 0;
      return {
        provider,
        lastSuccessAt: stats.lastSuccess,
        errorCount24h: stats.error,
        successCount24h: stats.success,
        // No calls → treat as fully degraded (1.0), never a quiet pass.
        errorRate: noTraffic ? 1 : stats.error / total,
        enabled: !this.disabledProviders.has(provider),
      };
    });
  }

  setProviderEnabled(provider: string, enabled: boolean): void {
    if (enabled) this.disabledProviders.delete(provider);
    else this.disabledProviders.add(provider);
  }

  /** Nightly: scan all coverage cells; notify on new gaps. */
  async runNightlyGapCheck(): Promise<{ cellsWithGaps: number }> {
    const matrix = this.coverageMatrix();
    const bad = matrix.filter((c) => c.gapCount > 0 || c.freshness === "dead");
    if (bad.length > 0) {
      const summary = bad
        .slice(0, 8)
        .map((c) => `${c.symbol}/${c.timeframe}:${c.gapCount}g`)
        .join(", ");
      this.deps.notifications?.notify(
        "Data Doctor gaps",
        `${bad.length} cells need attention: ${summary}`,
        "WARN",
      );
      for (const cell of bad.slice(0, 5)) {
        if (this.deps.supervisor) {
          await this.deps.supervisor.raiseDataFreshness(
            cell.symbol,
            `${cell.gapCount} gaps · freshness ${cell.freshness}`,
          );
        }
      }
    }
    return { cellsWithGaps: bad.length };
  }

  /** Test helper: count bars for a symbol/tf. */
  barCount(symbol: string, timeframe: string): number {
    const row = this.deps.db.db
      .select({ n: sql<number>`count(*)` })
      .from(ohlcvBars)
      .where(
        and(eq(ohlcvBars.symbol, symbol), eq(ohlcvBars.timeframe, timeframe)),
      )
      .get();
    return Number(row?.n ?? 0);
  }

  /** Test helper: delete a slice of bars to poke a gap. */
  pokeGap(
    symbol: string,
    timeframe: string,
    fromTs: string,
    toTs: string,
  ): number {
    const result = this.deps.db.db
      .delete(ohlcvBars)
      .where(
        and(
          eq(ohlcvBars.symbol, symbol),
          eq(ohlcvBars.timeframe, timeframe),
          gte(ohlcvBars.ts, fromTs),
          sql`${ohlcvBars.ts} <= ${toTs}`,
        ),
      )
      .run();
    return result.changes;
  }

  listCoverage(): (typeof dataCoverage.$inferSelect)[] {
    return this.deps.db.db.select().from(dataCoverage).all();
  }
}

/** True when the span from prev→cur only covers Fri→Mon weekend closure. */
function isWeekendGap(prevIso: string, curIso: string): boolean {
  const prev = new Date(prevIso);
  const cur = new Date(curIso);
  if (Number.isNaN(prev.getTime()) || Number.isNaN(cur.getTime())) return false;
  const prevDay = prev.getUTCDay(); // 0=Sun … 5=Fri
  const curDay = cur.getUTCDay();
  const deltaMs = cur.getTime() - prev.getTime();
  // Fri → Mon (~3d) or Fri → Tue holiday-ish up to 4d
  if (
    prevDay === 5 &&
    (curDay === 1 || curDay === 2) &&
    deltaMs <= 4.5 * DAY_MS
  ) {
    return true;
  }
  // Thu → Mon (holiday Friday)
  if (prevDay === 4 && curDay === 1 && deltaMs <= 4.5 * DAY_MS) {
    return true;
  }
  return false;
}

const DAY_MS = 24 * 60 * 60 * 1000;

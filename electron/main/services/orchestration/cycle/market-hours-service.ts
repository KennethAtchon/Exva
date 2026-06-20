import type { InstrumentClass, OffHoursTrading } from "@/lib/types";
import { isUsMarketHoliday } from "@electron/shared/instruments/us-market-holidays";
import {
  getUsEquitySession,
  nextEquityMarketOpen,
} from "@electron/shared/instruments/us-equity-session";

export type BurstInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
};

type TradabilityExclusion = {
  symbol: string;
  instrumentClass: InstrumentClass;
  reason: string;
};

export type TradabilityPartition = {
  tradable: BurstInstrument[];
  excluded: TradabilityExclusion[];
};

export class MarketHoursService {
  filterTradable(instruments: BurstInstrument[]): BurstInstrument[] {
    return this.partitionByTradability(instruments).tradable;
  }

  partitionByTradability(
    instruments: BurstInstrument[],
    now = new Date(),
    options?: {
      skipWeekendFilter?: boolean;
      /** Mock sessions only: allow stock/futures outside regular NYSE hours. */
      skipExchangeHoursFilter?: boolean;
      /**
       * Session policy for trading outside regular hours. With
       * `extended_hours`, stock/futures are tradable during the pre/post-market
       * window (placed as extended-hours limit orders downstream). Defaults to
       * `disabled` — off-hours equities are excluded.
       */
      offHoursTrading?: OffHoursTrading;
    },
  ): TradabilityPartition {
    const tradable: BurstInstrument[] = [];
    const excluded: TradabilityExclusion[] = [];
    for (const instrument of instruments) {
      const reason = this.exclusionReason(instrument, now, options);
      if (reason) {
        excluded.push({
          symbol: instrument.symbol,
          instrumentClass: instrument.instrumentClass,
          reason,
        });
      } else {
        tradable.push(instrument);
      }
    }
    return { tradable, excluded };
  }

  /** Exclusion reasons that clear simply by waiting for the market to open. */
  private static readonly MARKET_HOURS_REASONS = new Set<string>([
    "weekend_utc_market_closed",
    "market_holiday",
    "exchange_closed",
  ]);

  /**
   * When a cycle is blocked purely because the equity market is closed, the
   * earliest instant it reopens under `offHoursTrading`. Returns null if none
   * of the exclusions are market-hours-based (e.g. all were crypto), so callers
   * fall back to the normal fixed retry interval. All US equities share one
   * schedule, so a single computation covers every excluded symbol.
   */
  nextTradableAt(
    excluded: TradabilityExclusion[],
    now: Date,
    options?: { offHoursTrading?: OffHoursTrading },
  ): Date | null {
    const blockedByHours = excluded.some((row) =>
      MarketHoursService.MARKET_HOURS_REASONS.has(row.reason),
    );
    if (!blockedByHours) return null;
    return nextEquityMarketOpen(now, options?.offHoursTrading ?? "disabled");
  }

  private exclusionReason(
    instrument: BurstInstrument,
    now: Date,
    options?: {
      skipWeekendFilter?: boolean;
      skipExchangeHoursFilter?: boolean;
      offHoursTrading?: OffHoursTrading;
    },
  ): string | null {
    if (
      instrument.instrumentClass === "crypto" ||
      instrument.instrumentClass === "prediction_market"
    ) {
      return null;
    }
    const day = now.getUTCDay();
    if (!options?.skipWeekendFilter) {
      const isWeekend = day === 0 || day === 6;
      if (isWeekend) {
        return "weekend_utc_market_closed";
      }
    }
    if (
      !options?.skipExchangeHoursFilter &&
      (instrument.instrumentClass === "stock" ||
        instrument.instrumentClass === "futures")
    ) {
      if (isUsMarketHoliday(now)) {
        return "market_holiday";
      }
      const session = getUsEquitySession(now);
      if (session === "regular") {
        return null;
      }
      // Pre/post-market is tradable only when the session opts into extended
      // hours; those orders are placed as extended-hours limit orders.
      if (
        session === "extended" &&
        options?.offHoursTrading === "extended_hours"
      ) {
        return null;
      }
      return "exchange_closed";
    }
    return null;
  }
}

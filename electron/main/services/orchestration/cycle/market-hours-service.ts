import type { InstrumentClass } from "@/lib/types";

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

  private exclusionReason(
    instrument: BurstInstrument,
    now: Date,
    options?: {
      skipWeekendFilter?: boolean;
      skipExchangeHoursFilter?: boolean;
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
      const ny = new Date(
        now.toLocaleString("en-US", { timeZone: "America/New_York" }),
      );
      const hour = ny.getHours();
      const minute = ny.getMinutes();
      const minutes = hour * 60 + minute;
      const open = 9 * 60 + 30;
      const close = 16 * 60;
      if (minutes < open || minutes >= close) {
        return "exchange_closed";
      }
    }
    return null;
  }
}

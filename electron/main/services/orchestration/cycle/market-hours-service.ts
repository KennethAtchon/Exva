import type { InstrumentClass } from "@/lib/types";

export type BurstInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
};

export type TradabilityExclusion = {
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
  ): TradabilityPartition {
    const tradable: BurstInstrument[] = [];
    const excluded: TradabilityExclusion[] = [];
    for (const instrument of instruments) {
      const reason = this.exclusionReason(instrument, now);
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
  ): string | null {
    if (
      instrument.instrumentClass === "crypto" ||
      instrument.instrumentClass === "prediction_market"
    ) {
      return null;
    }
    const day = now.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) {
      return "weekend_utc_market_closed";
    }
    return null;
  }
}

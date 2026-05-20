import type { InstrumentClass } from "@/lib/types";

export type BurstInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
};

export class MarketHoursService {
  filterTradable(instruments: BurstInstrument[]): BurstInstrument[] {
    const now = new Date();
    return instruments.filter((instrument) => this.isTradableNow(instrument, now));
  }

  private isTradableNow(instrument: BurstInstrument, now: Date): boolean {
    if (instrument.instrumentClass === "crypto" || instrument.instrumentClass === "prediction_market") {
      return true;
    }
    const day = now.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    return !isWeekend;
  }
}

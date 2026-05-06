import type { InstrumentClass } from "@/lib/types";

export type BurstInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
};

export class MarketHoursService {
  /**
   * Placeholder implementation: keep all instruments. This file centralizes
   * market-hours gating so broker/exchange-specific calendars can be added
   * without changing orchestrator flow.
   */
  filterTradable(instruments: BurstInstrument[]): BurstInstrument[] {
    return instruments;
  }
}

import type { InstrumentSetRepo } from "./instrument-set-repo";

// ---------------------------------------------------------------------------
// Instrument set IDs
// ---------------------------------------------------------------------------

export const INSTRUMENT_SET_IDS = {
  LIQUID_US_ETFS: "liquid-us-etfs",
  MAJOR_CRYPTO: "major-crypto",
  COMMODITIES_FRONT_MONTH: "commodities-front-month",
  OPTIONS_FLOW_STOCKS: "options-flow-stocks",
} as const;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seedInstrumentSets(repo: InstrumentSetRepo): void {
  repo.createRevisionIfAbsent({
    setId: INSTRUMENT_SET_IDS.LIQUID_US_ETFS,
    name: "Liquid US ETFs",
    instrumentClass: "stock",
    mode: "static",
    status: "active",
    members: [
      { canonicalId: "SPY", displaySymbol: "SPY", venue: null },
      { canonicalId: "QQQ", displaySymbol: "QQQ", venue: null },
    ],
  });

  repo.createRevisionIfAbsent({
    setId: INSTRUMENT_SET_IDS.MAJOR_CRYPTO,
    name: "Major Crypto",
    instrumentClass: "crypto",
    mode: "static",
    status: "active",
    members: [
      { canonicalId: "BTC-USD", displaySymbol: "BTC-USD", venue: null },
    ],
  });

  repo.createRevisionIfAbsent({
    setId: INSTRUMENT_SET_IDS.COMMODITIES_FRONT_MONTH,
    name: "Commodities Front Month",
    instrumentClass: "futures",
    mode: "static",
    status: "active",
    members: [
      { canonicalId: "GC", displaySymbol: "GC", venue: null },
      { canonicalId: "CL", displaySymbol: "CL", venue: null },
    ],
  });

  repo.createRevisionIfAbsent({
    setId: INSTRUMENT_SET_IDS.OPTIONS_FLOW_STOCKS,
    name: "Options Flow Stocks",
    instrumentClass: "stock",
    mode: "static",
    status: "active",
    members: [
      { canonicalId: "AAPL", displaySymbol: "AAPL", venue: null },
      { canonicalId: "NVDA", displaySymbol: "NVDA", venue: null },
    ],
  });
}

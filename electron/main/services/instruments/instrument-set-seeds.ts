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

/** Strategy definition IDs each set may be paired with at configuration time. */
export const INSTRUMENT_SET_VALID_STRATEGY_IDS: Record<string, readonly string[]> =
  {
    [INSTRUMENT_SET_IDS.LIQUID_US_ETFS]: [
      "mean-reversion",
      "breakout",
      "trend-following",
    ],
    [INSTRUMENT_SET_IDS.MAJOR_CRYPTO]: [
      "mean-reversion",
      "breakout",
      "trend-following",
      "funding-basis",
    ],
    [INSTRUMENT_SET_IDS.COMMODITIES_FRONT_MONTH]: ["trend-following"],
    [INSTRUMENT_SET_IDS.OPTIONS_FLOW_STOCKS]: ["options-flow"],
  };

export function assertInstrumentSetStrategyCompatible(
  setId: string,
  strategyId: string,
): { ok: true } | { ok: false; message: string } {
  const allowed = INSTRUMENT_SET_VALID_STRATEGY_IDS[setId];
  if (!allowed) return { ok: true };
  if (allowed.includes(strategyId)) return { ok: true };
  return {
    ok: false,
    message: `Instrument set '${setId}' does not support strategy '${strategyId}' (allowed: ${allowed.join(", ")}).`,
  };
}

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

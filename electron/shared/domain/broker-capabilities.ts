import type { InstrumentClass, TradeSide } from "./enums";

/** Every broker implementation the registry can build. */
export type BrokerType =
  | "alpaca"
  | "coinbase_advanced_trade"
  | "tradovate"
  | "polymarket"
  | "mock";

/**
 * Single source of truth for which instrument classes each broker can execute.
 *
 * This is an *execution* contract, not a marketing list: a class belongs here
 * only if the adapter actually implements market data, placement, positions,
 * and close for it. Adding a class the adapter does not implement will route
 * real orders into unimplemented code paths.
 *
 * Both the adapters (`supportedInstrumentClasses`) and the broker-account DB
 * helper (`supportedInstrumentClassesFor`) read from this map so they cannot
 * drift apart.
 */
export const BROKER_SUPPORTED_INSTRUMENT_CLASSES = {
  // Alpaca executes US equities (incl. ETFs, modeled as `stock`), crypto
  // (BTC/USD, ETH/USD, ...), and single-leg US options via the same Orders API.
  alpaca: ["stock", "crypto", "options"],
  // Coinbase Advanced Trade is crypto spot only (US). Perps/futures are
  // non-US-only and not implemented here.
  coinbase_advanced_trade: ["crypto"],
  // Tradovate is a futures broker. (Options-on-futures exist but the adapter
  // does not implement them, so they are not listed here.)
  tradovate: ["futures"],
  // Polymarket is prediction markets only.
  polymarket: ["prediction_market"],
  // Mock simulator can stand in for anything.
  mock: ["stock", "crypto", "futures", "options", "prediction_market"],
} as const satisfies Record<BrokerType, readonly InstrumentClass[]>;

export function brokerSupportedInstrumentClasses(
  brokerType: BrokerType,
): readonly InstrumentClass[] {
  return BROKER_SUPPORTED_INSTRUMENT_CLASSES[brokerType];
}

/**
 * Per-class side restrictions for brokers that cannot execute both BUY and SELL
 * on a given instrument class. Omitting an entry means both sides are supported.
 */
export const BROKER_SIDE_RESTRICTIONS: Partial<
  Record<BrokerType, Partial<Record<InstrumentClass, readonly TradeSide[]>>>
> = {
  // Alpaca does not support short-selling crypto (spot long-only).
  alpaca: {
    crypto: ["BUY"],
  },
};

/**
 * Returns true if the broker supports placing an order for the given
 * instrument class and side. Checks both class support and side restrictions.
 */
export function brokerSupportsOrder(
  brokerType: BrokerType,
  instrumentClass: InstrumentClass,
  side: TradeSide,
): boolean {
  const supportedClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES[brokerType] as readonly string[];
  if (!supportedClasses.includes(instrumentClass)) return false;
  const allowedSides =
    BROKER_SIDE_RESTRICTIONS[brokerType]?.[instrumentClass] as
      | readonly string[]
      | undefined;
  if (!allowedSides) return true;
  return allowedSides.includes(side);
}

import type { InstrumentClass } from "./enums";

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
  // Alpaca executes US equities and crypto (BTC/USD, ETH/USD, ...).
  alpaca: ["stock", "crypto"],
  // Coinbase Advanced Trade is crypto spot only.
  coinbase_advanced_trade: ["crypto"],
  // Tradovate is a futures broker.
  tradovate: ["futures"],
  // Polymarket is prediction markets only.
  polymarket: ["prediction_market"],
  // Mock simulator can stand in for anything.
  mock: ["stock", "crypto", "futures", "prediction_market"],
} as const satisfies Record<BrokerType, readonly InstrumentClass[]>;

export function brokerSupportedInstrumentClasses(
  brokerType: BrokerType,
): readonly InstrumentClass[] {
  return BROKER_SUPPORTED_INSTRUMENT_CLASSES[brokerType];
}

import type { InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type {
  BrokerAdapter,
  OhlcvBar,
} from "../broker/adapters/broker-adapter";
import type { GetBarsCallback } from "../scheduling/scheduled-strategy-executor";
import type { GetBarsInput, MarketDataProviderId } from "./market-data-service";

export interface SessionRoutedGetBarsDeps {
  resolveFanout: (subscriptionIds: string[]) => Array<{ sessionId: string }>;
  resolveAdapter: (
    sessionId: string,
    instrumentClass: InstrumentClass,
  ) => Promise<{ adapter: BrokerAdapter; brokerAccountId: string }>;
  toBrokerSymbol: (input: {
    symbol: string;
    instrumentClass: InstrumentClass;
    brokerType: string;
  }) => string;
  resolveCanonicalSymbol: (
    symbol: string,
    instrumentClass: InstrumentClass,
  ) => string;
  getBars: (input: GetBarsInput) => Promise<OhlcvBar[]>;
  mapOhlcvTimeframe: (timeframe: string) => TradingTimeframe;
  marketDataProviderForBroker: (brokerType: string) => MarketDataProviderId;
}

/**
 * Scheduled scans must use the session's assigned broker + normalized wire
 * symbol. No silent "first Alpaca account" fallback.
 */
export function createSessionRoutedGetBars(
  deps: SessionRoutedGetBarsDeps,
): GetBarsCallback {
  return async (
    symbol,
    timeframe,
    barCount,
    instrumentClass,
    context,
  ): Promise<OhlcvBar[]> => {
    const cls = instrumentClass as InstrumentClass;
    const sessionId = deps.resolveFanout(context?.subscriptionIds ?? [])[0]
      ?.sessionId;
    if (!sessionId) {
      throw new Error(
        `Scheduled OHLCV requires a session fanout target for ${symbol}`,
      );
    }

    const { adapter, brokerAccountId } = await deps.resolveAdapter(
      sessionId,
      cls,
    );
    const getOhlcv = adapter.getOhlcv?.bind(adapter);
    if (!getOhlcv) {
      throw new Error(
        `Broker ${adapter.brokerType} (${brokerAccountId}) does not support OHLCV for ${cls}`,
      );
    }

    const wireSymbol = deps.toBrokerSymbol({
      symbol: deps.resolveCanonicalSymbol(symbol, cls),
      instrumentClass: cls,
      brokerType: adapter.brokerType,
    });
    return deps.getBars({
      symbol,
      instrumentClass: cls,
      timeframe,
      barCount,
      provider: deps.marketDataProviderForBroker(adapter.brokerType),
      fetchOverride: () =>
        getOhlcv(wireSymbol, deps.mapOhlcvTimeframe(timeframe), barCount),
    });
  };
}

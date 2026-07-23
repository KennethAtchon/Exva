import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type {
  BrokerAdapter,
  BrokerOrder,
  MarketDiscoveryAdapter,
} from "./adapters/broker-adapter";
import {
  createBrokerInteractionLogger,
  formatPlaceOrderEndpoint,
  resolveOhlcvCallStatus,
  traceBrokerInteraction,
  type BrokerInteractionLogger,
} from "./broker-interaction-logger";

export interface InstrumentedBrokerAdapterOptions {
  apiCallLogRepo: ApiCallLogRepo;
  brokerAccountId: string;
  provider: string;
  /** When set (registry builds inner + outer), reuse the same logger instance. */
  interactionLogger?: BrokerInteractionLogger;
}

export function createInstrumentedBrokerAdapter(
  inner: BrokerAdapter,
  options: InstrumentedBrokerAdapterOptions,
): BrokerAdapter {
  const logger =
    options.interactionLogger ??
    createBrokerInteractionLogger({
      apiCallLogRepo: options.apiCallLogRepo,
      brokerAccountId: options.brokerAccountId,
      provider: options.provider,
    });

  const adapter: BrokerAdapter & Partial<MarketDiscoveryAdapter> = {
    brokerType: inner.brokerType,
    supportedInstrumentClasses: inner.supportedInstrumentClasses,
    launchCapable: inner.launchCapable,

    testConnection: () =>
      traceBrokerInteraction(logger, "testConnection", "connection", () =>
        inner.testConnection(),
      ),

    placeOrder: (order: BrokerOrder) =>
      traceBrokerInteraction(
        logger,
        "placeOrder",
        formatPlaceOrderEndpoint(order),
        () => inner.placeOrder(order),
      ),

    cancelOrder: (brokerOrderId: string) =>
      traceBrokerInteraction(logger, "cancelOrder", brokerOrderId, () =>
        inner.cancelOrder(brokerOrderId),
      ),

    getPositions: () =>
      traceBrokerInteraction(logger, "getPositions", "positions", () =>
        inner.getPositions(),
      ),

    getAccountBalance: () =>
      traceBrokerInteraction(logger, "getAccountBalance", "balance", () =>
        inner.getAccountBalance(),
      ),

    getMarketSnapshot: (
      instrumentSymbol: string,
      options?: { predictionOutcome?: "YES" | "NO" | null },
    ) =>
      traceBrokerInteraction(
        logger,
        "getMarketSnapshot",
        options?.predictionOutcome
          ? `${instrumentSymbol}/${options.predictionOutcome}`
          : instrumentSymbol,
        () => inner.getMarketSnapshot(instrumentSymbol, options),
      ),

    getOrderStatus: (orderId: string) =>
      traceBrokerInteraction(logger, "getOrderStatus", orderId, () =>
        inner.getOrderStatus(orderId),
      ),

    closeOrder: (orderId: string) =>
      traceBrokerInteraction(logger, "closeOrder", orderId, () =>
        inner.closeOrder(orderId),
      ),
  };

  // bind keeps class-adapter `this` (do not destructure the method).
  if (inner.getOhlcv) {
    const getOhlcv = inner.getOhlcv.bind(inner);
    adapter.getOhlcv = (instrumentSymbol, timeframe, barCount) =>
      traceBrokerInteraction(
        logger,
        "getOhlcv",
        `${instrumentSymbol}/${timeframe}?limit=${barCount}`,
        () => getOhlcv(instrumentSymbol, timeframe, barCount),
        {
          resolveStatus: (bars) => resolveOhlcvCallStatus(bars, barCount),
        },
      );
  }

  if (
    "fetchMarketCandidates" in inner &&
    typeof (inner as Partial<MarketDiscoveryAdapter>).fetchMarketCandidates ===
      "function"
  ) {
    const fetchMarketCandidates = (
      inner as BrokerAdapter & MarketDiscoveryAdapter
    ).fetchMarketCandidates.bind(inner);
    adapter.fetchMarketCandidates = () =>
      traceBrokerInteraction(
        logger,
        "fetchMarketCandidates",
        "markets",
        fetchMarketCandidates,
      );
  }

  return adapter;
}

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

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface InstrumentedBrokerAdapterOptions {
  apiCallLogRepo: ApiCallLogRepo;
  brokerAccountId: string;
  provider: string;
  /** When set (registry builds inner + outer), reuse the same logger instance. */
  interactionLogger?: BrokerInteractionLogger;
}

/** Optional BrokerAdapter methods that instrumentation must preserve (P1-4). */
export const OPTIONAL_BROKER_METHODS = [
  "placeOrderV2",
  "getOhlcv",
  "getOhlcvRange",
  "getOptionChain",
  "createOrderEventFeed",
  "getOpenOrders",
  "prepareClientOrderId",
  "findOrderByClientOrderId",
  "capabilities",
] as const;

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

  // `capabilities` is readonly on BrokerAdapter, so it has to be set here
  // rather than patched on below with the other optional methods (P1-4).
  const adapter: Mutable<BrokerAdapter & Partial<MarketDiscoveryAdapter>> = {
    brokerType: inner.brokerType,
    supportedInstrumentClasses: inner.supportedInstrumentClasses,
    launchCapable: inner.launchCapable,
    ...(inner.capabilities ? { capabilities: inner.capabilities } : {}),

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
      opts?: { predictionOutcome?: "YES" | "NO" | null },
    ) =>
      traceBrokerInteraction(
        logger,
        "getMarketSnapshot",
        opts?.predictionOutcome
          ? `${instrumentSymbol}/${opts.predictionOutcome}`
          : instrumentSymbol,
        () => inner.getMarketSnapshot(instrumentSymbol, opts),
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
  if (inner.placeOrderV2) {
    const placeOrderV2 = inner.placeOrderV2.bind(inner);
    adapter.placeOrderV2 = (order) =>
      traceBrokerInteraction(
        logger,
        "placeOrderV2",
        formatPlaceOrderEndpoint(order as unknown as BrokerOrder),
        () => placeOrderV2(order),
      );
  }

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

  if (inner.getOhlcvRange) {
    const getOhlcvRange = inner.getOhlcvRange.bind(inner);
    adapter.getOhlcvRange = (instrumentSymbol, timeframe, window) =>
      traceBrokerInteraction(
        logger,
        "getOhlcvRange",
        `${instrumentSymbol}/${timeframe}?start=${window.startIso}&end=${window.endIso}`,
        () => getOhlcvRange(instrumentSymbol, timeframe, window),
      );
  }

  if (inner.getOptionChain) {
    const getOptionChain = inner.getOptionChain.bind(inner);
    adapter.getOptionChain = (underlyingSymbol) =>
      traceBrokerInteraction(
        logger,
        "getOptionChain",
        underlyingSymbol,
        () => getOptionChain(underlyingSymbol),
      );
  }

  if (inner.createOrderEventFeed) {
    const createOrderEventFeed = inner.createOrderEventFeed.bind(inner);
    adapter.createOrderEventFeed = (opts) => createOrderEventFeed(opts);
  }

  if (inner.getOpenOrders) {
    const getOpenOrders = inner.getOpenOrders.bind(inner);
    adapter.getOpenOrders = () =>
      traceBrokerInteraction(logger, "getOpenOrders", "open-orders", () =>
        getOpenOrders(),
      );
  }

  if (inner.prepareClientOrderId) {
    // Synchronous — no tracing wrapper (must stay sync for pre-submit persist).
    adapter.prepareClientOrderId = inner.prepareClientOrderId.bind(inner);
  }

  if (inner.findOrderByClientOrderId) {
    const findOrder = inner.findOrderByClientOrderId.bind(inner);
    adapter.findOrderByClientOrderId = (wireClientOrderId) =>
      traceBrokerInteraction(
        logger,
        "findOrderByClientOrderId",
        wireClientOrderId,
        () => findOrder(wireClientOrderId),
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

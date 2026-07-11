import type { BrokerOrder } from "./adapters/broker-adapter";
import {
  createBrokerInteractionLogger,
  formatPlaceOrderEndpoint,
  traceBrokerInteraction,
  type BrokerInteractionLogger,
} from "./broker-interaction-logger";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type { BrokerAdapter, OhlcvBar } from "./adapters/broker-adapter";

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

  const adapter: BrokerAdapter = {
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

    getMarketSnapshot: (instrumentSymbol: string) =>
      traceBrokerInteraction(
        logger,
        "getMarketSnapshot",
        instrumentSymbol,
        () => inner.getMarketSnapshot(instrumentSymbol),
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

  if (inner.getOhlcv) {
    adapter.getOhlcv = (
      instrumentSymbol: string,
      timeframe: "15m" | "30m" | "1h" | "4h" | "1d",
      barCount: number,
    ) =>
      traceBrokerInteraction(
        logger,
        "getOhlcv",
        `${instrumentSymbol}/${timeframe}?limit=${barCount}`,
        () => {
          const getOhlcv = inner.getOhlcv;
          if (!getOhlcv) {
            throw new Error("Broker adapter getOhlcv unexpectedly unavailable");
          }
          return getOhlcv(instrumentSymbol, timeframe, barCount);
        },
      ) as Promise<OhlcvBar[]>;
  }

  return adapter;
}

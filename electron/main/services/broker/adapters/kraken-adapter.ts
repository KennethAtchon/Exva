import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OhlcvBar,
  OrderStatus,
} from "./broker-adapter";
import type {
  AdapterCapabilities,
  BrokerOrderV2,
  OrderEvent,
  OrderEventFeed,
} from "../order-contract-v2";
import {
  adapterSupportsOrder,
  lowerBrokerOrderV2ToV1,
} from "../order-contract-v2";

/**
 * Kraken crypto adapter. Public OHLC helps MarketDataService even before
 * trading is enabled. Websocket order feed stubbed via poll fallback.
 */
export class KrakenAdapter implements BrokerAdapter {
  readonly brokerType = "kraken";
  readonly supportedInstrumentClasses = [
    "crypto",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = false;
  readonly capabilities: AdapterCapabilities = {
    supportsLimit: true,
    supportsStop: true,
    supportsStopLimit: false,
    supportsBracket: false,
    supportsStreaming: true,
    quantityKinds: ["units", "notional_usd"],
    timeInForce: ["gtc", "ioc"],
    orderTypes: ["market", "limit", "stop"],
  };

  constructor(
    private readonly credentialsJson: string,
    private readonly mode: "paper" | "live" = "paper",
  ) {
    void this.credentialsJson;
    void this.mode;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: false,
      message:
        "Kraken adapter skeleton — complete API auth spike before enabling.",
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    void order;
    throw new Error("Kraken placeOrder not implemented — complete API spike.");
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) throw new Error(`Kraken rejects order: ${check.reason}`);
    if (
      order.orderType === "market" &&
      order.quantity.kind === "notional_usd"
    ) {
      return this.placeOrder(lowerBrokerOrderV2ToV1(order));
    }
    throw new Error(
      "Kraken placeOrderV2 not implemented — complete API spike.",
    );
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    void brokerOrderId;
    throw new Error("Kraken cancelOrder not implemented.");
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async getAccountBalance(): Promise<number> {
    return 0;
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    return {
      instrumentSymbol,
      price: 0,
      timestamp: new Date().toISOString(),
    };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    return {
      brokerOrderId: orderId,
      status: "unknown",
      latestPrice: null,
      realizedPnlUsd: null,
    };
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    return { brokerOrderId: orderId, realizedPnlUsd: 0 };
  }

  /**
   * Public OHLC endpoint — usable for MarketDataService ingest without trading
   * credentials. Returns empty until the HTTP client is wired.
   */
  async getOhlcv(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    barCount: number,
  ): Promise<OhlcvBar[]> {
    void instrumentSymbol;
    void timeframe;
    void barCount;
    return [];
  }

  createOrderEventFeed(): OrderEventFeed {
    const handlers = new Set<(event: OrderEvent) => void>();
    return {
      async start() {
        /* websocket wiring lands with the API spike */
      },
      async stop() {
        handlers.clear();
      },
      onEvent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
  }
}

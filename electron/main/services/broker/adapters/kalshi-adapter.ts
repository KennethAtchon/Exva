import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";
import type { AdapterCapabilities, BrokerOrderV2 } from "../order-contract-v2";
import {
  adapterSupportsOrder,
  lowerBrokerOrderV2ToV1,
} from "../order-contract-v2";

/**
 * Kalshi event-contract adapter (paper-first). REST + websocket spike needed
 * before live; this skeleton implements the BrokerAdapter surface and v2
 * capability advertisement so orchestration can certify against it.
 */
export class KalshiAdapter implements BrokerAdapter {
  readonly brokerType = "kalshi";
  readonly supportedInstrumentClasses = [
    "prediction_market",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = false;
  readonly capabilities: AdapterCapabilities = {
    supportsLimit: true,
    supportsStop: false,
    supportsStopLimit: false,
    supportsBracket: false,
    supportsStreaming: true,
    quantityKinds: ["units", "notional_usd"],
    timeInForce: ["gtc", "ioc"],
    orderTypes: ["market", "limit"],
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
        "Kalshi adapter skeleton — complete API auth spike before enabling.",
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    void order;
    throw new Error("Kalshi placeOrder not implemented — complete API spike.");
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) throw new Error(`Kalshi rejects order: ${check.reason}`);
    // Until the REST client lands, lower market+notional to v1 path.
    if (order.orderType === "market" && order.quantity.kind === "notional_usd") {
      return this.placeOrder(lowerBrokerOrderV2ToV1(order));
    }
    throw new Error("Kalshi placeOrderV2 not implemented — complete API spike.");
  }

  async cancelOrder(_brokerOrderId: string): Promise<void> {
    throw new Error("Kalshi cancelOrder not implemented.");
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
}

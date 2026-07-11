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
  OptionChainContract,
  OrderStatus,
} from "./broker-adapter";
import type { AdapterCapabilities, BrokerOrderV2 } from "../order-contract-v2";
import {
  adapterSupportsOrder,
  lowerBrokerOrderV2ToV1,
} from "../order-contract-v2";

/**
 * Tradier equities/options adapter (paper sandbox first). Unlocks options-flow
 * v2 contract trading once the REST client is spiked.
 */
export class TradierAdapter implements BrokerAdapter {
  readonly brokerType = "tradier";
  readonly supportedInstrumentClasses = [
    "stock",
    "options",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = false;
  readonly capabilities: AdapterCapabilities = {
    supportsLimit: true,
    supportsStop: true,
    supportsStopLimit: true,
    supportsBracket: false,
    supportsStreaming: false,
    quantityKinds: ["units", "notional_usd"],
    timeInForce: ["day", "gtc", "ioc", "fok"],
    orderTypes: ["market", "limit", "stop", "stop_limit"],
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
        "Tradier adapter skeleton — complete API auth spike before enabling.",
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    void order;
    throw new Error("Tradier placeOrder not implemented — complete API spike.");
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) throw new Error(`Tradier rejects order: ${check.reason}`);
    if (
      order.orderType === "market" &&
      order.quantity.kind === "notional_usd"
    ) {
      return this.placeOrder(lowerBrokerOrderV2ToV1(order));
    }
    throw new Error(
      "Tradier placeOrderV2 not implemented — complete API spike.",
    );
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    void brokerOrderId;
    throw new Error("Tradier cancelOrder not implemented.");
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

  async getOptionChain(
    underlyingSymbol: string,
  ): Promise<OptionChainContract[]> {
    void underlyingSymbol;
    return [];
  }
}

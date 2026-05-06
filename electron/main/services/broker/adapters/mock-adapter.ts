import type { ConnectionTestResult } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";

export class MockBrokerAdapter implements BrokerAdapter {
  readonly brokerType = "mock";
  readonly supportedInstrumentClasses: readonly InstrumentClass[] = ["stock", "crypto", "futures", "prediction_market"];

  private readonly orders = new Map<string, { order: BrokerOrder; price: number }>();

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Mock broker connected", account_balance: 100000 };
  }

  async getAccountBalance(): Promise<number> {
    return 100000;
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    return {
      instrumentSymbol,
      price: this.priceFor(instrumentSymbol),
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    const brokerOrderId = `mock_${crypto.randomUUID()}`;
    const filledAvgPrice = this.priceFor(order.instrumentSymbol);
    this.orders.set(brokerOrderId, { order, price: filledAvgPrice });
    return { brokerOrderId, filledAvgPrice };
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.orders.delete(orderId);
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [...this.orders.entries()].map(([, { order, price }]) => ({
      instrumentSymbol: order.instrumentSymbol,
      instrumentDisplayName: order.instrumentDisplayName ?? null,
      predictionOutcome: order.predictionOutcome ?? null,
      instrumentMetadataJson: order.instrumentMetadataJson ?? null,
      instrumentType: order.instrumentType,
      side: "long" as const,
      sizeUsd: order.sizeUsd,
      unrealizedPnl: Number((price * 0.001).toFixed(2)),
    }));
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    const existing = this.orders.get(orderId);
    this.orders.delete(orderId);
    const realizedPnlUsd = existing ? Number((existing.price * 0.002).toFixed(2)) : 0;
    return { brokerOrderId: orderId, realizedPnlUsd };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const existing = this.orders.get(orderId);
    return {
      brokerOrderId: orderId,
      status: existing ? "open" : "closed",
      latestPrice: existing ? this.priceFor(existing.order.instrumentSymbol) : null,
      realizedPnlUsd: null,
    };
  }

  private priceFor(instrumentSymbol: string): number {
    const seed = [...instrumentSymbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return Number((75 + (seed % 250) + (Date.now() % 1000) / 1000).toFixed(2));
  }
}

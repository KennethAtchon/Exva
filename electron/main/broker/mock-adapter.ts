import type {
  BrokerAdapter,
  CloseResult,
  MarketSnapshot,
  OrderRequest,
  OrderResult,
  OrderStatus,
} from "./broker-adapter";
import type { ConnectionTestResult } from "@/lib/types";

export class MockBrokerAdapter implements BrokerAdapter {
  readonly id = "mock" as const;
  private readonly orders = new Map<string, { order: OrderRequest; price: number }>();

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Mock broker connected", account_balance: 100000 };
  }

  async getAccountBalance(): Promise<number> {
    return 100000;
  }

  async getMarketSnapshot(asset: string): Promise<MarketSnapshot> {
    return {
      asset,
      price: this.priceFor(asset),
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const brokerOrderId = `mock_${crypto.randomUUID()}`;
    const filledAvgPrice = this.priceFor(order.asset);
    this.orders.set(brokerOrderId, { order, price: filledAvgPrice });
    return { brokerOrderId, filledAvgPrice };
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
      status: existing ? "open" : "unknown",
      latestPrice: existing ? this.priceFor(existing.order.asset) : null,
      realizedPnlUsd: null,
    };
  }

  private priceFor(asset: string): number {
    const seed = [...asset].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return Number((75 + (seed % 250) + (Date.now() % 1000) / 1000).toFixed(2));
  }
}

import type { ConnectionTestResult } from "@/lib/types";

export interface MarketSnapshot {
  asset: string;
  price: number;
  timestamp: string;
}

export interface OrderRequest {
  asset: string;
  side: "BUY" | "SELL";
  sizeUsd: number;
}

export interface OrderResult {
  brokerOrderId: string;
  filledAvgPrice: number;
}

export interface CloseResult {
  brokerOrderId: string;
  realizedPnlUsd: number;
}

export interface OrderStatus {
  brokerOrderId: string;
  status: "open" | "closed" | "unknown";
  latestPrice: number | null;
  realizedPnlUsd: number | null;
}

export interface BrokerAdapter {
  id: "mock" | "alpaca";
  testConnection(): Promise<ConnectionTestResult>;
  getAccountBalance(): Promise<number>;
  getMarketSnapshot(asset: string): Promise<MarketSnapshot>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  closeOrder(orderId: string): Promise<CloseResult>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
}

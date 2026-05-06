import type { ConnectionTestResult, InstrumentClass, PredictionOutcome } from "@/lib/types";

export interface MarketSnapshot {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  price: number;
  timestamp: string;
}

export interface BrokerOrder {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  instrumentType: InstrumentClass;
  side: "BUY" | "SELL";
  sizeUsd: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface BrokerOrderResult {
  brokerOrderId: string;
  filledAvgPrice: number;
}

export interface BrokerPosition {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  instrumentType: InstrumentClass;
  side: "long" | "short";
  sizeUsd: number;
  unrealizedPnl: number;
}

export interface OrderStatus {
  brokerOrderId: string;
  status: "open" | "closed" | "unknown";
  latestPrice: number | null;
  realizedPnlUsd: number | null;
}

export interface CloseResult {
  brokerOrderId: string;
  realizedPnlUsd: number;
}

/** Used by risk engine / orchestrator before routing normalizes symbols. */
export interface OrderRequest {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  instrumentType: InstrumentClass;
  side: "BUY" | "SELL";
  sizeUsd: number;
}

export interface BrokerAdapter {
  readonly brokerType: string;
  readonly supportedInstrumentClasses: readonly InstrumentClass[];

  testConnection(): Promise<ConnectionTestResult>;
  placeOrder(order: BrokerOrder): Promise<BrokerOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getPositions(): Promise<BrokerPosition[]>;

  getAccountBalance(): Promise<number>;
  getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  closeOrder(orderId: string): Promise<CloseResult>;
}

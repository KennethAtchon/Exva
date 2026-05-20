import type {
  ConnectionTestResult,
  InstrumentClass,
  PredictionOutcome,
} from "@/lib/types";

export interface MarketSnapshot {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  price: number;
  bid?: number;
  ask?: number;
  spreadPct?: number;
  volume?: number;
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
  clientOrderId: string;
}

export interface BrokerOrderResult {
  brokerOrderId: string;
  filledAvgPrice: number;
  filledSizeUsd?: number;
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
  /**
   * Whether this adapter has truthful close/flatten/positions semantics
   * suitable for a live launch. Adapters that stub close or positions
   * should set this to `false`; the live-readiness gate uses it to block
   * starting a `live_allowed` session on a non-launch-capable adapter.
   */
  readonly launchCapable: boolean;

  testConnection(): Promise<ConnectionTestResult>;
  placeOrder(order: BrokerOrder): Promise<BrokerOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getPositions(): Promise<BrokerPosition[]>;

  getAccountBalance(): Promise<number>;
  getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  closeOrder(orderId: string): Promise<CloseResult>;

  /** Optional: return OHLCV bars for exit-policy ATR computation. */
  getOhlcv?(
    instrumentSymbol: string,
    timeframe: "1h" | "4h" | "1d",
    barCount: number,
  ): Promise<Array<{ high: number; low: number; close: number }>>;
}

/** Raw row shape returned by Polymarket Gamma REST API. */
export interface PolymarketMarketRow {
  conditionId?: unknown;
  question?: unknown;
  slug?: unknown;
  category?: unknown;
  endDate?: unknown;
  liquidity?: unknown;
  liquidityClob?: unknown;
  volume?: unknown;
  tokens?: unknown;
}

/** Implemented by adapters that can enumerate available markets (e.g. Polymarket). */
export interface MarketDiscoveryAdapter {
  fetchMarketCandidates(): Promise<PolymarketMarketRow[]>;
}

export function isMarketDiscoveryAdapter(
  adapter: BrokerAdapter,
): adapter is BrokerAdapter & MarketDiscoveryAdapter {
  return (
    "fetchMarketCandidates" in adapter &&
    typeof (adapter as Partial<MarketDiscoveryAdapter>)
      .fetchMarketCandidates === "function"
  );
}

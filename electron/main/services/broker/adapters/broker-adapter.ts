import type {
  ConnectionTestResult,
  InstrumentClass,
  PredictionOutcome,
} from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type {
  AdapterCapabilities,
  BrokerOrderV2,
  OrderEventFeed,
} from "../order-contract-v2";
import { DEFAULT_MARKET_ONLY_CAPABILITIES } from "../order-contract-v2";

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

export interface OhlcvBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * One option contract from a chain snapshot. Used by the options-flow
 * experience to screen for unusual activity and select a defined-risk contract.
 */
export interface OptionChainContract {
  /** OCC symbol, e.g. AAPL250117C00150000. */
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  /** Absolute delta, [0,1]; null when greeks are unavailable on the feed. */
  delta: number | null;
  impliedVolatility: number | null;
  openInterest: number;
  dayVolume: number;
  bid: number | null;
  ask: number | null;
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

  /** Order-contract v2 capabilities. Defaults to market+notional only. */
  readonly capabilities?: AdapterCapabilities;

  testConnection(): Promise<ConnectionTestResult>;
  placeOrder(order: BrokerOrder): Promise<BrokerOrderResult>;
  /**
   * Optional v2 placement. Adapters that implement this are preferred by
   * order-placer when the incoming order is BrokerOrderV2-shaped.
   */
  placeOrderV2?(order: BrokerOrderV2): Promise<BrokerOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getPositions(): Promise<BrokerPosition[]>;

  getAccountBalance(): Promise<number>;
  getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  closeOrder(orderId: string): Promise<CloseResult>;

  /** Optional: return OHLCV bars. Used by get_ohlcv tool and ATR computation. */
  getOhlcv?(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    barCount: number,
  ): Promise<OhlcvBar[]>;

  /**
   * Optional: return the option chain (volume/OI/greeks per contract) for an
   * underlying. Used by the options-flow experience for UOA detection and
   * defined-risk contract selection.
   */
  getOptionChain?(underlyingSymbol: string): Promise<OptionChainContract[]>;

  /** Optional order-event feed (websocket or poll). TradeMonitor prefers this. */
  createOrderEventFeed?(): OrderEventFeed;
}

export function adapterCapabilitiesOf(
  adapter: BrokerAdapter,
): AdapterCapabilities {
  return adapter.capabilities ?? DEFAULT_MARKET_ONLY_CAPABILITIES;
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

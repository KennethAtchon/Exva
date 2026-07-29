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
  getMarketSnapshot(
    instrumentSymbol: string,
    options?: { predictionOutcome?: "YES" | "NO" | null },
  ): Promise<MarketSnapshot>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  closeOrder(orderId: string): Promise<CloseResult>;

  /** Optional: return OHLCV bars. Used by get_ohlcv tool and ATR computation. */
  getOhlcv?(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    barCount: number,
  ): Promise<OhlcvBar[]>;

  /** Optional: return all bars in an explicit historical window. */
  getOhlcvRange?(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    window: { startIso: string; endIso: string },
  ): Promise<OhlcvBar[]>;

  /**
   * Optional: return the option chain (volume/OI/greeks per contract) for an
   * underlying. Used by the options-flow experience for UOA detection and
   * defined-risk contract selection.
   */
  getOptionChain?(underlyingSymbol: string): Promise<OptionChainContract[]>;

  /** Optional order-event feed (websocket or poll). TradeMonitor prefers this. */
  createOrderEventFeed?(opts?: {
    onFallbackToPoll?: (reason: string) => void;
  }): OrderEventFeed;

  /**
   * Optional: normalize a canonical client order ID to the exact wire ID the
   * venue will receive. Must be synchronous so the wire ID can be persisted
   * before any HTTP call (Solution 01).
   */
  prepareClientOrderId?(canonicalClientOrderId: string): string;

  /**
   * Optional: list orders still resting at the venue. Used to reconcile after
   * a submission timeout without placing a second blind order (Solution 01).
   */
  getOpenOrders?(): Promise<
    Array<{
      brokerOrderId: string;
      clientOrderId: string;
      status: "open";
      remainingQty: number;
    }>
  >;

  /**
   * Optional: look up an order by the exact wire client order ID (for
   * timeout-safe reconciliation without blind retry).
   */
  findOrderByClientOrderId?(wireClientOrderId: string): Promise<{
    brokerOrderId: string;
    status: string;
    filledQty: number;
    filledAvgPrice: number | null;
    rawStatus: string;
  } | null>;
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
  /** Legacy CLOB shape (tests / older fixtures). */
  tokens?: unknown;
  /** Current Gamma shape: JSON-encoded string arrays. */
  clobTokenIds?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
}

export type PolymarketNormalizedToken = {
  outcome: "Yes" | "No";
  token_id: string;
  price?: string;
};

function parsePolymarketOutcome(raw: string): "Yes" | "No" | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "yes") return "Yes";
  if (normalized === "no") return "No";
  return null;
}

function readPolymarketTokenId(token: {
  token_id?: unknown;
  tokenId?: unknown;
}): string | null {
  if (typeof token.token_id === "string") return token.token_id;
  if (typeof token.tokenId === "string") return token.tokenId;
  return null;
}

function readPolymarketTokenPrice(price: unknown): string | undefined {
  if (typeof price === "string" || typeof price === "number") {
    return String(price);
  }
  return undefined;
}

/**
 * Normalize either legacy `tokens` or current Gamma
 * `clobTokenIds`/`outcomes`/`outcomePrices` into equal-length Yes/No tokens.
 * Returns null when the row cannot yield a usable binary market.
 */
export function normalizePolymarketMarketTokens(
  row: PolymarketMarketRow,
): PolymarketNormalizedToken[] | null {
  if (Array.isArray(row.tokens) && row.tokens.length > 0) {
    const out: PolymarketNormalizedToken[] = [];
    for (const raw of row.tokens) {
      if (!raw || typeof raw !== "object") continue;
      const token = raw as {
        outcome?: unknown;
        token_id?: unknown;
        tokenId?: unknown;
        price?: unknown;
      };
      const outcome =
        typeof token.outcome === "string"
          ? parsePolymarketOutcome(token.outcome)
          : null;
      const tokenId = readPolymarketTokenId(token);
      if (!outcome || !tokenId) continue;
      out.push({
        outcome,
        token_id: tokenId,
        price: readPolymarketTokenPrice(token.price),
      });
    }
    return out.length > 0 ? out : null;
  }

  const tokenIds = parseJsonStringArray(row.clobTokenIds);
  const outcomes = parseJsonStringArray(row.outcomes);
  const prices = parseJsonStringArray(row.outcomePrices);
  if (!tokenIds || !outcomes) return null;
  if (tokenIds.length === 0 || outcomes.length === 0) return null;
  if (tokenIds.length !== outcomes.length) return null;
  if (prices && prices.length !== tokenIds.length) return null;

  const out: PolymarketNormalizedToken[] = [];
  for (let i = 0; i < tokenIds.length; i += 1) {
    const outcome = parsePolymarketOutcome(outcomes[i]?.trim() ?? "");
    const tokenId = tokenIds[i];
    if (!outcome || !tokenId) continue;
    out.push({
      outcome,
      token_id: tokenId,
      price: prices?.[i],
    });
  }
  return out.length > 0 ? out : null;
}

function parseJsonStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string")
      ? (value as string[])
      : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
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

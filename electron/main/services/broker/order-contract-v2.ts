import type { InstrumentClass, PredictionOutcome } from "@/lib/types";

/**
 * Broker order contract v2 — limit/stop/TIF/qty alongside v1 BrokerOrder.
 * Adapters advertise capabilities; OrderPolicyGate refuses unsupported shapes.
 */

export type OrderQuantity =
  | { kind: "notional_usd"; value: number }
  | { kind: "units"; value: number };

export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export interface InstrumentRef {
  symbol: string;
  instrumentClass: InstrumentClass;
  displayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  metadataJson?: string | null;
}

export interface BrokerOrderV2 {
  clientOrderId: string;
  instrument: InstrumentRef;
  side: "BUY" | "SELL";
  quantity: OrderQuantity;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: TimeInForce;
  bracket?: { stopLossPrice?: number; takeProfitPrice?: number };
}

export interface AdapterCapabilities {
  supportsLimit: boolean;
  supportsStop: boolean;
  supportsStopLimit: boolean;
  supportsBracket: boolean;
  supportsStreaming: boolean;
  quantityKinds: ReadonlyArray<OrderQuantity["kind"]>;
  timeInForce: ReadonlyArray<TimeInForce>;
  orderTypes: ReadonlyArray<OrderType>;
}

export const DEFAULT_MARKET_ONLY_CAPABILITIES: AdapterCapabilities = {
  supportsLimit: false,
  supportsStop: false,
  supportsStopLimit: false,
  supportsBracket: true,
  supportsStreaming: false,
  quantityKinds: ["notional_usd"],
  timeInForce: ["day"],
  orderTypes: ["market"],
};

export const ALPACA_CAPABILITIES: AdapterCapabilities = {
  supportsLimit: true,
  supportsStop: true,
  supportsStopLimit: true,
  supportsBracket: true,
  supportsStreaming: true,
  quantityKinds: ["notional_usd", "units"],
  timeInForce: ["day", "gtc", "ioc", "fok"],
  orderTypes: ["market", "limit", "stop", "stop_limit"],
};

/** Polymarket CLOB: market FOK + GTC limit; units (shares) or notional USDC. */
export const POLYMARKET_CAPABILITIES: AdapterCapabilities = {
  supportsLimit: true,
  supportsStop: false,
  supportsStopLimit: false,
  supportsBracket: false,
  supportsStreaming: false,
  quantityKinds: ["notional_usd", "units"],
  timeInForce: ["gtc", "fok"],
  orderTypes: ["market", "limit"],
};

/** Lift v1 market+notional order into v2. */
export function liftBrokerOrderV1ToV2(order: {
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
}): BrokerOrderV2 {
  return {
    clientOrderId: order.clientOrderId,
    instrument: {
      symbol: order.instrumentSymbol,
      instrumentClass: order.instrumentType,
      displayName: order.instrumentDisplayName,
      predictionOutcome: order.predictionOutcome,
      metadataJson: order.instrumentMetadataJson,
    },
    side: order.side,
    quantity: { kind: "notional_usd", value: order.sizeUsd },
    orderType: "market",
    timeInForce: "day",
    bracket:
      order.stopLossPrice != null || order.takeProfitPrice != null
        ? {
            stopLossPrice: order.stopLossPrice,
            takeProfitPrice: order.takeProfitPrice,
          }
        : undefined,
  };
}

/** Lower v2 notional market orders back to v1 for adapters not yet migrated. */
export function lowerBrokerOrderV2ToV1(order: BrokerOrderV2): {
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
} {
  if (order.quantity.kind !== "notional_usd") {
    throw new Error(
      "v1 adapters only accept notional_usd quantity; use a v2-capable adapter for units.",
    );
  }
  if (order.orderType !== "market") {
    throw new Error(
      `v1 adapters only accept market orders; got ${order.orderType}.`,
    );
  }
  return {
    instrumentSymbol: order.instrument.symbol,
    instrumentDisplayName: order.instrument.displayName,
    predictionOutcome: order.instrument.predictionOutcome,
    instrumentMetadataJson: order.instrument.metadataJson,
    instrumentType: order.instrument.instrumentClass,
    side: order.side,
    sizeUsd: order.quantity.value,
    stopLossPrice: order.bracket?.stopLossPrice,
    takeProfitPrice: order.bracket?.takeProfitPrice,
    clientOrderId: order.clientOrderId,
  };
}

export function adapterSupportsOrder(
  caps: AdapterCapabilities,
  order: BrokerOrderV2,
): { ok: true } | { ok: false; reason: string } {
  if (!caps.orderTypes.includes(order.orderType)) {
    return { ok: false, reason: `orderType ${order.orderType} unsupported` };
  }
  if (!caps.timeInForce.includes(order.timeInForce)) {
    return {
      ok: false,
      reason: `timeInForce ${order.timeInForce} unsupported`,
    };
  }
  if (!caps.quantityKinds.includes(order.quantity.kind)) {
    return {
      ok: false,
      reason: `quantity kind ${order.quantity.kind} unsupported`,
    };
  }
  if (order.orderType === "limit" && !caps.supportsLimit) {
    return { ok: false, reason: "limit orders unsupported" };
  }
  if (
    (order.orderType === "stop" || order.orderType === "stop_limit") &&
    !caps.supportsStop
  ) {
    return { ok: false, reason: "stop orders unsupported" };
  }
  if (order.bracket && !caps.supportsBracket) {
    return { ok: false, reason: "bracket orders unsupported" };
  }
  return { ok: true };
}

/** Order lifecycle events for TradeMonitor (stream or poll). */
export type OrderEventKind =
  | "accepted"
  | "partial_fill"
  | "fill"
  | "canceled"
  | "rejected"
  | "expired";

export interface OrderEvent {
  brokerOrderId: string;
  clientOrderId?: string;
  kind: OrderEventKind;
  ts: string;
  filledAvgPrice?: number;
  filledQty?: number;
  remainingQty?: number;
  realizedPnlUsd?: number;
  message?: string;
}

export interface OrderEventFeed {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: OrderEvent) => void): () => void;
}

import type { BrokerKind, OrderStatus, Side } from "@shared/types.ts";
import type { Session } from "../core/calendar.ts";

export interface OrderRequest {
  clientOrderId: string;
  symbol: string;
  side: Side;
  notional?: number;
  qty?: number;
  /** Decision time. The simulator fills at the first bar open at or after it. */
  refTs: number;
}

/** Cumulative state of an order as the broker reports it. */
export interface BrokerOrder {
  brokerOrderId: string;
  clientOrderId: string;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number | null;
  /** Cumulative fee for the order, when the broker reports one. */
  fee?: number;
  /** When the latest fill happened. */
  filledAt?: number;
  error?: string;
}

export interface BrokerAccount {
  equity: number;
  cash: number;
  buyingPower: number;
  mode: "paper" | "sim";
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
}

export interface Broker {
  readonly kind: BrokerKind;
  account(): Promise<BrokerAccount>;
  submit(req: OrderRequest): Promise<BrokerOrder>;
  getOrder(brokerOrderId: string): Promise<BrokerOrder | null>;
  getByClientId(clientOrderId: string): Promise<BrokerOrder | null>;
  cancel(brokerOrderId: string): Promise<void>;
  positions(): Promise<BrokerPosition[]>;
  /** Official exchange sessions, when the broker has them. */
  calendar?(fromKey: string, toKey: string): Promise<Session[]>;
}

/** Brokers spell crypto symbols differently in different places (BTC/USD vs BTCUSD). Compare with this. */
export const symbolKey = (symbol: string): string => symbol.replace("/", "").toUpperCase();

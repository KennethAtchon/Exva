import type { ConnectionTestResult } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";

export type TradovateCredentials = {
  username?: string;
  password?: string;
  appId?: string;
  cid?: string;
  secret?: string;
};

/**
 * Futures execution adapter (Phase 8).
 * v1: credential check + simulated fills for development.
 */
export class TradovateAdapter implements BrokerAdapter {
  readonly brokerType = "tradovate";
  readonly supportedInstrumentClasses = [
    "futures",
  ] as const satisfies readonly InstrumentClass[];
  /**
   * Not launch-capable: placeOrder/cancelOrder/closeOrder are stubbed and
   * getPositions returns []. Live-readiness gate must block live sessions
   * using this adapter until real Tradovate integration is built.
   */
  readonly launchCapable = false;

  constructor(
    private readonly credentials: TradovateCredentials,
    readonly mode: "paper" | "live",
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    const hasCreds =
      (this.credentials.username && this.credentials.password) ||
      (this.credentials.cid && this.credentials.secret);
    if (!hasCreds) {
      return {
        ok: false,
        message: "Tradovate username/password or cid/secret is required.",
      };
    }
    return {
      ok: true,
      message: `Tradovate (${this.mode}) — credentials present (simulated connectivity)`,
      account_balance: 250000,
    };
  }

  async getAccountBalance(): Promise<number> {
    return 250000;
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    return {
      instrumentSymbol,
      price: this.stubPrice(instrumentSymbol),
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    if (order.instrumentType !== "futures") {
      throw new AppError(
        "Tradovate adapter supports futures only",
        "UNSUPPORTED_INSTRUMENT",
      );
    }
    return {
      brokerOrderId: `tv_sim_${crypto.randomUUID()}`,
      filledAvgPrice: this.stubPrice(order.instrumentSymbol),
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    void brokerOrderId;
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    return { brokerOrderId: orderId, realizedPnlUsd: 0 };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    return {
      brokerOrderId: orderId,
      status: "closed",
      latestPrice: null,
      realizedPnlUsd: 0,
    };
  }

  private stubPrice(symbol: string): number {
    const seed = [...symbol].reduce((s, c) => s + c.charCodeAt(0), 0);
    return Number((5000 + (seed % 200)).toFixed(2));
  }
}

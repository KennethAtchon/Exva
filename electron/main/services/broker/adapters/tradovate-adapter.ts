import type { ConnectionTestResult } from "@/lib/types";
import { BROKER_SUPPORTED_INSTRUMENT_CLASSES } from "@electron/shared/domain/broker-capabilities";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import { createLogger } from "../../infra/log";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";

const logger = createLogger("tradovate-adapter");

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
  readonly supportedInstrumentClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES.tradovate;
  /**
   * Not launch-capable: placeOrder/cancelOrder/closeOrder are stubbed and
   * getPositions returns []. Live-readiness gate must block live sessions
   * using this adapter until real Tradovate integration is built.
   */
  readonly launchCapable = false;

  constructor(
    private readonly credentials: TradovateCredentials,
    readonly mode: "paper" | "live",
    readonly _interactionLogger?: BrokerInteractionLogger,
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
    logger.info(
      {
        instrumentSymbol: order.instrumentSymbol,
        side: order.side,
        sizeUsd: order.sizeUsd,
        instrumentType: order.instrumentType,
        mode: this.mode,
      },
      "tradovate placeOrder: submitting order (simulated)",
    );
    if (order.instrumentType !== "futures") {
      const err = new AppError(
        "Tradovate adapter supports futures only",
        "UNSUPPORTED_INSTRUMENT",
      );
      logger.error(
        { err, instrumentType: order.instrumentType },
        "tradovate placeOrder: unsupported instrument type",
      );
      throw err;
    }
    const result = {
      brokerOrderId: `tv_sim_${crypto.randomUUID()}`,
      filledAvgPrice: this.stubPrice(order.instrumentSymbol),
    };
    logger.info(
      {
        brokerOrderId: result.brokerOrderId,
        filledAvgPrice: result.filledAvgPrice,
      },
      "tradovate placeOrder: simulated fill",
    );
    return result;
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    logger.info({ brokerOrderId }, "tradovate cancelOrder: no-op (simulated)");
    void brokerOrderId;
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    logger.info({ orderId }, "tradovate closeOrder: no-op (simulated)");
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

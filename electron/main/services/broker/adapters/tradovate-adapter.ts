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

const UNSUPPORTED_MESSAGE =
  "BLOCKED: FUTURES_ADAPTER_SIMULATED — Tradovate adapter reports fabricated balance and cannot place, fill, or close. Use Mock paper for the local lifecycle sentinel only.";

/**
 * Futures adapter placeholder (Solution 10 Tracer B).
 * Every mutating / balance method throws UNSUPPORTED so a fabricated
 * $250k balance can never look like a healthy connection.
 * Real Tradovate partner auth/data/orders is a separate project.
 */
export class TradovateAdapter implements BrokerAdapter {
  readonly brokerType = "tradovate";
  readonly supportedInstrumentClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES.tradovate;
  readonly launchCapable = false;

  constructor(
    private readonly credentials: TradovateCredentials,
    readonly mode: "paper" | "live",
    readonly _interactionLogger?: BrokerInteractionLogger,
  ) {
    void this.credentials;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    logger.warn("tradovate testConnection refused — adapter is quarantined");
    return {
      ok: false,
      message: UNSUPPORTED_MESSAGE,
    };
  }

  async getAccountBalance(): Promise<number> {
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    void instrumentSymbol;
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    logger.error(
      { instrumentSymbol: order.instrumentSymbol, mode: this.mode },
      "tradovate placeOrder refused — adapter is quarantined",
    );
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    void brokerOrderId;
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }

  async getPositions(): Promise<BrokerPosition[]> {
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    void orderId;
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    void orderId;
    throw new AppError(UNSUPPORTED_MESSAGE, "UNSUPPORTED_INSTRUMENT");
  }
}

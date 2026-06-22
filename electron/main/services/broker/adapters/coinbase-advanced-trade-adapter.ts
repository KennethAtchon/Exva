import type { ConnectionTestResult } from "@/lib/types";
import { BROKER_SUPPORTED_INSTRUMENT_CLASSES } from "@electron/shared/domain/broker-capabilities";
import { AppError } from "@electron/shared/infra/errors";
import ccxt from "ccxt";
import type { Balances, Order } from "ccxt";
import { createLogger } from "../../infra/log";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";

/**
 * Coinbase Advanced Trade via CDP API keys.
 * CCXT maps `secret` to our stored `apiSecret` (EC private key PEM).
 */
export type CoinbaseAdvancedCredentials = {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
};

const logger = createLogger("coinbase-adapter");

function brokerProductToCcxtSymbol(productId: string): string {
  const id = productId.trim().toUpperCase();
  const dash = id.indexOf("-");
  if (dash <= 0 || dash === id.length - 1) {
    const err = new AppError(
      `Invalid Coinbase product id: ${productId}`,
      "BROKER_ERROR",
    );
    logger.error({ err, productId }, "coinbase: invalid product id");
    throw err;
  }
  const base = id.slice(0, dash);
  const quote = id.slice(dash + 1);
  return `${base}/${quote}`;
}

function quoteBalanceUsd(bal: Balances): number {
  const pick = (code: string) => {
    const row = bal[code];
    if (!row || typeof row !== "object") return 0;
    return Number((row as { total?: number }).total ?? 0);
  };
  return pick("USD") + pick("USDC");
}

/**
 * Crypto execution for Coinbase Advanced Trade using CCXT (`coinbaseadvanced`).
 */
export class CoinbaseAdvancedTradeAdapter implements BrokerAdapter {
  readonly brokerType = "coinbase_advanced_trade";
  readonly supportedInstrumentClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES.coinbase_advanced_trade;
  /**
   * Not launch-capable: closeOrder only cancels (does not flatten), getPositions
   * returns []. Live-readiness gate must block live sessions using this adapter
   * until close/flatten and positions are implemented against the Coinbase API.
   */
  readonly launchCapable = false;

  private exchange: InstanceType<typeof ccxt.coinbaseadvanced> | null = null;

  constructor(
    private readonly credentials: CoinbaseAdvancedCredentials,
    readonly mode: "paper" | "live",
    readonly _interactionLogger?: BrokerInteractionLogger,
  ) {}

  private getExchange(): InstanceType<typeof ccxt.coinbaseadvanced> {
    const apiKey = this.credentials.apiKey?.trim();
    const secret = this.credentials.apiSecret?.trim();
    if (!apiKey || !secret) {
      const err = new AppError(
        "Coinbase Advanced Trade requires API key and API secret (CDP private key).",
        "BROKER_ERROR",
      );
      logger.error({ err }, "coinbase: missing api key or secret");
      throw err;
    }
    if (!this.exchange) {
      this.exchange = new ccxt.coinbaseadvanced({
        apiKey,
        secret,
        password: this.credentials.passphrase?.trim() || undefined,
        enableRateLimit: true,
        options: {
          createMarketBuyOrderRequiresPrice: false,
        },
      });
    }
    return this.exchange;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (
      !this.credentials.apiKey?.trim() ||
      !this.credentials.apiSecret?.trim()
    ) {
      return {
        ok: false,
        message: "Coinbase API key and API secret (private key) are required.",
      };
    }
    if (this.mode === "paper") {
      return {
        ok: false,
        message:
          "Coinbase Advanced Trade has no paper API; use mock broker or a live account.",
      };
    }
    try {
      const ex = this.getExchange();
      const bal = await ex.fetchBalance();
      const usd = quoteBalanceUsd(bal);
      return {
        ok: true,
        message: "Coinbase Advanced Trade connected (CCXT).",
        account_balance: usd > 0 ? usd : undefined,
      };
    } catch (error) {
      logger.error({ err: error }, "coinbase testConnection: failed");
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Coinbase",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    logger.debug("coinbase getAccountBalance: fetching balance");
    const ex = this.getExchange();
    const bal = await ex.fetchBalance();
    return quoteBalanceUsd(bal);
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    logger.debug({ instrumentSymbol }, "coinbase getMarketSnapshot: fetching");
    const ex = this.getExchange();
    const symbol = brokerProductToCcxtSymbol(instrumentSymbol);
    const ticker = await ex.fetchTicker(symbol);
    const price = Number(ticker.last ?? ticker.close ?? ticker.bid ?? 0);
    return {
      instrumentSymbol,
      price,
      timestamp: ticker.datetime ?? new Date().toISOString(),
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
      "coinbase placeOrder: submitting order",
    );
    if (order.instrumentType !== "crypto") {
      const err = new AppError(
        "Coinbase adapter supports crypto only",
        "UNSUPPORTED_INSTRUMENT",
      );
      logger.error(
        { err, instrumentType: order.instrumentType },
        "coinbase placeOrder: unsupported instrument type",
      );
      throw err;
    }
    if (this.mode === "paper") {
      const err = new AppError(
        "Coinbase Advanced Trade does not support paper mode",
        "BROKER_ERROR",
      );
      logger.error({ err }, "coinbase placeOrder: paper mode unsupported");
      throw err;
    }
    const ex = this.getExchange();
    const symbol = brokerProductToCcxtSymbol(order.instrumentSymbol);
    await ex.loadMarkets();

    let filledAvg = 0;
    let ccxtOrder: Order;

    try {
      if (order.side === "BUY") {
        ccxtOrder = await ex.createMarketBuyOrder(symbol, order.sizeUsd);
        filledAvg = Number(ccxtOrder.average ?? ccxtOrder.price ?? 0);
      } else {
        const ticker = await ex.fetchTicker(symbol);
        const ref = Number(ticker.last ?? ticker.close ?? ticker.bid ?? 0);
        if (!ref) {
          const err = new AppError(
            "Could not price market for sell order",
            "BROKER_ERROR",
          );
          logger.error(
            { err, symbol },
            "coinbase placeOrder: no price for sell",
          );
          throw err;
        }
        const baseAmount = order.sizeUsd / ref;
        ccxtOrder = await ex.createMarketSellOrder(symbol, baseAmount);
        filledAvg = Number(ccxtOrder.average ?? ccxtOrder.price ?? ref);
      }
    } catch (err) {
      logger.error(
        { err, symbol, side: order.side, sizeUsd: order.sizeUsd },
        "coinbase placeOrder: ccxt order call threw",
      );
      throw err;
    }

    const id = ccxtOrder.id;
    if (!id) {
      const err = new AppError(
        "Coinbase did not return an order id",
        "BROKER_ERROR",
      );
      logger.error({ err, symbol }, "coinbase placeOrder: missing order id");
      throw err;
    }

    logger.info(
      { brokerOrderId: id, filledAvgPrice: filledAvg },
      "coinbase placeOrder: order accepted",
    );
    return {
      brokerOrderId: id,
      filledAvgPrice: filledAvg,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    logger.info({ brokerOrderId }, "coinbase cancelOrder: cancelling order");
    const ex = this.getExchange();
    await ex.cancelOrder(brokerOrderId);
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    logger.info({ orderId }, "coinbase closeOrder: cancelling order");
    await this.cancelOrder(orderId);
    return { brokerOrderId: orderId, realizedPnlUsd: 0 };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    logger.debug({ orderId }, "coinbase getOrderStatus: fetching");
    const ex = this.getExchange();
    const o = await ex.fetchOrder(orderId);
    const raw = (o.status ?? "").toLowerCase();
    const closed =
      raw === "closed" ||
      raw === "filled" ||
      raw === "canceled" ||
      raw === "cancelled" ||
      raw === "rejected" ||
      raw === "expired";
    return {
      brokerOrderId: o.id ?? orderId,
      status: closed ? "closed" : "open",
      latestPrice:
        o.average != null
          ? Number(o.average)
          : o.price != null
            ? Number(o.price)
            : null,
      realizedPnlUsd: null,
    };
  }
}

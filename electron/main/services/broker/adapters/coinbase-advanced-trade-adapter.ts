import type { ConnectionTestResult } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import ccxt from "ccxt";
import type { Balances, Order } from "ccxt";
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

function brokerProductToCcxtSymbol(productId: string): string {
  const id = productId.trim().toUpperCase();
  const dash = id.indexOf("-");
  if (dash <= 0 || dash === id.length - 1) {
    throw new AppError(`Invalid Coinbase product id: ${productId}`, "BROKER_ERROR");
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
  readonly supportedInstrumentClasses = ["crypto"] as const satisfies readonly InstrumentClass[];
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
  ) {}

  private getExchange(): InstanceType<typeof ccxt.coinbaseadvanced> {
    const apiKey = this.credentials.apiKey?.trim();
    const secret = this.credentials.apiSecret?.trim();
    if (!apiKey || !secret) {
      throw new AppError(
        "Coinbase Advanced Trade requires API key and API secret (CDP private key).",
        "BROKER_ERROR",
      );
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
    if (!this.credentials.apiKey?.trim() || !this.credentials.apiSecret?.trim()) {
      return { ok: false, message: "Coinbase API key and API secret (private key) are required." };
    }
    if (this.mode === "paper") {
      return {
        ok: false,
        message: "Coinbase Advanced Trade has no paper API; use mock broker or a live account.",
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
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to connect to Coinbase",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    const ex = this.getExchange();
    const bal = await ex.fetchBalance();
    return quoteBalanceUsd(bal);
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
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
    if (order.instrumentType !== "crypto") {
      throw new AppError("Coinbase adapter supports crypto only", "UNSUPPORTED_INSTRUMENT");
    }
    if (this.mode === "paper") {
      throw new AppError("Coinbase Advanced Trade does not support paper mode", "BROKER_ERROR");
    }
    const ex = this.getExchange();
    const symbol = brokerProductToCcxtSymbol(order.instrumentSymbol);
    await ex.loadMarkets();

    let filledAvg = 0;
    let ccxtOrder: Order;

    if (order.side === "BUY") {
      ccxtOrder = await ex.createMarketBuyOrder(symbol, order.sizeUsd);
      filledAvg = Number(ccxtOrder.average ?? ccxtOrder.price ?? 0);
    } else {
      const ticker = await ex.fetchTicker(symbol);
      const ref = Number(ticker.last ?? ticker.close ?? ticker.bid ?? 0);
      if (!ref) {
        throw new AppError("Could not price market for sell order", "BROKER_ERROR");
      }
      const baseAmount = order.sizeUsd / ref;
      ccxtOrder = await ex.createMarketSellOrder(symbol, baseAmount);
      filledAvg = Number(ccxtOrder.average ?? ccxtOrder.price ?? ref);
    }

    const id = ccxtOrder.id;
    if (!id) {
      throw new AppError("Coinbase did not return an order id", "BROKER_ERROR");
    }

    return {
      brokerOrderId: id,
      filledAvgPrice: filledAvg,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const ex = this.getExchange();
    await ex.cancelOrder(brokerOrderId);
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    await this.cancelOrder(orderId);
    return { brokerOrderId: orderId, realizedPnlUsd: 0 };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
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
      latestPrice: o.average != null ? Number(o.average) : o.price != null ? Number(o.price) : null,
      realizedPnlUsd: null,
    };
  }
}

import type { BrokerCredentials, ConnectionTestResult } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type {
  BrokerAdapter,
  CloseResult,
  MarketSnapshot,
  OrderRequest,
  OrderResult,
  OrderStatus,
} from "./broker-adapter";

export class AlpacaAdapter implements BrokerAdapter {
  readonly id = "alpaca" as const;
  private readonly baseUrl: string;

  constructor(private readonly credentials: BrokerCredentials) {
    this.baseUrl =
      credentials.mode === "paper"
        ? "https://paper-api.alpaca.markets"
        : "https://api.alpaca.markets";
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const account = await this.request<{ buying_power?: string; portfolio_value?: string }>("/v2/account");
      return {
        ok: true,
        message: `${this.credentials.mode === "paper" ? "Paper" : "Live"} Alpaca account connected`,
        account_balance: Number(account.portfolio_value ?? account.buying_power ?? 0),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to connect to Alpaca",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    const account = await this.request<{ portfolio_value?: string; buying_power?: string }>("/v2/account");
    return Number(account.portfolio_value ?? account.buying_power ?? 0);
  }

  async getMarketSnapshot(asset: string): Promise<MarketSnapshot> {
    const trade = await this.request<{ trade?: { p?: number; t?: string } }>(
      `/v2/stocks/${encodeURIComponent(asset)}/trades/latest`,
    );
    return {
      asset,
      price: Number(trade.trade?.p ?? 0),
      timestamp: trade.trade?.t ?? new Date().toISOString(),
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const result = await this.request<{ id: string; filled_avg_price?: string }>(
      "/v2/orders",
      {
        method: "POST",
        body: JSON.stringify({
          symbol: order.asset,
          notional: String(order.sizeUsd),
          side: order.side.toLowerCase(),
          type: "market",
          time_in_force: "day",
        }),
      },
    );
    return {
      brokerOrderId: result.id,
      filledAvgPrice: Number(result.filled_avg_price ?? 0),
    };
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    await this.request(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
    return { brokerOrderId: orderId, realizedPnlUsd: 0 };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const order = await this.request<{
      id: string;
      status: string;
      filled_avg_price?: string;
    }>(`/v2/orders/${encodeURIComponent(orderId)}`);
    return {
      brokerOrderId: order.id,
      status: order.status === "filled" || order.status === "canceled" ? "closed" : "open",
      latestPrice: order.filled_avg_price ? Number(order.filled_avg_price) : null,
      realizedPnlUsd: null,
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "APCA-API-KEY-ID": this.credentials.api_key,
        "APCA-API-SECRET-KEY": this.credentials.secret_key,
        "content-type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AppError(
        `Alpaca request failed (${response.status}): ${text.slice(0, 200)}`,
        "BROKER_ERROR",
        { status: response.status },
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

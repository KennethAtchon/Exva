import type { BrokerCredentials, ConnectionTestResult } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import { createHash } from "node:crypto";
import { createLogger } from "../../infra/log";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OhlcvBar,
  OrderStatus,
} from "./broker-adapter";

const logger = createLogger("alpaca-adapter");

const ALPACA_DATA_URL = "https://data.alpaca.markets";
const ALPACA_TIMEFRAME_MAP: Record<string, string> = {
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1d": "1Day",
};

export class AlpacaAdapter implements BrokerAdapter {
  readonly brokerType = "alpaca";
  readonly supportedInstrumentClasses = [
    "stock",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = true;

  private readonly baseUrl: string;

  constructor(private readonly credentials: BrokerCredentials) {
    this.baseUrl =
      credentials.mode === "paper"
        ? "https://paper-api.alpaca.markets"
        : "https://api.alpaca.markets";
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const account = await this.request<{
        buying_power?: string;
        cash?: string;
        equity?: string;
        portfolio_value?: string;
      }>("/v2/account");
      return {
        ok: true,
        message: `${this.credentials.mode === "paper" ? "Paper" : "Live"} Alpaca account connected`,
        account_balance: resolveAccountBalance(account),
      };
    } catch (error) {
      logger.error({ err: error }, "alpaca testConnection: failed");
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Alpaca",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    const account = await this.request<{
      portfolio_value?: string;
      buying_power?: string;
      cash?: string;
      equity?: string;
    }>("/v2/account");
    return resolveAccountBalance(account);
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    const params = new URLSearchParams({ feed: "iex" });
    const trade = await this.dataRequest<{
      trade?: { p?: number; t?: string };
    }>(
      `/v2/stocks/${encodeURIComponent(instrumentSymbol)}/trades/latest?${params}`,
    );
    return {
      instrumentSymbol,
      price: Number(trade.trade?.p ?? 0),
      timestamp: trade.trade?.t ?? new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    logger.info(
      {
        instrumentSymbol: order.instrumentSymbol,
        side: order.side,
        sizeUsd: order.sizeUsd,
        instrumentType: order.instrumentType,
      },
      "alpaca placeOrder: submitting order",
    );
    if (order.instrumentType !== "stock") {
      const err = new AppError(
        "Alpaca adapter supports stocks only",
        "UNSUPPORTED_INSTRUMENT",
        {
          instrumentType: order.instrumentType,
        },
      );
      logger.error(
        { err, instrumentType: order.instrumentType },
        "alpaca placeOrder: unsupported instrument type",
      );
      throw err;
    }
    const result = await this.request<{
      id: string;
      filled_avg_price?: string;
      status?: string;
    }>("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: order.instrumentSymbol,
        notional: String(order.sizeUsd),
        side: order.side.toLowerCase(),
        type: "market",
        time_in_force: "day",
        client_order_id: toAlpacaClientOrderId(order.clientOrderId),
      }),
    });
    const filledAvgPrice = await this.resolveFilledAvgPrice(result);
    logger.info(
      {
        brokerOrderId: result.id,
        filledAvgPrice,
        status: result.status ?? null,
      },
      "alpaca placeOrder: order accepted",
    );
    return {
      brokerOrderId: result.id,
      filledAvgPrice,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    logger.info({ brokerOrderId }, "alpaca cancelOrder: cancelling order");
    await this.request(`/v2/orders/${encodeURIComponent(brokerOrderId)}`, {
      method: "DELETE",
    });
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const raw = await this.request<
      | Array<{
          symbol: string;
          qty: string;
          market_value?: string;
          unrealized_pl?: string;
          asset_class?: string;
        }>
      | Record<string, never>
    >("/v2/positions");
    const rows = Array.isArray(raw) ? raw : [];
    return rows
      .filter((row) => (row.asset_class ?? "us_equity") === "us_equity")
      .map((row) => ({
        instrumentSymbol: row.symbol,
        instrumentType: "stock" as const,
        side: Number(row.qty) >= 0 ? ("long" as const) : ("short" as const),
        sizeUsd: Math.abs(Number(row.market_value ?? 0)),
        unrealizedPnl: Number(row.unrealized_pl ?? 0),
      }));
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    logger.info({ orderId }, "alpaca closeOrder: closing order");
    // Real close: look up the order's symbol, then ask Alpaca to flatten that
    // symbol's position. If the order never filled, just cancel it.
    let symbol: string | null = null;
    let status: string = "";
    try {
      const order = await this.request<{ symbol?: string; status?: string }>(
        `/v2/orders/${encodeURIComponent(orderId)}`,
      );
      symbol = order.symbol ?? null;
      status = (order.status ?? "").toLowerCase();
    } catch (err) {
      logger.warn(
        { err, orderId },
        "alpaca closeOrder: could not fetch order; falling through to cancel-only",
      );
    }

    if (!symbol || status !== "filled") {
      await this.cancelOrder(orderId).catch(() => undefined);
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }

    // Capture pre-close unrealized pnl as a best-effort realized estimate.
    let realizedPnlUsd = 0;
    try {
      const pos = await this.request<{ unrealized_pl?: string }>(
        `/v2/positions/${encodeURIComponent(symbol)}`,
      );
      realizedPnlUsd = Number(pos.unrealized_pl ?? 0);
    } catch (err) {
      logger.warn(
        { err, symbol },
        "alpaca closeOrder: could not fetch position pnl; defaulting to 0",
      );
    }

    try {
      await this.request(`/v2/positions/${encodeURIComponent(symbol)}`, {
        method: "DELETE",
      });
    } catch (err) {
      logger.warn(
        { err, symbol },
        "alpaca closeOrder: could not delete position; may already be flat",
      );
    }

    return { brokerOrderId: orderId, realizedPnlUsd };
  }

  async getOhlcv(
    instrumentSymbol: string,
    timeframe: "1h" | "4h" | "1d",
    barCount: number,
  ): Promise<OhlcvBar[]> {
    const alpacaTimeframe = ALPACA_TIMEFRAME_MAP[timeframe] ?? "1Day";
    const params = new URLSearchParams({
      timeframe: alpacaTimeframe,
      limit: String(barCount),
      feed: "iex",
    });
    const data = await this.dataRequest<{
      bars?: Array<{
        t: string;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      }>;
    }>(`/v2/stocks/${encodeURIComponent(instrumentSymbol)}/bars?${params}`);
    return (data.bars ?? []).map((bar) => ({
      ts: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const order = await this.request<{
      id: string;
      status: string;
      filled_avg_price?: string;
    }>(`/v2/orders/${encodeURIComponent(orderId)}`);
    return {
      brokerOrderId: order.id,
      status:
        order.status === "filled" || order.status === "canceled"
          ? "closed"
          : "open",
      latestPrice: order.filled_avg_price
        ? Number(order.filled_avg_price)
        : null,
      realizedPnlUsd: null,
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.fetchWithAuth(this.baseUrl, path, init);
  }

  private async dataRequest<T>(path: string): Promise<T> {
    return this.fetchWithAuth(ALPACA_DATA_URL, path);
  }

  private async resolveFilledAvgPrice(order: {
    id: string;
    filled_avg_price?: string;
    status?: string;
  }): Promise<number> {
    const immediate = parsePositiveNumber(order.filled_avg_price);
    if (immediate != null) return immediate;

    const refreshed = await this.request<{
      filled_avg_price?: string;
      status?: string;
    }>(`/v2/orders/${encodeURIComponent(order.id)}`);
    const refreshedPrice = parsePositiveNumber(refreshed.filled_avg_price);
    if (refreshedPrice != null) return refreshedPrice;

    const err = new AppError(
      "Alpaca accepted the order but did not report a filled average price.",
      "BROKER_ERROR",
      {
        status: refreshed.status ?? order.status ?? null,
        brokerOrderIdLength: order.id.length,
      },
    );
    logger.error(
      {
        err,
        brokerOrderId: order.id,
        status: refreshed.status ?? order.status ?? null,
      },
      "alpaca placeOrder: order accepted but no filled average price reported",
    );
    throw err;
  }

  private async fetchWithAuth<T>(
    baseUrl: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const method = init.method ?? "GET";
    logger.debug({ method, baseUrl, path }, "alpaca request: sending");

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "APCA-API-KEY-ID": this.credentials.api_key,
          "APCA-API-SECRET-KEY": this.credentials.secret_key,
          "content-type": "application/json",
          ...init.headers,
        },
      });
    } catch (err) {
      logger.error(
        { err, method, baseUrl, path },
        "alpaca request: network error",
      );
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new AppError(
        `Alpaca request failed (${response.status}): ${text.slice(0, 200)}`,
        "BROKER_ERROR",
        { status: response.status },
      );
      logger.error(
        {
          err,
          method,
          path,
          status: response.status,
          body: text.slice(0, 500),
        },
        "alpaca request: non-ok response",
      );
      throw err;
    }

    logger.debug(
      { method, path, status: response.status },
      "alpaca request: ok",
    );
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function resolveAccountBalance(account: {
  cash?: string;
  buying_power?: string;
  equity?: string;
  portfolio_value?: string;
}): number {
  const parsed = [
    account.cash,
    account.buying_power,
    account.equity,
    account.portfolio_value,
  ]
    .map((value) => (value == null ? null : Number(value)))
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );

  return parsed.find((value) => value > 0) ?? parsed[0] ?? 0;
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toAlpacaClientOrderId(clientOrderId: string): string {
  if (/^[A-Za-z0-9_-]{1,48}$/.test(clientOrderId)) return clientOrderId;
  return `exva-${createHash("sha256").update(clientOrderId).digest("hex").slice(0, 43)}`;
}

import type {
  BrokerCredentials,
  ConnectionTestResult,
  InstrumentClass,
} from "@/lib/types";
import { BROKER_SUPPORTED_INSTRUMENT_CLASSES } from "@electron/shared/domain/broker-capabilities";
import { getUsEquitySession } from "@electron/shared/instruments/us-equity-session";
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

/** Poll a freshly-placed order this many times before declaring no fill. */
const FILL_POLL_ATTEMPTS = 3;
const FILL_POLL_INTERVAL_MS = 500;
const ALPACA_TIMEFRAME_MAP: Record<string, string> = {
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1d": "1Day",
};

/**
 * Alpaca uses a slash in crypto wire symbols (e.g. `BTC/USD`) and a bare ticker
 * for equities (`AAPL`). The instrument normalizer emits these formats, so the
 * presence of `/` is a reliable way to pick the equity vs crypto API surface
 * for the symbol-only data methods.
 */
function isCryptoWireSymbol(instrumentSymbol: string): boolean {
  return instrumentSymbol.includes("/");
}

/**
 * OCC option symbols are `<root><yymmdd><C|P><strike*1000 padded to 8>`, e.g.
 * `AAPL250117C00150000`. The trailing 15 chars are a fixed, unambiguous shape
 * that no equity or crypto ticker shares, so it reliably picks the options API
 * surface for the symbol-only data methods.
 */
function isOptionWireSymbol(instrumentSymbol: string): boolean {
  return /\d{6}[CP]\d{8}$/.test(instrumentSymbol);
}

export class AlpacaAdapter implements BrokerAdapter {
  readonly brokerType = "alpaca";
  readonly supportedInstrumentClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES.alpaca;
  readonly launchCapable = true;

  private readonly baseUrl: string;

  /**
   * @param now Clock used to classify the current US trading session when
   * choosing order type. Injectable so order-type behavior is deterministic in
   * tests; defaults to the real wall clock in production.
   */
  constructor(
    private readonly credentials: BrokerCredentials,
    private readonly now: () => Date = () => new Date(),
  ) {
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
    if (isCryptoWireSymbol(instrumentSymbol)) {
      return this.getCryptoMarketSnapshot(instrumentSymbol);
    }
    if (isOptionWireSymbol(instrumentSymbol)) {
      return this.getOptionMarketSnapshot(instrumentSymbol);
    }
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

  private async getCryptoMarketSnapshot(
    instrumentSymbol: string,
  ): Promise<MarketSnapshot> {
    const params = new URLSearchParams({ symbols: instrumentSymbol });
    const data = await this.dataRequest<{
      trades?: Record<string, { p?: number; t?: string }>;
    }>(`/v1beta3/crypto/us/latest/trades?${params}`);
    const trade = data.trades?.[instrumentSymbol];
    return {
      instrumentSymbol,
      price: Number(trade?.p ?? 0),
      timestamp: trade?.t ?? new Date().toISOString(),
    };
  }

  private async getOptionMarketSnapshot(
    instrumentSymbol: string,
  ): Promise<MarketSnapshot> {
    // `feed=indicative` is available on the free options data plan; OPRA
    // requires a paid subscription. The per-contract price is reported, not
    // the total premium (premium = price * 100 * contracts).
    const params = new URLSearchParams({
      symbols: instrumentSymbol,
      feed: "indicative",
    });
    const data = await this.dataRequest<{
      trades?: Record<string, { p?: number; t?: string }>;
    }>(`/v1beta1/options/trades/latest?${params}`);
    const trade = data.trades?.[instrumentSymbol];
    return {
      instrumentSymbol,
      price: Number(trade?.p ?? 0),
      timestamp: trade?.t ?? new Date().toISOString(),
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
    if (
      order.instrumentType !== "stock" &&
      order.instrumentType !== "crypto" &&
      order.instrumentType !== "options"
    ) {
      const err = new AppError(
        "Alpaca adapter supports stocks, crypto, and options only",
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

    const body = await this.buildOrderBody(order);
    const result = await this.request<{
      id: string;
      filled_avg_price?: string;
      status?: string;
    }>("/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
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
      .filter((row) => {
        const assetClass = row.asset_class ?? "us_equity";
        return (
          assetClass === "us_equity" ||
          assetClass === "crypto" ||
          assetClass === "us_option"
        );
      })
      .map((row) => ({
        instrumentSymbol: row.symbol,
        instrumentType: mapAlpacaAssetClass(row.asset_class),
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
    if (isCryptoWireSymbol(instrumentSymbol)) {
      return this.getCryptoOhlcv(instrumentSymbol, alpacaTimeframe, barCount);
    }
    if (isOptionWireSymbol(instrumentSymbol)) {
      return this.getOptionOhlcv(instrumentSymbol, alpacaTimeframe, barCount);
    }
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
    return (data.bars ?? []).map(toOhlcvBar);
  }

  private async getCryptoOhlcv(
    instrumentSymbol: string,
    alpacaTimeframe: string,
    barCount: number,
  ): Promise<OhlcvBar[]> {
    const params = new URLSearchParams({
      symbols: instrumentSymbol,
      timeframe: alpacaTimeframe,
      limit: String(barCount),
    });
    const data = await this.dataRequest<{
      bars?: Record<
        string,
        Array<{
          t: string;
          o: number;
          h: number;
          l: number;
          c: number;
          v: number;
        }>
      >;
    }>(`/v1beta3/crypto/us/bars?${params}`);
    return (data.bars?.[instrumentSymbol] ?? []).map(toOhlcvBar);
  }

  private async getOptionOhlcv(
    instrumentSymbol: string,
    alpacaTimeframe: string,
    barCount: number,
  ): Promise<OhlcvBar[]> {
    const params = new URLSearchParams({
      symbols: instrumentSymbol,
      timeframe: alpacaTimeframe,
      limit: String(barCount),
    });
    const data = await this.dataRequest<{
      bars?: Record<
        string,
        Array<{
          t: string;
          o: number;
          h: number;
          l: number;
          c: number;
          v: number;
        }>
      >;
    }>(`/v1beta1/options/bars?${params}`);
    return (data.bars?.[instrumentSymbol] ?? []).map(toOhlcvBar);
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

  /**
   * Construct the Alpaca order payload, choosing order type by instrument and
   * current US trading session. The rule we enforce: never place a market order
   * outside regular hours, because off-hours market orders only queue and never
   * report a fill price (the failure that originally surfaced this code path).
   *
   * - crypto → market GTC, dollar-notional (24/7 market).
   * - equity/option in regular hours → market DAY (options sized in contracts,
   *   equities dollar-notional).
   * - equity in extended hours → marketable LIMIT DAY with `extended_hours`,
   *   sized in whole shares (Alpaca rejects notional/fractional off-hours).
   * - anything else (options off-hours, or fully closed) → fail loud.
   *
   * Whether an off-hours order reaches this adapter at all is gated upstream by
   * the session's off-hours policy in the market-hours guard.
   */
  private async buildOrderBody(
    order: BrokerOrder,
  ): Promise<Record<string, unknown>> {
    const base = {
      symbol: order.instrumentSymbol,
      side: order.side.toLowerCase(),
      client_order_id: toAlpacaClientOrderId(order.clientOrderId),
    };

    if (order.instrumentType === "crypto") {
      return {
        ...base,
        notional: String(order.sizeUsd),
        type: "market",
        time_in_force: "gtc",
      };
    }

    const session = getUsEquitySession(this.now());

    if (session === "regular") {
      const sizing =
        order.instrumentType === "options"
          ? { qty: String(await this.resolveOptionContractQty(order)) }
          : { notional: String(order.sizeUsd) };
      return { ...base, ...sizing, type: "market", time_in_force: "day" };
    }

    if (session === "extended" && order.instrumentType === "stock") {
      const snapshot = await this.getMarketSnapshot(order.instrumentSymbol);
      if (!(snapshot.price > 0)) {
        throw new AppError(
          "Alpaca extended-hours order: no quotable price to set a limit against.",
          "BROKER_ERROR",
          { instrumentSymbol: order.instrumentSymbol },
        );
      }
      // Cross the spread by 0.5% so the limit is marketable and fills promptly.
      const slip = order.side === "BUY" ? 1.005 : 0.995;
      const limitPrice = roundToPenny(snapshot.price * slip);
      const qty = Math.max(1, Math.floor(order.sizeUsd / limitPrice));
      return {
        ...base,
        qty: String(qty),
        type: "limit",
        limit_price: String(limitPrice),
        time_in_force: "day",
        extended_hours: true,
      };
    }

    throw new AppError(
      `Alpaca market is closed for ${order.instrumentSymbol}; ${order.instrumentType} orders cannot be placed outside trading hours.`,
      "MARKET_CLOSED",
      {
        instrumentSymbol: order.instrumentSymbol,
        instrumentType: order.instrumentType,
        session,
      },
    );
  }

  /**
   * Translate a dollar budget into a whole number of option contracts. Each
   * contract costs `pricePerShare * 100`. Rounds down so we never exceed the
   * budget, with a floor of one contract since options cannot be fractional.
   */
  private async resolveOptionContractQty(order: BrokerOrder): Promise<number> {
    const snapshot = await this.getOptionMarketSnapshot(order.instrumentSymbol);
    const perContractCost = snapshot.price * 100;
    if (!(perContractCost > 0)) {
      throw new AppError(
        "Alpaca options order: no quotable contract price to size against.",
        "BROKER_ERROR",
        { instrumentSymbol: order.instrumentSymbol },
      );
    }
    return Math.max(1, Math.floor(order.sizeUsd / perContractCost));
  }

  /**
   * Resolve the average fill price. A just-submitted order may report no price
   * until the fill propagates, so we poll the order a few times before giving
   * up. We still fail loud if it never fills — a trade with no entry price is
   * worse than an error, since downstream PnL would be meaningless.
   */
  private async resolveFilledAvgPrice(order: {
    id: string;
    filled_avg_price?: string;
    status?: string;
  }): Promise<number> {
    const immediate = parsePositiveNumber(order.filled_avg_price);
    if (immediate != null) return immediate;

    let lastStatus = order.status ?? null;
    for (let attempt = 0; attempt < FILL_POLL_ATTEMPTS; attempt++) {
      await sleep(FILL_POLL_INTERVAL_MS);
      const refreshed = await this.request<{
        filled_avg_price?: string;
        status?: string;
      }>(`/v2/orders/${encodeURIComponent(order.id)}`);
      const price = parsePositiveNumber(refreshed.filled_avg_price);
      if (price != null) return price;
      lastStatus = refreshed.status ?? lastStatus;
    }

    const err = new AppError(
      "Alpaca accepted the order but did not report a filled average price.",
      "BROKER_ERROR",
      {
        status: lastStatus,
        brokerOrderIdLength: order.id.length,
      },
    );
    logger.error(
      {
        err,
        brokerOrderId: order.id,
        status: lastStatus,
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

/** Map an Alpaca `asset_class` to our instrument model (defaults to stock). */
function mapAlpacaAssetClass(assetClass: string | undefined): InstrumentClass {
  if (assetClass === "crypto") return "crypto";
  if (assetClass === "us_option") return "options";
  return "stock";
}

function toOhlcvBar(bar: {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}): OhlcvBar {
  return {
    ts: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Round to whole cents; Alpaca rejects equity limit prices below penny ticks. */
function roundToPenny(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAlpacaClientOrderId(clientOrderId: string): string {
  if (/^[A-Za-z0-9_-]{1,48}$/.test(clientOrderId)) return clientOrderId;
  return `exva-${createHash("sha256").update(clientOrderId).digest("hex").slice(0, 43)}`;
}

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
import { safeJsonParse } from "../../infra/safe-json-parse";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import { inferAlpacaHttpCallType } from "../broker-interaction-logger";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OhlcvBar,
  OptionChainContract,
  OrderStatus,
} from "./broker-adapter";
import {
  ALPACA_CAPABILITIES,
  adapterSupportsOrder,
  lowerBrokerOrderV2ToV1,
  type BrokerOrderV2,
  type OrderEventFeed,
} from "../order-contract-v2";
import { createStreamingOrderEventFeed } from "../streaming-order-event-feed";
import type { OrderEvent } from "../order-contract-v2";
import {
  brokerDataError,
  requireFiniteNumber,
  requirePositivePrice,
} from "../broker-errors";

const logger = createLogger("alpaca-adapter");

const ALPACA_DATA_URL = "https://data.alpaca.markets";

/** Poll a freshly-placed order this many times before declaring no fill. */
const FILL_POLL_ATTEMPTS = 3;
const FILL_POLL_INTERVAL_MS = 500;
/** Order-event feed cadence: paper is slower to be gentle on rate limits. */
const ORDER_EVENT_POLL_MS_PAPER = 15_000;
const ORDER_EVENT_POLL_MS_LIVE = 5_000;
const ALPACA_TIMEFRAME_MAP: Record<string, string> = {
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1d": "1Day",
};

/** Minutes spanned by one bar of each Alpaca timeframe. */
const ALPACA_TIMEFRAME_MINUTES: Record<string, number> = {
  "15Min": 15,
  "30Min": 30,
  "1Hour": 60,
  "4Hour": 240,
  "1Day": 1440,
};

/**
 * Alpaca's bars endpoints return an EMPTY array when `start` is omitted — the
 * default window resolves to nothing usable on the free IEX/indicative feeds.
 * Without `start`, every OHLCV fetch silently returns `[]`, which starves the
 * deterministic signal engines and pins them at their "insufficient bars" skip.
 * So we always pass an explicit lookback window wide enough to yield `barCount`
 * bars, with ~3x slack so weekends/closed sessions still backfill enough bars.
 */
function barLookbackStartIso(
  alpacaTimeframe: string,
  barCount: number,
  now: Date,
): string {
  const minutesPerBar = ALPACA_TIMEFRAME_MINUTES[alpacaTimeframe] ?? 1440;
  const spanMs = minutesPerBar * 60_000 * Math.max(barCount, 1) * 3;
  return new Date(now.getTime() - spanMs).toISOString();
}

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
  readonly capabilities = ALPACA_CAPABILITIES;

  private readonly baseUrl: string;

  /**
   * @param now Clock used to classify the current US trading session when
   * choosing order type. Injectable so order-type behavior is deterministic in
   * tests; defaults to the real wall clock in production.
   */
  constructor(
    private readonly credentials: BrokerCredentials,
    private readonly now: () => Date = () => new Date(),
    private readonly interactionLogger?: BrokerInteractionLogger,
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
      price: requirePositivePrice(trade.trade?.p, "trade.price", {
        broker: "alpaca",
        symbol: instrumentSymbol,
      }),
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
      price: requirePositivePrice(trade?.p, "trade.price", {
        broker: "alpaca",
        symbol: instrumentSymbol,
      }),
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
      price: requirePositivePrice(trade?.p, "trade.price", {
        broker: "alpaca",
        symbol: instrumentSymbol,
      }),
      timestamp: trade?.t ?? new Date().toISOString(),
    };
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) {
      throw new AppError(
        `Alpaca rejects order: ${check.reason}`,
        "BROKER_REJECTED",
      );
    }
    if (
      order.orderType === "market" &&
      order.quantity.kind === "notional_usd"
    ) {
      return this.placeOrder(lowerBrokerOrderV2ToV1(order));
    }
    // Every other advertised orderType/quantityKind combination sizes in
    // whole units. Alpaca does not accept `notional` for stop/stop_limit
    // orders (or options) at all, so notional requests there are converted
    // to units via a live quote — same contract (a dollar-sized request),
    // honored by computing the right quantity instead of a param Alpaca
    // would reject.
    const unitsOrder = await this.toUnitsOrder(order);
    switch (unitsOrder.orderType) {
      case "limit":
        return this.submitRawOrder(
          await this.buildLimitUnitsBody(unitsOrder),
          unitsOrder.limitPrice,
        );
      case "market":
        return this.submitRawOrder(await this.buildMarketUnitsBody(unitsOrder));
      case "stop":
        return this.submitRawOrder(
          await this.buildStopUnitsBody(unitsOrder),
          unitsOrder.stopPrice,
        );
      case "stop_limit":
        return this.submitRawOrder(
          await this.buildStopLimitUnitsBody(unitsOrder),
          unitsOrder.limitPrice ?? unitsOrder.stopPrice,
        );
      default:
        throw new AppError(
          `Alpaca placeOrderV2: ${unitsOrder.orderType} not supported`,
          "BROKER_REJECTED",
        );
    }
  }

  /** Convert a notional_usd request into a units request via a live quote; pass units requests through unchanged. */
  private async toUnitsOrder(order: BrokerOrderV2): Promise<BrokerOrderV2> {
    if (order.quantity.kind === "units") return order;
    const qty = await this.resolveUnitsFromNotional(order);
    return { ...order, quantity: { kind: "units", value: qty } };
  }

  private async resolveUnitsFromNotional(
    order: BrokerOrderV2,
  ): Promise<number> {
    const notionalUsd = order.quantity.value;
    if (order.instrument.instrumentClass === "options") {
      const snapshot = await this.getOptionMarketSnapshot(
        order.instrument.symbol,
      );
      const perContractCost = snapshot.price * 100;
      if (!(perContractCost > 0)) {
        throw new AppError(
          "Alpaca options order: no quotable contract price to size against.",
          "BROKER_ERROR",
          { instrumentSymbol: order.instrument.symbol },
        );
      }
      return Math.max(1, Math.floor(notionalUsd / perContractCost));
    }
    const snapshot = await this.getMarketSnapshot(order.instrument.symbol);
    if (!(snapshot.price > 0)) {
      throw new AppError(
        "Alpaca order: no quotable price to convert notional size into units.",
        "BROKER_ERROR",
        { instrumentSymbol: order.instrument.symbol },
      );
    }
    return Math.max(1, Math.floor(notionalUsd / snapshot.price));
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
      .map((row) => {
        const qty = requireFiniteNumber(row.qty, "position.qty", {
          broker: "alpaca",
          symbol: row.symbol,
        });
        const marketValue = requireFiniteNumber(
          row.market_value,
          "position.market_value",
          { broker: "alpaca", symbol: row.symbol },
        );
        const unrealizedPnl = requireFiniteNumber(
          row.unrealized_pl,
          "position.unrealized_pl",
          { broker: "alpaca", symbol: row.symbol },
        );
        return {
          instrumentSymbol: row.symbol,
          instrumentType: mapAlpacaAssetClass(row.asset_class),
          side: qty >= 0 ? ("long" as const) : ("short" as const),
          sizeUsd: Math.abs(marketValue),
          unrealizedPnl,
        };
      });
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
      realizedPnlUsd = requireFiniteNumber(
        pos.unrealized_pl,
        "position.unrealized_pl",
        { broker: "alpaca", symbol },
      );
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
      start: barLookbackStartIso(alpacaTimeframe, barCount, this.now()),
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
      start: barLookbackStartIso(alpacaTimeframe, barCount, this.now()),
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
      start: barLookbackStartIso(alpacaTimeframe, barCount, this.now()),
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

  /**
   * Option chain via the snapshots endpoint (free `indicative` feed). Greeks,
   * IV, day volume, and quotes are best-effort — fields the feed omits come
   * back null/0 rather than throwing, so the UOA detector degrades to a skip
   * instead of crashing the cycle.
   */
  async getOptionChain(
    underlyingSymbol: string,
  ): Promise<OptionChainContract[]> {
    const params = new URLSearchParams({ feed: "indicative", limit: "1000" });
    const data = await this.dataRequest<{
      snapshots?: Record<
        string,
        {
          latestQuote?: { bp?: number; ap?: number };
          greeks?: { delta?: number };
          impliedVolatility?: number;
          dailyBar?: { v?: number };
          openInterest?: number;
        }
      >;
    }>(
      `/v1beta1/options/snapshots/${encodeURIComponent(underlyingSymbol)}?${params}`,
    );

    const snapshots = data.snapshots ?? {};
    const chain: OptionChainContract[] = [];
    for (const [occSymbol, snap] of Object.entries(snapshots)) {
      const parsed = parseOccSymbol(occSymbol);
      if (!parsed) continue;
      const delta = snap.greeks?.delta;
      chain.push({
        symbol: occSymbol,
        type: parsed.type,
        strike: parsed.strike,
        expiry: parsed.expiry,
        delta: typeof delta === "number" ? Math.abs(delta) : null,
        impliedVolatility:
          typeof snap.impliedVolatility === "number"
            ? snap.impliedVolatility
            : null,
        openInterest:
          typeof snap.openInterest === "number" ? snap.openInterest : 0,
        dayVolume: typeof snap.dailyBar?.v === "number" ? snap.dailyBar.v : 0,
        bid:
          typeof snap.latestQuote?.bp === "number" ? snap.latestQuote.bp : null,
        ask:
          typeof snap.latestQuote?.ap === "number" ? snap.latestQuote.ap : null,
      });
    }
    return chain;
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
        ? requirePositivePrice(
            order.filled_avg_price,
            "order.filled_avg_price",
            { broker: "alpaca", orderId },
          )
        : null,
      realizedPnlUsd: null,
    };
  }

  /**
   * WebSocket trade_updates feed with reconnect + poll fallback.
   * TradeMonitor calls watchOrders after create; empty seed is intentional.
   */
  createOrderEventFeed(opts?: {
    onFallbackToPoll?: (reason: string) => void;
  }): OrderEventFeed {
    const intervalMs =
      this.credentials.mode === "paper"
        ? ORDER_EVENT_POLL_MS_PAPER
        : ORDER_EVENT_POLL_MS_LIVE;
    const streamUrl = `${this.baseUrl.replace("https://", "wss://")}/stream`;
    return createStreamingOrderEventFeed({
      url: streamUrl,
      adapter: this,
      pollIntervalMs: intervalMs,
      maxReconnectAttempts: 5,
      onOpen: (socket) => {
        socket.send(
          JSON.stringify({
            action: "auth",
            key: this.credentials.api_key,
            secret: this.credentials.secret_key,
          }),
        );
        socket.send(
          JSON.stringify({
            action: "listen",
            data: { streams: ["trade_updates"] },
          }),
        );
      },
      mapMessage: (raw) => mapAlpacaTradeUpdate(raw),
      isProtocolAck: (raw) => isAlpacaStreamAck(raw),
      onFallbackToPoll: (reason) => {
        logger.warn({ reason }, "alpaca order feed using poll fallback");
        opts?.onFallbackToPoll?.(reason);
      },
    });
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
  private async submitRawOrder(
    body: Record<string, unknown>,
    restingFallbackPrice?: number,
  ): Promise<BrokerOrderResult> {
    const result = await this.request<{
      id: string;
      filled_avg_price?: string;
      status?: string;
    }>("/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const filledAvgPrice = await this.resolveFilledAvgPrice(
      result,
      restingFallbackPrice,
    );
    return { brokerOrderId: result.id, filledAvgPrice };
  }

  /**
   * Explicit v2 limit+units: qty + limit_price. Reuses the extended-hours
   * `extended_hours: true` flag from the marketable-limit path in buildOrderBody.
   */
  private async buildLimitUnitsBody(
    order: BrokerOrderV2,
  ): Promise<Record<string, unknown>> {
    if (order.limitPrice == null || !(order.limitPrice > 0)) {
      throw new AppError(
        "Alpaca limit order requires a positive limitPrice.",
        "VALIDATION_FAILED",
      );
    }
    if (order.quantity.kind !== "units" || !(order.quantity.value > 0)) {
      throw new AppError(
        "Alpaca limit+units requires a positive units quantity.",
        "VALIDATION_FAILED",
      );
    }
    const instrumentType = order.instrument.instrumentClass;
    const base = {
      symbol: order.instrument.symbol,
      side: order.side.toLowerCase(),
      client_order_id: toAlpacaClientOrderId(order.clientOrderId),
      qty: String(order.quantity.value),
      type: "limit",
      limit_price: String(roundToPenny(order.limitPrice)),
      time_in_force: order.timeInForce,
    };

    if (instrumentType === "crypto") {
      return {
        ...base,
        time_in_force: order.timeInForce === "day" ? "gtc" : order.timeInForce,
      };
    }

    const session = getUsEquitySession(this.now());
    if (session === "regular") {
      return base;
    }
    if (session === "extended" && instrumentType === "stock") {
      return { ...base, time_in_force: "day", extended_hours: true };
    }
    throw new AppError(
      `Alpaca market is closed for ${order.instrument.symbol}; ${instrumentType} limit orders cannot be placed outside trading hours.`,
      "MARKET_CLOSED",
      {
        instrumentSymbol: order.instrument.symbol,
        instrumentType,
        session,
      },
    );
  }

  /** Explicit v2 market+units: qty market order when the session supports it. */
  private async buildMarketUnitsBody(
    order: BrokerOrderV2,
  ): Promise<Record<string, unknown>> {
    if (order.quantity.kind !== "units" || !(order.quantity.value > 0)) {
      throw new AppError(
        "Alpaca market+units requires a positive units quantity.",
        "VALIDATION_FAILED",
      );
    }
    const instrumentType = order.instrument.instrumentClass;
    const base = {
      symbol: order.instrument.symbol,
      side: order.side.toLowerCase(),
      client_order_id: toAlpacaClientOrderId(order.clientOrderId),
      qty: String(order.quantity.value),
      type: "market",
    };

    if (instrumentType === "crypto") {
      return { ...base, time_in_force: "gtc" };
    }

    const session = getUsEquitySession(this.now());
    if (session === "regular") {
      return {
        ...base,
        time_in_force: order.timeInForce === "gtc" ? "day" : order.timeInForce,
      };
    }
    throw new AppError(
      `Alpaca market+units is only supported in regular hours for ${instrumentType}; use limit+units for extended hours.`,
      "MARKET_CLOSED",
      {
        instrumentSymbol: order.instrument.symbol,
        instrumentType,
        session,
      },
    );
  }

  /**
   * Explicit v2 stop+units: qty + stop_price. Alpaca does not allow
   * extended-hours or notional stop orders, so this always sizes in units and
   * requires the regular session (crypto trades 24/7).
   */
  private async buildStopUnitsBody(
    order: BrokerOrderV2,
  ): Promise<Record<string, unknown>> {
    if (order.stopPrice == null || !(order.stopPrice > 0)) {
      throw new AppError(
        "Alpaca stop order requires a positive stopPrice.",
        "VALIDATION_FAILED",
      );
    }
    if (order.quantity.kind !== "units" || !(order.quantity.value > 0)) {
      throw new AppError(
        "Alpaca stop+units requires a positive units quantity.",
        "VALIDATION_FAILED",
      );
    }
    const instrumentType = order.instrument.instrumentClass;
    const base = {
      symbol: order.instrument.symbol,
      side: order.side.toLowerCase(),
      client_order_id: toAlpacaClientOrderId(order.clientOrderId),
      qty: String(order.quantity.value),
      type: "stop",
      stop_price: String(roundToPenny(order.stopPrice)),
      time_in_force: order.timeInForce,
    };

    if (instrumentType === "crypto") {
      return {
        ...base,
        time_in_force: order.timeInForce === "day" ? "gtc" : order.timeInForce,
      };
    }

    const session = getUsEquitySession(this.now());
    if (session === "regular") return base;
    throw new AppError(
      `Alpaca stop orders require regular trading hours for ${order.instrument.symbol}; extended-hours stop orders are not supported.`,
      "MARKET_CLOSED",
      { instrumentSymbol: order.instrument.symbol, instrumentType, session },
    );
  }

  /** Explicit v2 stop_limit+units: qty + stop_price + limit_price; same hours rule as plain stop. */
  private async buildStopLimitUnitsBody(
    order: BrokerOrderV2,
  ): Promise<Record<string, unknown>> {
    if (order.stopPrice == null || !(order.stopPrice > 0)) {
      throw new AppError(
        "Alpaca stop_limit order requires a positive stopPrice.",
        "VALIDATION_FAILED",
      );
    }
    if (order.limitPrice == null || !(order.limitPrice > 0)) {
      throw new AppError(
        "Alpaca stop_limit order requires a positive limitPrice.",
        "VALIDATION_FAILED",
      );
    }
    if (order.quantity.kind !== "units" || !(order.quantity.value > 0)) {
      throw new AppError(
        "Alpaca stop_limit+units requires a positive units quantity.",
        "VALIDATION_FAILED",
      );
    }
    const instrumentType = order.instrument.instrumentClass;
    const base = {
      symbol: order.instrument.symbol,
      side: order.side.toLowerCase(),
      client_order_id: toAlpacaClientOrderId(order.clientOrderId),
      qty: String(order.quantity.value),
      type: "stop_limit",
      stop_price: String(roundToPenny(order.stopPrice)),
      limit_price: String(roundToPenny(order.limitPrice)),
      time_in_force: order.timeInForce,
    };

    if (instrumentType === "crypto") {
      return {
        ...base,
        time_in_force: order.timeInForce === "day" ? "gtc" : order.timeInForce,
      };
    }

    const session = getUsEquitySession(this.now());
    if (session === "regular") return base;
    throw new AppError(
      `Alpaca stop_limit orders require regular trading hours for ${order.instrument.symbol}; extended-hours stop_limit orders are not supported.`,
      "MARKET_CLOSED",
      { instrumentSymbol: order.instrument.symbol, instrumentType, session },
    );
  }

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
   * up.
   *
   * A market order that never reports a fill is a genuine broker error — a
   * trade with no entry price is worse than an error, since downstream PnL
   * would be meaningless. A limit/stop order that is still open after the
   * same poll window is not an error: it is legitimately resting at the
   * exchange (e.g. a non-marketable limit) and must not be reported as
   * failed. `restingFallbackPrice` (the order's limit/stop price) is only
   * used in that resting case, never for a canceled/rejected order.
   */
  private async resolveFilledAvgPrice(
    order: {
      id: string;
      filled_avg_price?: string;
      status?: string;
    },
    restingFallbackPrice?: number,
  ): Promise<number> {
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

    if (
      restingFallbackPrice != null &&
      restingFallbackPrice > 0 &&
      isOpenAlpacaOrderStatus(lastStatus)
    ) {
      logger.info(
        {
          brokerOrderId: order.id,
          status: lastStatus,
          restingFallbackPrice,
        },
        "alpaca placeOrder: order is resting unfilled; preserving it instead of failing",
      );
      return restingFallbackPrice;
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
    const httpEndpoint = `${method.toUpperCase()} ${path}`;
    const callType = inferAlpacaHttpCallType(
      method,
      path.split("?")[0] ?? path,
    );
    const startedAt = Date.now();
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
      this.interactionLogger?.log({
        callType,
        endpoint: httpEndpoint,
        latencyMs: Date.now() - startedAt,
        status: "error",
      });
      logger.error(
        { err, method, baseUrl, path },
        "alpaca request: network error",
      );
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.interactionLogger?.log({
        callType,
        endpoint: httpEndpoint,
        latencyMs: Date.now() - startedAt,
        status: "error",
      });
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

    this.interactionLogger?.log({
      callType,
      endpoint: httpEndpoint,
      latencyMs: Date.now() - startedAt,
      status: "ok",
    });

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
  const fields: Array<[string, string | undefined]> = [
    ["account.cash", account.cash],
    ["account.buying_power", account.buying_power],
    ["account.equity", account.equity],
    ["account.portfolio_value", account.portfolio_value],
  ];
  const parsed: number[] = [];
  for (const [field, value] of fields) {
    if (value == null || value === "") continue;
    parsed.push(requireFiniteNumber(value, field, { broker: "alpaca" }));
  }
  if (parsed.length === 0) {
    throw brokerDataError("Alpaca account response missing balance fields", {
      broker: "alpaca",
    });
  }
  return parsed.find((value) => value > 0) ?? parsed[0];
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

/** Alpaca order statuses that mean "still live, not yet filled" (i.e. resting). */
function isOpenAlpacaOrderStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s === "new" ||
    s === "accepted" ||
    s === "pending_new" ||
    s === "accepted_for_bidding" ||
    s === "held" ||
    s === "partially_filled"
  );
}

/**
 * Parse an OCC symbol (`<root><yymmdd><C|P><strike*1000 padded 8>`) into its
 * type, expiry, and strike. Returns null for anything that isn't an OCC symbol.
 */
function parseOccSymbol(
  symbol: string,
): { type: "call" | "put"; expiry: string; strike: number } | null {
  const match = /^[A-Z]+(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!match) return null;
  const [, yy, mm, dd, cp, strikeRaw] = match;
  return {
    type: cp === "C" ? "call" : "put",
    expiry: `20${yy}-${mm}-${dd}`,
    strike: Number(strikeRaw) / 1000,
  };
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

/** Decode an Alpaca websocket frame into JSON, or null if it isn't parseable JSON. */
function parseAlpacaStreamMessage(raw: unknown): unknown {
  const text =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : String(raw);
  return safeJsonParse(text, undefined, "alpaca-adapter.ws-message");
}

/**
 * Alpaca confirms the trade_updates stream in two steps: an `authorization`
 * message with `status: "authorized"`, then a `listening` confirmation once
 * the subscribe (`listen`) command is accepted. Either is proof the socket
 * is a real, authenticated Alpaca stream — a bad key gets `unauthorized`
 * (or the venue just closes the socket) instead of either message.
 */
function isAlpacaStreamAck(raw: unknown): boolean {
  const parsed = parseAlpacaStreamMessage(raw);
  if (!parsed || typeof parsed !== "object") return false;
  const msg = parsed as { stream?: string; data?: { status?: string } };
  if (msg.stream === "authorization" && msg.data?.status === "authorized") {
    return true;
  }
  return msg.stream === "listening";
}

function mapAlpacaTradeUpdate(raw: unknown): OrderEvent[] {
  const parsed = parseAlpacaStreamMessage(raw);
  if (!parsed || typeof parsed !== "object") return [];
  const msg = parsed as {
    stream?: string;
    data?: {
      event?: string;
      price?: string;
      qty?: string;
      timestamp?: string;
      order?: {
        id?: string;
        client_order_id?: string;
        filled_avg_price?: string;
        filled_qty?: string;
      };
    };
  };
  if (msg.stream !== "trade_updates" || !msg.data?.order?.id) return [];
  const event = (msg.data.event ?? "").toLowerCase();
  let kind: OrderEvent["kind"] | null = null;
  if (event === "fill") kind = "fill";
  else if (event === "partial_fill") kind = "partial_fill";
  else if (event === "canceled") kind = "canceled";
  else if (event === "expired") kind = "expired";
  else if (event === "rejected") kind = "rejected";
  else if (event === "new" || event === "accepted") kind = "accepted";
  if (!kind) return [];
  const orderId = msg.data.order.id;
  const filledAvgPriceRaw =
    msg.data.price ?? msg.data.order.filled_avg_price ?? undefined;
  const filledQtyRaw = msg.data.qty ?? msg.data.order.filled_qty ?? undefined;
  let filledAvgPrice: number | undefined;
  if (kind === "fill" || kind === "partial_fill") {
    filledAvgPrice = requirePositivePrice(
      filledAvgPriceRaw,
      "trade_update.filledAvgPrice",
      { broker: "alpaca", orderId },
    );
  } else if (filledAvgPriceRaw != null && filledAvgPriceRaw !== "") {
    const n = requireFiniteNumber(
      filledAvgPriceRaw,
      "trade_update.filledAvgPrice",
      { broker: "alpaca", orderId },
    );
    filledAvgPrice = n > 0 ? n : undefined;
  }
  let filledQty: number | undefined;
  if (filledQtyRaw != null && filledQtyRaw !== "") {
    const n = requireFiniteNumber(filledQtyRaw, "trade_update.filledQty", {
      broker: "alpaca",
      orderId,
    });
    filledQty = n > 0 ? n : undefined;
  }
  return [
    {
      brokerOrderId: orderId,
      clientOrderId: msg.data.order.client_order_id,
      kind,
      ts: msg.data.timestamp ?? new Date().toISOString(),
      filledAvgPrice,
      filledQty,
    },
  ];
}

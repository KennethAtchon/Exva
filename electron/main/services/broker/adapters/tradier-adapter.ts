import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../../infra/log";
import { requireJsonParse } from "../../infra/safe-json-parse";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import {
  brokerDataError,
  classifyHttpBrokerError,
  finiteOrZero,
  firstPositive,
  optionalPositivePrice,
  requireFiniteNumber,
  requirePositivePrice,
  softFinite,
} from "../broker-errors";
import {
  TRADIER_CAPABILITIES,
  adapterSupportsOrder,
  type BrokerOrderV2,
  type OrderEvent,
  type OrderEventFeed,
  type OrderLeg,
} from "../order-contract-v2";
import { createPollOrderEventFeed } from "../order-event-feed";
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

const logger = createLogger("tradier-adapter");

export interface TradierCredentials {
  accessToken: string;
  accountId: string;
}

const SANDBOX = "https://sandbox.tradier.com";
const PROD = "https://api.tradier.com";

const TIMEFRAME_MAP: Record<string, string> = {
  "15m": "15min",
  "30m": "30min",
  "1h": "1hour", // Tradier uses daily/weekly primarily; intraday via timesales
  "4h": "1hour",
  "1d": "daily",
};

/**
 * Tradier equities + options adapter (sandbox/prod). Supports single-leg and
 * two-leg vertical spreads via BrokerOrderV2.legs + supportsMultileg.
 */
export class TradierAdapter implements BrokerAdapter {
  readonly brokerType = "tradier";
  readonly supportedInstrumentClasses = [
    "stock",
    "options",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = true;
  readonly capabilities = TRADIER_CAPABILITIES;

  private readonly baseUrl: string;
  private readonly credentials: TradierCredentials;

  constructor(
    credentialsJson: string | TradierCredentials,
    private readonly mode: "paper" | "live" = "paper",
    private readonly interactionLogger?: BrokerInteractionLogger,
  ) {
    this.credentials =
      typeof credentialsJson === "string"
        ? requireJsonParse<TradierCredentials>(
            credentialsJson,
            undefined,
            "Invalid Tradier credentials JSON",
          )
        : credentialsJson;
    if (!this.credentials.accessToken || !this.credentials.accountId) {
      throw new AppError(
        "Tradier credentials require accessToken and accountId",
        "VALIDATION_FAILED",
      );
    }
    this.baseUrl = mode === "paper" ? SANDBOX : PROD;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const balance = await this.getAccountBalance();
      return {
        ok: true,
        message: `${this.mode === "paper" ? "Sandbox" : "Live"} Tradier account connected`,
        account_balance: balance,
      };
    } catch (error) {
      logger.error({ err: error }, "tradier testConnection failed");
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Tradier",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    const data = await this.requestJson<{
      balances?: {
        total_equity?: number;
        total_cash?: number;
        cash?: { cash_available?: number };
      };
    }>(
      "GET",
      `/v1/accounts/${encodeURIComponent(this.credentials.accountId)}/balances`,
    );
    const b = data.balances;
    const raw = b?.total_equity ?? b?.total_cash ?? b?.cash?.cash_available;
    return requireFiniteNumber(raw, "balances.total_equity", {
      broker: "tradier",
    });
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.requestJson<{
      positions?:
        | {
            position?: Array<{
              symbol?: string;
              quantity?: number;
              cost_basis?: number;
              date_acquired?: string;
            }>;
          }
        | "null"
        | null;
    }>(
      "GET",
      `/v1/accounts/${encodeURIComponent(this.credentials.accountId)}/positions`,
    );
    const raw = data.positions;
    if (!raw || raw === "null") return [];
    const list = Array.isArray(raw.position)
      ? raw.position
      : raw.position
        ? [raw.position]
        : [];
    return list.map((p) => {
      const symbol = p.symbol;
      if (!symbol) {
        throw brokerDataError("Tradier position missing symbol", {
          broker: "tradier",
        });
      }
      const qty = requireFiniteNumber(p.quantity, "position.quantity", {
        broker: "tradier",
        symbol,
      });
      const costBasis = requireFiniteNumber(
        p.cost_basis,
        "position.cost_basis",
        {
          broker: "tradier",
          symbol,
        },
      );
      return {
        instrumentSymbol: symbol,
        instrumentType: isOcc(symbol) ? "options" : "stock",
        side: qty >= 0 ? ("long" as const) : ("short" as const),
        sizeUsd: Math.abs(costBasis),
        unrealizedPnl: 0,
      };
    });
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    const data = await this.requestJson<{
      quotes?: {
        quote?: {
          symbol?: string;
          last?: number;
          bid?: number;
          ask?: number;
          volume?: number;
          description?: string;
        };
      };
    }>(
      "GET",
      `/v1/markets/quotes?symbols=${encodeURIComponent(instrumentSymbol)}`,
    );
    const q = data.quotes?.quote;
    const quote = Array.isArray(q) ? q[0] : q;
    if (!quote) {
      throw brokerDataError("Tradier quote response missing quote", {
        broker: "tradier",
        symbol: instrumentSymbol,
      });
    }
    const last = softFinite(quote.last);
    const bid = softFinite(quote.bid);
    const ask = softFinite(quote.ask);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number.NaN;
    const price = requirePositivePrice(
      firstPositive(last, mid, bid, ask),
      "quote.last",
      { broker: "tradier", symbol: instrumentSymbol },
    );
    return {
      instrumentSymbol,
      instrumentDisplayName: quote.description ?? null,
      price,
      bid: bid > 0 ? bid : undefined,
      ask: ask > 0 ? ask : undefined,
      volume: quote.volume,
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    return this.placeOrderV2({
      clientOrderId: order.clientOrderId,
      instrument: {
        symbol: order.instrumentSymbol,
        instrumentClass: order.instrumentType,
        displayName: order.instrumentDisplayName,
        predictionOutcome: order.predictionOutcome,
        metadataJson: order.instrumentMetadataJson,
      },
      side: order.side,
      quantity: { kind: "notional_usd", value: order.sizeUsd },
      orderType: "market",
      timeInForce: "day",
      bracket:
        order.stopLossPrice != null || order.takeProfitPrice != null
          ? {
              stopLossPrice: order.stopLossPrice,
              takeProfitPrice: order.takeProfitPrice,
            }
          : undefined,
    });
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) {
      throw new AppError(
        `Tradier rejects order: ${check.reason}`,
        "BROKER_REJECTED",
      );
    }

    if (order.legs && order.legs.length > 0) {
      return this.placeMultileg(order);
    }

    const isOption =
      order.instrument.instrumentClass === "options" ||
      isOcc(order.instrument.symbol);
    const qty = await this.resolveQty(order);
    const duration = mapTif(order.timeInForce);
    const type = mapOrderType(order.orderType);

    const fields: Record<string, string> = {
      class: isOption ? "option" : "equity",
      symbol: isOption
        ? underlyingFromOcc(order.instrument.symbol)
        : order.instrument.symbol,
      side: isOption
        ? order.side === "BUY"
          ? "buy_to_open"
          : "sell_to_close"
        : order.side === "BUY"
          ? "buy"
          : "sell",
      quantity: String(qty),
      type,
      duration,
      tag: order.clientOrderId.slice(0, 255),
    };
    if (isOption) {
      fields.option_symbol = order.instrument.symbol;
    }
    if (
      order.limitPrice != null &&
      (type === "limit" || type === "stop_limit")
    ) {
      fields.price = String(order.limitPrice);
    }
    if (order.stopPrice != null && (type === "stop" || type === "stop_limit")) {
      fields.stop = String(order.stopPrice);
    }

    const data = await this.requestForm<{
      order?: { id?: number; status?: string };
    }>(
      "POST",
      `/v1/accounts/${encodeURIComponent(this.credentials.accountId)}/orders`,
      fields,
    );
    const id = String(data.order?.id ?? "");
    if (!id) {
      throw new AppError("Tradier did not return an order id", "BROKER_ERROR");
    }
    const status = await this.getOrderStatus(id);
    const filledAvgPrice = requirePositivePrice(
      status.latestPrice ?? order.limitPrice,
      "order.filledAvgPrice",
      { broker: "tradier", orderId: id },
    );
    return {
      brokerOrderId: id,
      filledAvgPrice,
    };
  }

  /**
   * Two-leg vertical (or up to 4 legs) via class=multileg.
   * `limitPrice` is net debit (buy) / credit (sell); market when orderType=market.
   */
  async placeSpread(
    legs: OrderLeg[],
    netLimit: number | null,
    underlying: string,
    clientOrderId: string,
    duration: "day" | "gtc" = "day",
  ): Promise<BrokerOrderResult> {
    return this.placeMultileg({
      clientOrderId,
      instrument: {
        symbol: underlying,
        instrumentClass: "options",
      },
      side: "BUY",
      quantity: { kind: "units", value: legs[0]?.quantity ?? 1 },
      orderType: netLimit != null ? "limit" : "market",
      limitPrice: netLimit ?? undefined,
      timeInForce: duration,
      legs,
    });
  }

  private async placeMultileg(
    order: BrokerOrderV2,
  ): Promise<BrokerOrderResult> {
    const legs = order.legs ?? [];
    if (legs.length < 2 || legs.length > 4) {
      throw new AppError(
        "Tradier multileg requires 2–4 legs",
        "BROKER_REJECTED",
      );
    }
    const type =
      order.orderType === "market"
        ? "market"
        : order.side === "SELL"
          ? "credit"
          : "debit";
    const fields: Record<string, string> = {
      class: "multileg",
      symbol: order.instrument.symbol,
      type,
      duration: mapTif(order.timeInForce),
      tag: order.clientOrderId.slice(0, 255),
    };
    if (type !== "market" && order.limitPrice != null) {
      fields.price = String(Math.abs(order.limitPrice));
    }
    legs.forEach((leg, i) => {
      fields[`option_symbol[${i}]`] = leg.symbol;
      fields[`side[${i}]`] = mapOptionSide(leg);
      fields[`quantity[${i}]`] = String(leg.quantity);
    });

    const data = await this.requestForm<{
      order?: { id?: number };
    }>(
      "POST",
      `/v1/accounts/${encodeURIComponent(this.credentials.accountId)}/orders`,
      fields,
    );
    const id = String(data.order?.id ?? "");
    if (!id) {
      throw new AppError(
        "Tradier multileg did not return an order id",
        "BROKER_ERROR",
      );
    }
    const status = await this.getOrderStatus(id);
    const filledAvgPrice = requirePositivePrice(
      status.latestPrice ?? order.limitPrice,
      "order.filledAvgPrice",
      { broker: "tradier", orderId: id },
    );
    return {
      brokerOrderId: id,
      filledAvgPrice,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.requestForm(
      "DELETE",
      `/v1/accounts/${encodeURIComponent(this.credentials.accountId)}/orders/${encodeURIComponent(brokerOrderId)}`,
      {},
    );
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const data = await this.requestJson<{
      order?: {
        id?: number;
        status?: string;
        avg_fill_price?: number;
        last_fill_price?: number;
      };
    }>(
      "GET",
      `/v1/accounts/${encodeURIComponent(this.credentials.accountId)}/orders/${encodeURIComponent(orderId)}`,
    );
    const o = data.order ?? {};
    const statusRaw = (o.status ?? "").toLowerCase();
    const closed =
      statusRaw === "filled" ||
      statusRaw === "canceled" ||
      statusRaw === "cancelled" ||
      statusRaw === "expired" ||
      statusRaw === "rejected";
    const price = optionalPositivePrice(
      o.avg_fill_price ?? o.last_fill_price,
      "order.avg_fill_price",
      { orderId },
    );
    return {
      brokerOrderId: String(o.id ?? orderId),
      status: closed ? "closed" : statusRaw ? "open" : "unknown",
      latestPrice: price,
      realizedPnlUsd: null,
    };
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    const status = await this.getOrderStatus(orderId);
    if (status.status === "open") await this.cancelOrder(orderId);
    return {
      brokerOrderId: orderId,
      // Cancel-only close: OrderStatus.realizedPnlUsd is null → CloseResult needs 0.
      realizedPnlUsd: status.realizedPnlUsd ?? 0,
    };
  }

  async getOhlcv(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    barCount: number,
  ): Promise<OhlcvBar[]> {
    const interval = TIMEFRAME_MAP[timeframe] ?? "daily";
    if (interval === "daily" || timeframe === "1d" || timeframe === "1w") {
      const end = new Date();
      const start = new Date(
        end.getTime() - Math.max(barCount, 1) * 3 * 24 * 60 * 60 * 1000,
      );
      const params = new URLSearchParams({
        symbol: instrumentSymbol,
        interval: "daily",
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      });
      const data = await this.requestJson<{
        history?: {
          day?: Array<{
            date?: string;
            open?: number;
            high?: number;
            low?: number;
            close?: number;
            volume?: number;
          }>;
        };
      }>("GET", `/v1/markets/history?${params}`);
      const days = data.history?.day ?? [];
      const list = Array.isArray(days) ? days : [days];
      return list
        .slice(-barCount)
        .map((d) =>
          parseTradierOhlcvBar(
            d,
            d.date ? `${d.date}T00:00:00.000Z` : new Date().toISOString(),
          ),
        )
        .filter((bar): bar is OhlcvBar => bar != null);
    }

    // Intraday: use timesales aggregated roughly by sampling.
    const params = new URLSearchParams({
      symbol: instrumentSymbol,
      interval: "5min",
    });
    const data = await this.requestJson<{
      series?: {
        data?: Array<{
          time?: string;
          open?: number;
          high?: number;
          low?: number;
          close?: number;
          volume?: number;
        }>;
      };
    }>("GET", `/v1/markets/timesales?${params}`);
    const rows = data.series?.data ?? [];
    const list = Array.isArray(rows) ? rows : [rows];
    return list
      .slice(-barCount)
      .map((d) =>
        parseTradierOhlcvBar(d, d.time ?? new Date().toISOString()),
      )
      .filter((bar): bar is OhlcvBar => bar != null);
  }

  async getOptionChain(
    underlyingSymbol: string,
  ): Promise<OptionChainContract[]> {
    const expData = await this.requestJson<{
      expirations?: { date?: string[] | string };
    }>(
      "GET",
      `/v1/markets/options/expirations?symbol=${encodeURIComponent(underlyingSymbol)}`,
    );
    const datesRaw = expData.expirations?.date;
    const dates = Array.isArray(datesRaw)
      ? datesRaw
      : datesRaw
        ? [datesRaw]
        : [];
    const expiry = dates[0];
    if (!expiry) return [];

    const chain = await this.requestJson<{
      options?: {
        option?: Array<{
          symbol?: string;
          option_type?: string;
          strike?: number;
          expiration_date?: string;
          greeks?: { delta?: number; mid_iv?: number };
          open_interest?: number;
          volume?: number;
          bid?: number;
          ask?: number;
        }>;
      };
    }>(
      "GET",
      `/v1/markets/options/chains?symbol=${encodeURIComponent(underlyingSymbol)}&expiration=${encodeURIComponent(expiry)}&greeks=true`,
    );
    const opts = chain.options?.option ?? [];
    const list = Array.isArray(opts) ? opts : [opts];
    const contracts: OptionChainContract[] = [];
    for (const o of list) {
      if (!o.symbol) continue;
      const details = { broker: "tradier", symbol: o.symbol };
      try {
        contracts.push({
          symbol: o.symbol,
          type: o.option_type === "put" ? ("put" as const) : ("call" as const),
          strike: requirePositivePrice(o.strike, "option.strike", details),
          expiry: o.expiration_date ?? expiry,
          delta: o.greeks?.delta ?? null,
          impliedVolatility: o.greeks?.mid_iv ?? null,
          // Missing OI/volume defaults to 0 (valid; matches Alpaca chain posture).
          openInterest: finiteOrZero(
            o.open_interest,
            "option.open_interest",
            details,
          ),
          dayVolume: finiteOrZero(o.volume, "option.volume", details),
          bid: o.bid ?? null,
          ask: o.ask ?? null,
        });
      } catch {
        // Skip contracts with invalid strike rather than inventing 0.
      }
    }
    return contracts;
  }

  createOrderEventFeed(opts?: {
    onFallbackToPoll?: (reason: string) => void;
  }): OrderEventFeed {
    // Tradier account events are HTTP streaming; poll is the reliable path
    // TradeMonitor already understands. opts.onFallbackToPoll unused (already poll).
    void opts;
    const handlers = new Set<(event: OrderEvent) => void>();
    const poll = createPollOrderEventFeed(this, [], 5_000);
    return {
      async start() {
        await poll.start();
      },
      async stop() {
        await poll.stop();
        handlers.clear();
      },
      onEvent(handler) {
        handlers.add(handler);
        return poll.onEvent(handler);
      },
      watchOrders(orderIds) {
        poll.watchOrders?.(orderIds);
      },
    };
  }

  private async resolveQty(order: BrokerOrderV2): Promise<number> {
    if (order.quantity.kind === "units") {
      return Math.max(1, Math.floor(order.quantity.value));
    }
    const snap = await this.getMarketSnapshot(order.instrument.symbol);
    const price = snap.price;
    if (!(price > 0)) {
      throw new AppError(
        "Tradier notional order: no quotable price",
        "BROKER_ERROR",
      );
    }
    const isOption =
      order.instrument.instrumentClass === "options" ||
      isOcc(order.instrument.symbol);
    const perUnit = isOption ? price * 100 : price;
    return Math.max(1, Math.floor(order.quantity.value / perUnit));
  }

  private async requestJson<T>(method: string, path: string): Promise<T> {
    return this.fetchTradier<T>(method, path, undefined, "application/json");
  }

  private async requestForm<T>(
    method: string,
    path: string,
    fields: Record<string, string>,
  ): Promise<T> {
    const body = new URLSearchParams(fields).toString();
    return this.fetchTradier<T>(
      method,
      path,
      body,
      "application/x-www-form-urlencoded",
    );
  }

  private async fetchTradier<T>(
    method: string,
    path: string,
    body: string | undefined,
    contentType: string,
  ): Promise<T> {
    const startedAt = Date.now();
    const endpoint = `${method} ${path}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.credentials.accessToken}`,
          Accept: "application/json",
          ...(body != null ? { "Content-Type": contentType } : {}),
        },
        body,
      });
    } catch (err) {
      this.interactionLogger?.log({
        callType: "other",
        endpoint,
        latencyMs: Date.now() - startedAt,
        status: "error",
      });
      throw err;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.interactionLogger?.log({
        callType: "other",
        endpoint,
        latencyMs: Date.now() - startedAt,
        status: "error",
      });
      throw classifyHttpBrokerError({
        status: response.status,
        body: text,
        broker: "Tradier",
      });
    }
    this.interactionLogger?.log({
      callType: "other",
      endpoint,
      latencyMs: Date.now() - startedAt,
      status: "ok",
    });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function parseTradierOhlcvBar(
  d: {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  },
  ts: string,
): OhlcvBar | null {
  const details = { broker: "tradier" };
  try {
    return {
      ts,
      open: requirePositivePrice(d.open, "bar.open", details),
      high: requirePositivePrice(d.high, "bar.high", details),
      low: requirePositivePrice(d.low, "bar.low", details),
      close: requirePositivePrice(d.close, "bar.close", details),
      volume:
        d.volume == null
          ? null
          : requireFiniteNumber(d.volume, "bar.volume", details),
    };
  } catch {
    // Skip malformed bars rather than inventing zero prices.
    return null;
  }
}

/**
 * Tradier's `duration` only has `day`/`gtc`/`pre`/`post` — there is no
 * IOC/FOK on the venue. TRADIER_CAPABILITIES.timeInForce is restricted to
 * `["day", "gtc"]` so the policy gate rejects ioc/fok before they ever reach
 * here; this mapping only needs to cover the two duration values Tradier
 * actually accepts.
 */
function mapTif(tif: BrokerOrderV2["timeInForce"]): string {
  return tif === "gtc" ? "gtc" : "day";
}

function mapOrderType(t: BrokerOrderV2["orderType"]): string {
  if (t === "stop_limit") return "stop_limit";
  if (t === "stop") return "stop";
  if (t === "limit") return "limit";
  return "market";
}

function mapOptionSide(leg: OrderLeg): string {
  const open = leg.positionEffect !== "close";
  if (leg.side === "BUY") return open ? "buy_to_open" : "buy_to_close";
  return open ? "sell_to_open" : "sell_to_close";
}

function isOcc(symbol: string): boolean {
  return /\d{6}[CP]\d{8}$/.test(symbol);
}

function underlyingFromOcc(symbol: string): string {
  const m = /^([A-Z]+)\d{6}[CP]\d{8}$/.exec(symbol);
  return m?.[1] ?? symbol;
}

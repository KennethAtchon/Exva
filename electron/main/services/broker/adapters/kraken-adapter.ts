import { createHash, createHmac } from "node:crypto";
import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../../infra/log";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import { classifyHttpBrokerError, brokerError } from "../broker-errors";
import {
  GhostFillSimulator,
  type GhostQuote,
} from "../mock/ghost-fill-simulator";
import type { PaperBalancesRepo } from "../../../db/repositories/brokers/paper-balances-repo";
import {
  KRAKEN_CAPABILITIES,
  adapterSupportsOrder,
  type BrokerOrderV2,
  type OrderEvent,
  type OrderEventFeed,
} from "../order-contract-v2";
import { createStreamingOrderEventFeed } from "../streaming-order-event-feed";
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

const logger = createLogger("kraken-adapter");

export interface KrakenCredentials {
  apiKey: string;
  apiSecret: string;
}

export type KrakenAdapterOptions = {
  accountId?: string;
  paperBalances?: PaperBalancesRepo;
};

const REST = "https://api.kraken.com";
const WS_V2 = "wss://ws-auth.kraken.com/v2";

const OHLC_INTERVAL: Record<string, number> = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

export function toKrakenPair(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace("/", "").replace("-", "");
  if (s.endsWith("USD") || s.endsWith("USDT") || s.endsWith("USDC")) return s;
  return `${s}USD`;
}

/** Keyless public OHLC — usable without API keys. */
export async function fetchKrakenOhlcv(
  instrumentSymbol: string,
  timeframe: TradingTimeframe,
  barCount: number,
): Promise<OhlcvBar[]> {
  const pair = toKrakenPair(instrumentSymbol);
  const interval = OHLC_INTERVAL[timeframe] ?? 1440;
  const response = await fetch(
    `${REST}/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`,
  );
  if (!response.ok) {
    throw classifyHttpBrokerError({
      status: response.status,
      body: await response.text().catch(() => ""),
      broker: "Kraken",
    });
  }
  const data = (await response.json()) as {
    error?: string[];
    result?: Record<
      string,
      | Array<[number, string, string, string, string, string, string, number]>
      | string
    >;
  };
  if (data.error && data.error.length > 0) {
    throw brokerError("BROKER_ERROR", `Kraken OHLC: ${data.error.join("; ")}`);
  }
  const result = data.result ?? {};
  const key = Object.keys(result).find((k) => k !== "last");
  const rows = key ? result[key] : [];
  if (!Array.isArray(rows)) return [];
  return rows.slice(-barCount).map((r) => ({
    ts: new Date(r[0] * 1000).toISOString(),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[6]) || null,
  }));
}

/**
 * Kraken crypto adapter. Paper mode: AddOrder with validate=true + GhostFillSimulator.
 * Live mode: real AddOrder. Public OHLC needs no credentials.
 */
export class KrakenAdapter implements BrokerAdapter {
  readonly brokerType = "kraken";
  readonly supportedInstrumentClasses = [
    "crypto",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = true;
  readonly capabilities = KRAKEN_CAPABILITIES;

  private readonly credentials: KrakenCredentials;
  private readonly ghosts = new GhostFillSimulator();
  private nonce = Date.now() * 1000;
  private privateQueue: Promise<unknown> = Promise.resolve();
  /** clientOrderId → symbol for ghost poll re-checks */
  private readonly ghostSymbols = new Map<string, string>();
  private readonly accountId: string | undefined;
  private readonly paperBalances: PaperBalancesRepo | undefined;

  constructor(
    credentialsJson: string | KrakenCredentials,
    private readonly mode: "paper" | "live" = "paper",
    private readonly interactionLogger?: BrokerInteractionLogger,
    options?: KrakenAdapterOptions,
  ) {
    this.credentials =
      typeof credentialsJson === "string"
        ? (JSON.parse(credentialsJson) as KrakenCredentials)
        : credentialsJson;
    this.accountId = options?.accountId;
    this.paperBalances = options?.paperBalances;
    if (!this.credentials.apiKey || !this.credentials.apiSecret) {
      throw new AppError(
        "Kraken credentials require apiKey and apiSecret",
        "VALIDATION_FAILED",
      );
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const balance = await this.getAccountBalance();
      return {
        ok: true,
        message: `${this.mode === "paper" ? "Paper (validate-only + ghost fills)" : "Live"} Kraken account connected`,
        account_balance: balance,
      };
    } catch (error) {
      logger.error({ err: error }, "kraken testConnection failed");
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Kraken",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    if (this.mode === "paper" && this.paperBalances && this.accountId) {
      return this.paperBalances.getBalance(this.accountId);
    }
    const data = await this.privateRequest<{
      error?: string[];
      result?: Record<string, string>;
    }>("/0/private/Balance", {});
    this.assertNoError(data.error);
    const result = data.result ?? {};
    // Sum USD-ish balances; prefer ZUSD / USD / USDT.
    for (const key of ["ZUSD", "USD", "USDT", "USDC"]) {
      const v = Number(result[key] ?? 0);
      if (v > 0) return v;
    }
    return Object.values(result).reduce((sum, v) => sum + Number(v || 0), 0);
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.privateRequest<{
      error?: string[];
      result?: Record<string, string>;
    }>("/0/private/Balance", {});
    this.assertNoError(data.error);
    const result = data.result ?? {};
    const positions: BrokerPosition[] = [];
    for (const [asset, amount] of Object.entries(result)) {
      const qty = Number(amount);
      if (!(qty > 0) || asset === "ZUSD" || asset === "USD") continue;
      const symbol = toWirePair(asset);
      let price = 0;
      try {
        const snap = await this.getMarketSnapshot(symbol);
        price = snap.price;
      } catch {
        price = 0;
      }
      positions.push({
        instrumentSymbol: symbol,
        instrumentType: "crypto",
        side: "long",
        sizeUsd: qty * price,
        unrealizedPnl: 0,
      });
    }
    return positions;
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    const pair = toKrakenPair(instrumentSymbol);
    const data = await this.publicRequest<{
      error?: string[];
      result?: Record<
        string,
        { c?: string[]; b?: string[]; a?: string[]; v?: string[] }
      >;
    }>(`/0/public/Ticker?pair=${encodeURIComponent(pair)}`);
    this.assertNoError(data.error);
    const ticker = Object.values(data.result ?? {})[0];
    const last = Number(ticker?.c?.[0] ?? 0);
    const bid = Number(ticker?.b?.[0] ?? 0);
    const ask = Number(ticker?.a?.[0] ?? 0);
    return {
      instrumentSymbol,
      price: last || (bid && ask ? (bid + ask) / 2 : bid || ask),
      bid: bid || undefined,
      ask: ask || undefined,
      volume: Number(ticker?.v?.[1] ?? 0) || undefined,
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    return this.placeOrderV2({
      clientOrderId: order.clientOrderId,
      instrument: {
        symbol: order.instrumentSymbol,
        instrumentClass: "crypto",
        displayName: order.instrumentDisplayName,
        metadataJson: order.instrumentMetadataJson,
      },
      side: order.side,
      quantity: { kind: "notional_usd", value: order.sizeUsd },
      orderType: "market",
      timeInForce: "ioc",
    });
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) {
      throw new AppError(
        `Kraken rejects order: ${check.reason}`,
        "BROKER_REJECTED",
      );
    }

    const snapshot = await this.getMarketSnapshot(order.instrument.symbol);
    const quote: GhostQuote = {
      bid: snapshot.bid ?? snapshot.price,
      ask: snapshot.ask ?? snapshot.price,
      last: snapshot.price,
    };

    let volume: number;
    if (order.quantity.kind === "units") {
      volume = order.quantity.value;
    } else {
      const px = snapshot.price * (order.side === "BUY" ? 1.002 : 0.998);
      if (!(px > 0)) {
        throw new AppError(
          "Kraken notional order: no quotable price",
          "BROKER_ERROR",
        );
      }
      volume = order.quantity.value / px;
    }

    const pair = toKrakenPair(order.instrument.symbol);
    const ordertype =
      order.orderType === "stop"
        ? "stop-loss"
        : order.orderType === "limit"
          ? "limit"
          : "market";

    const payload: Record<string, string | boolean | number> = {
      pair,
      type: order.side === "BUY" ? "buy" : "sell",
      ordertype,
      volume: String(volume),
      cl_ord_id: order.clientOrderId.slice(0, 18),
    };
    if (order.timeInForce === "ioc") payload.timeinforce = "IOC";
    if (ordertype === "limit" && order.limitPrice != null) {
      payload.price = String(order.limitPrice);
    }
    if (ordertype === "stop-loss" && order.stopPrice != null) {
      payload.price = String(order.stopPrice);
    }

    if (this.mode === "paper") {
      payload.validate = true;
      const validated = await this.privateRequest<{
        error?: string[];
        result?: { descr?: { order?: string } };
      }>("/0/private/AddOrder", payload);
      // If validate rejects some shapes, still ghost-simulate (plan fallback).
      if (validated.error && validated.error.length > 0) {
        logger.warn(
          { error: validated.error },
          "kraken validate-only rejected; ghost-simulating without validate",
        );
      }
      const receipt = this.ghosts.simulateFill(order, quote);
      this.ghostSymbols.set(receipt.ghostOrderId, order.instrument.symbol);
      if (
        receipt.status === "filled" &&
        receipt.filledAvgPrice != null &&
        order.side === "BUY" &&
        this.paperBalances &&
        this.accountId
      ) {
        this.paperBalances.debit(
          this.accountId,
          receipt.filledQty * receipt.filledAvgPrice,
        );
      }
      return {
        brokerOrderId: receipt.ghostOrderId,
        filledAvgPrice: receipt.filledAvgPrice ?? 0,
        filledSizeUsd:
          receipt.filledAvgPrice != null
            ? receipt.filledQty * receipt.filledAvgPrice
            : undefined,
      };
    }

    const data = await this.privateRequest<{
      error?: string[];
      result?: { txid?: string[] };
    }>("/0/private/AddOrder", payload);
    this.assertNoError(data.error);
    const txid = data.result?.txid?.[0];
    if (!txid) {
      throw new AppError("Kraken AddOrder returned no txid", "BROKER_ERROR");
    }
    const status = await this.getOrderStatus(txid);
    return {
      brokerOrderId: txid,
      filledAvgPrice: status.latestPrice ?? snapshot.price,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    if (brokerOrderId.startsWith("ghost-")) {
      this.ghosts.cancel(brokerOrderId);
      return;
    }
    const data = await this.privateRequest<{ error?: string[] }>(
      "/0/private/CancelOrder",
      { txid: brokerOrderId },
    );
    this.assertNoError(data.error);
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    if (orderId.startsWith("ghost-")) {
      let receipt = this.ghosts.get(orderId);
      if (receipt?.status === "open") {
        const symbol = this.ghostSymbols.get(orderId);
        if (symbol) {
          try {
            const snap = await this.getMarketSnapshot(symbol);
            receipt =
              this.ghosts.poll(orderId, {
                bid: snap.bid ?? snap.price,
                ask: snap.ask ?? snap.price,
                last: snap.price,
              }) ?? receipt;
          } catch {
            /* keep open */
          }
        }
      }
      if (!receipt) {
        return {
          brokerOrderId: orderId,
          status: "unknown",
          latestPrice: null,
          realizedPnlUsd: null,
        };
      }
      return {
        brokerOrderId: orderId,
        status:
          receipt.status === "open"
            ? "open"
            : receipt.status === "filled" || receipt.status === "canceled"
              ? "closed"
              : "unknown",
        latestPrice: receipt.filledAvgPrice,
        realizedPnlUsd: null,
      };
    }

    const data = await this.privateRequest<{
      error?: string[];
      result?: {
        open?: Record<string, KrakenOrderRow>;
        closed?: Record<string, KrakenOrderRow>;
      };
    }>("/0/private/QueryOrders", { txid: orderId, trades: true });
    this.assertNoError(data.error);
    const row =
      data.result?.open?.[orderId] ?? data.result?.closed?.[orderId] ?? null;
    if (!row) {
      return {
        brokerOrderId: orderId,
        status: "unknown",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }
    const statusRaw = (row.status ?? "").toLowerCase();
    const closed =
      statusRaw === "closed" ||
      statusRaw === "canceled" ||
      statusRaw === "expired";
    return {
      brokerOrderId: orderId,
      status: closed ? "closed" : "open",
      latestPrice: Number(row.price ?? row.avg_price ?? 0) || null,
      realizedPnlUsd: null,
    };
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    const status = await this.getOrderStatus(orderId);
    if (status.status === "open") await this.cancelOrder(orderId);
    return {
      brokerOrderId: orderId,
      realizedPnlUsd: status.realizedPnlUsd ?? 0,
    };
  }

  async getOhlcv(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    barCount: number,
  ): Promise<OhlcvBar[]> {
    return fetchKrakenOhlcv(instrumentSymbol, timeframe, barCount);
  }

  createOrderEventFeed(opts?: {
    onFallbackToPoll?: (reason: string) => void;
  }): OrderEventFeed {
    // Private WS v2 needs a token from GetWebSocketsToken; fall back to poll
    // when token fetch fails. Paper/ghost orders are poll-driven.
    return createStreamingOrderEventFeed({
      url: WS_V2,
      adapter: this,
      pollIntervalMs: 5_000,
      onOpen: (socket) => {
        void (async () => {
          try {
            const data = await this.privateRequest<{
              error?: string[];
              result?: { token?: string };
            }>("/0/private/GetWebSocketsToken", {});
            this.assertNoError(data.error);
            const token = data.result?.token ?? null;
            if (!token) return;
            socket.send(
              JSON.stringify({
                method: "subscribe",
                params: {
                  channel: "executions",
                  token,
                  snap_orders: true,
                },
              }),
            );
          } catch (err) {
            logger.warn(
              { err },
              "kraken WS token failed; poll fallback will engage on close",
            );
            socket.close();
          }
        })();
      },
      mapMessage: (raw) => mapKrakenExecution(raw),
      isProtocolAck: (raw) => isKrakenSubscribeAck(raw),
      onFallbackToPoll: (reason) => {
        logger.warn({ reason }, "kraken order feed using poll fallback");
        opts?.onFallbackToPoll?.(reason);
      },
    });
  }

  private nextNonce(): string {
    this.nonce += 1;
    return String(this.nonce);
  }

  private assertNoError(error: string[] | undefined): void {
    if (!error || error.length === 0) return;
    const joined = error.join("; ");
    const lower = joined.toLowerCase();
    if (lower.includes("invalid key") || lower.includes("permission denied")) {
      throw brokerError("BROKER_AUTH", `Kraken auth failed: ${joined}`);
    }
    if (lower.includes("insufficient")) {
      throw brokerError(
        "BROKER_INSUFFICIENT_FUNDS",
        `Kraken insufficient funds: ${joined}`,
      );
    }
    if (lower.includes("unknown asset") || lower.includes("invalid pair")) {
      throw brokerError(
        "BROKER_UNKNOWN_SYMBOL",
        `Kraken unknown symbol: ${joined}`,
      );
    }
    throw brokerError("BROKER_ERROR", `Kraken error: ${joined}`);
  }

  private async publicRequest<T>(path: string): Promise<T> {
    const startedAt = Date.now();
    const response = await fetch(`${REST}${path}`);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.interactionLogger?.log({
        callType: "other",
        endpoint: `GET ${path}`,
        latencyMs: Date.now() - startedAt,
        status: "error",
      });
      throw classifyHttpBrokerError({
        status: response.status,
        body: text,
        broker: "Kraken",
      });
    }
    this.interactionLogger?.log({
      callType: "other",
      endpoint: `GET ${path}`,
      latencyMs: Date.now() - startedAt,
      status: "ok",
    });
    return (await response.json()) as T;
  }

  private async privateRequest<T>(
    path: string,
    data: Record<string, string | boolean | number>,
  ): Promise<T> {
    // Serialize private calls so nonces stay monotonic.
    const run = async (): Promise<T> => {
      const nonce = this.nextNonce();
      const body: Record<string, string> = {
        nonce,
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)]),
        ),
      };
      const encoded = new URLSearchParams(body).toString();
      const hash = createHash("sha256")
        .update(nonce + encoded)
        .digest();
      const secret = Buffer.from(this.credentials.apiSecret, "base64");
      const hmac = createHmac("sha512", secret);
      hmac.update(path);
      hmac.update(hash);
      const signature = hmac.digest("base64");

      const startedAt = Date.now();
      const response = await fetch(`${REST}${path}`, {
        method: "POST",
        headers: {
          "API-Key": this.credentials.apiKey,
          "API-Sign": signature,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: encoded,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.interactionLogger?.log({
          callType: "other",
          endpoint: `POST ${path}`,
          latencyMs: Date.now() - startedAt,
          status: "error",
        });
        throw classifyHttpBrokerError({
          status: response.status,
          body: text,
          broker: "Kraken",
        });
      }
      this.interactionLogger?.log({
        callType: "other",
        endpoint: `POST ${path}`,
        latencyMs: Date.now() - startedAt,
        status: "ok",
      });
      return (await response.json()) as T;
    };

    // Chain onto queue without dropping errors from prior calls.
    const next = this.privateQueue.then(run, run);
    this.privateQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

interface KrakenOrderRow {
  status?: string;
  price?: string;
  avg_price?: string;
}

function toWirePair(asset: string): string {
  const base = asset.replace(/^X/, "").replace(/^Z/, "");
  if (base === "USD" || base === "USDT" || base === "USDC") return base;
  return `${base}/USD`;
}

/** Decode a Kraken websocket frame into JSON, or null if it isn't parseable JSON. */
function parseKrakenMessage(raw: unknown): unknown {
  const text =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : String(raw);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Kraken v2 confirms `{"method":"subscribe",...}` with
 * `{"method":"subscribe","success":true,...}`; a bad/expired token gets
 * `success:false` with an `error` field instead, so only `success:true`
 * proves the executions channel is actually live.
 */
function isKrakenSubscribeAck(raw: unknown): boolean {
  const parsed = parseKrakenMessage(raw);
  if (!parsed || typeof parsed !== "object") return false;
  const msg = parsed as { method?: string; success?: boolean };
  return msg.method === "subscribe" && msg.success === true;
}

function mapKrakenExecution(raw: unknown): OrderEvent[] {
  const parsed = parseKrakenMessage(raw);
  if (!parsed || typeof parsed !== "object") return [];
  const msg = parsed as {
    channel?: string;
    type?: string;
    data?: Array<{
      order_id?: string;
      cl_ord_id?: string;
      exec_type?: string;
      avg_price?: number;
      last_qty?: number;
      timestamp?: string;
    }>;
  };
  if (msg.channel !== "executions" || !Array.isArray(msg.data)) return [];
  const events: OrderEvent[] = [];
  for (const row of msg.data) {
    const exec = (row.exec_type ?? "").toLowerCase();
    let kind: OrderEvent["kind"] | null = null;
    if (exec === "filled" || exec === "trade") kind = "fill";
    else if (exec === "canceled") kind = "canceled";
    else if (exec === "expired") kind = "expired";
    else if (exec === "rejected") kind = "rejected";
    else if (exec === "new" || exec === "pending_new") kind = "accepted";
    else if (exec === "partial_fill" || exec === "partial")
      kind = "partial_fill";
    if (!kind || !row.order_id) continue;
    events.push({
      brokerOrderId: row.order_id,
      clientOrderId: row.cl_ord_id,
      kind,
      ts: row.timestamp ?? new Date().toISOString(),
      filledAvgPrice: row.avg_price,
      filledQty: row.last_qty,
    });
  }
  return events;
}

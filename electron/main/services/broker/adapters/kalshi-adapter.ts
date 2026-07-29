import { createSign, constants as cryptoConstants } from "node:crypto";
import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../../infra/log";
import { requireJsonParse, safeJsonParse } from "../../infra/safe-json-parse";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import {
  brokerDataError,
  classifyHttpBrokerError,
  firstPositive,
  optionalFiniteNumber,
  optionalPositivePrice,
  requireFiniteNumber,
  requirePositivePrice,
} from "../broker-errors";
import {
  KALSHI_CAPABILITIES,
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
  OrderStatus,
} from "./broker-adapter";

const logger = createLogger("kalshi-adapter");

export interface KalshiCredentials {
  keyId: string;
  /** RSA private key PEM (PKCS#8 or PKCS#1). */
  privateKeyPem: string;
}

const DEMO_REST = "https://external-api.demo.kalshi.co";
const PROD_REST = "https://external-api.kalshi.com";
const DEMO_WS = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2";
const PROD_WS = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";

function signKalshiRequest(
  privateKeyPem: string,
  timestampMs: string,
  method: string,
  pathWithQuery: string,
): string {
  const path = pathWithQuery.split("?")[0] ?? pathWithQuery;
  const msg = `${timestampMs}${method.toUpperCase()}${path}`;
  const sign = createSign("RSA-SHA256");
  sign.update(msg);
  sign.end();
  return sign
    .sign({
      key: privateKeyPem,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
}

function fpCount(n: number): string {
  return n.toFixed(2);
}

function fpDollars(n: number): string {
  return n.toFixed(4);
}

function centsToDollars(
  cents: unknown,
  field: string,
  details?: Record<string, unknown>,
): number {
  return requireFiniteNumber(cents, field, details) / 100;
}

/** Prefer dollar FP string; fall back to cents. Absent both → NaN. */
function dollarsOrCents(
  dollars: string | number | undefined | null,
  cents: number | undefined | null,
  dollarsField: string,
  centsField: string,
  details?: Record<string, unknown>,
): number {
  const fromDollars = optionalFiniteNumber(dollars, dollarsField, details);
  if (fromDollars != null) return fromDollars;
  if (cents != null) return centsToDollars(cents, centsField, details);
  return Number.NaN;
}

/**
 * Full Kalshi event-contract adapter (demo/prod). Uses Create Order V2
 * (`POST /trade-api/v2/portfolio/events/orders`) with RSA-PSS auth.
 */
export class KalshiAdapter implements BrokerAdapter {
  readonly brokerType = "kalshi";
  readonly supportedInstrumentClasses = [
    "prediction_market",
  ] as const satisfies readonly InstrumentClass[];
  readonly launchCapable = true;
  readonly capabilities = KALSHI_CAPABILITIES;

  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly credentials: KalshiCredentials;

  constructor(
    credentialsJson: string | KalshiCredentials,
    private readonly mode: "paper" | "live" = "paper",
    private readonly interactionLogger?: BrokerInteractionLogger,
  ) {
    this.credentials =
      typeof credentialsJson === "string"
        ? requireJsonParse<KalshiCredentials>(
            credentialsJson,
            undefined,
            "Invalid Kalshi credentials JSON",
          )
        : credentialsJson;
    if (!this.credentials.keyId || !this.credentials.privateKeyPem) {
      throw new AppError(
        "Kalshi credentials require keyId and privateKeyPem",
        "VALIDATION_FAILED",
      );
    }
    this.baseUrl = mode === "paper" ? DEMO_REST : PROD_REST;
    this.wsUrl = mode === "paper" ? DEMO_WS : PROD_WS;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const balance = await this.getAccountBalance();
      return {
        ok: true,
        message: `${this.mode === "paper" ? "Demo" : "Live"} Kalshi account connected`,
        account_balance: balance,
      };
    } catch (error) {
      logger.error({ err: error }, "kalshi testConnection failed");
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Kalshi",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    const data = await this.request<{
      balance?: number;
      portfolio_value?: number;
    }>("GET", "/trade-api/v2/portfolio/balance");
    // Kalshi returns cents. Explicit 0 is valid; absent fields are not.
    const centsRaw = data.balance ?? data.portfolio_value;
    if (centsRaw === undefined || centsRaw === null) {
      throw brokerDataError("Kalshi balance response missing balance fields", {
        broker: "kalshi",
      });
    }
    return centsToDollars(centsRaw, "balance", { broker: "kalshi" });
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.request<{
      market_positions?: Array<{
        ticker?: string;
        position_fp?: string;
        position?: number;
        market_exposure?: number;
        realized_pnl?: number;
        total_traded?: number;
      }>;
    }>("GET", "/trade-api/v2/portfolio/positions");
    const rows = data.market_positions ?? [];
    return rows
      .map((row) => {
        const symbol = row.ticker;
        if (!symbol) return null;
        const qtyRaw = row.position_fp ?? row.position;
        if (qtyRaw === undefined || qtyRaw === null || qtyRaw === "") {
          return null;
        }
        const qty = requireFiniteNumber(qtyRaw, "position.qty", {
          broker: "kalshi",
          symbol,
        });
        if (qty === 0) return null;
        const position: BrokerPosition = {
          instrumentSymbol: symbol,
          instrumentType: "prediction_market",
          side: qty > 0 ? "long" : "short",
          sizeUsd: Math.abs(
            centsToDollars(row.market_exposure, "position.market_exposure", {
              broker: "kalshi",
              symbol,
            }),
          ),
          unrealizedPnl: centsToDollars(
            row.realized_pnl,
            "position.realized_pnl",
            { broker: "kalshi", symbol },
          ),
        };
        return position;
      })
      .filter((p): p is BrokerPosition => p != null);
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    const data = await this.request<{
      market?: {
        ticker?: string;
        title?: string;
        yes_bid_dollars?: string;
        yes_ask_dollars?: string;
        last_price_dollars?: string;
        yes_bid?: number;
        yes_ask?: number;
        last_price?: number;
        volume?: number;
      };
    }>("GET", `/trade-api/v2/markets/${encodeURIComponent(instrumentSymbol)}`);
    const m = data.market;
    if (!m) {
      throw brokerDataError("Kalshi market response missing market", {
        broker: "kalshi",
        symbol: instrumentSymbol,
      });
    }
    const details = { broker: "kalshi", symbol: instrumentSymbol };
    const bid = dollarsOrCents(
      m.yes_bid_dollars,
      m.yes_bid,
      "market.yes_bid_dollars",
      "market.yes_bid",
      details,
    );
    const ask = dollarsOrCents(
      m.yes_ask_dollars,
      m.yes_ask,
      "market.yes_ask_dollars",
      "market.yes_ask",
      details,
    );
    const last = dollarsOrCents(
      m.last_price_dollars,
      m.last_price,
      "market.last_price_dollars",
      "market.last_price",
      details,
    );
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number.NaN;
    const price = requirePositivePrice(
      firstPositive(last, mid, bid, ask),
      "market.price",
      details,
    );
    return {
      instrumentSymbol,
      instrumentDisplayName: m.title ?? null,
      price,
      bid: bid > 0 ? bid : undefined,
      ask: ask > 0 ? ask : undefined,
      spreadPct: bid > 0 && ask > 0 ? ((ask - bid) / price) * 100 : undefined,
      volume: m.volume,
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    const snapshot = await this.getMarketSnapshot(order.instrumentSymbol);
    const price = snapshot.ask ?? snapshot.price;
    if (!(price > 0)) {
      throw new AppError(
        "Kalshi placeOrder: no quotable price to size against",
        "BROKER_ERROR",
      );
    }
    const count = Math.max(1, Math.floor(order.sizeUsd / price));
    return this.placeOrderV2({
      clientOrderId: order.clientOrderId,
      instrument: {
        symbol: order.instrumentSymbol,
        instrumentClass: "prediction_market",
        displayName: order.instrumentDisplayName,
        predictionOutcome: order.predictionOutcome,
        metadataJson: order.instrumentMetadataJson,
      },
      side: order.side,
      quantity: { kind: "units", value: count },
      orderType: "market",
      timeInForce: "ioc",
    });
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) {
      throw new AppError(
        `Kalshi rejects order: ${check.reason}`,
        "BROKER_REJECTED",
      );
    }
    if (order.quantity.kind !== "units") {
      throw new AppError(
        "Kalshi only accepts units (contract count); notional_usd is refused by capabilities",
        "BROKER_REJECTED",
      );
    }

    const snapshot = await this.getMarketSnapshot(order.instrument.symbol);
    let price = order.limitPrice;
    if (order.orderType === "market" || price == null) {
      // V2 API always requires a price — marketable limit for "market".
      const slip = order.side === "BUY" ? 1.02 : 0.98;
      const touch =
        order.side === "BUY"
          ? (snapshot.ask ?? snapshot.price)
          : (snapshot.bid ?? snapshot.price);
      price = Math.min(0.99, Math.max(0.01, touch * slip));
    }

    const tif =
      order.timeInForce === "fok"
        ? "fill_or_kill"
        : order.timeInForce === "ioc"
          ? "immediate_or_cancel"
          : "good_till_canceled";

    const body = {
      ticker: order.instrument.symbol,
      client_order_id: order.clientOrderId,
      // bid = buy YES, ask = sell YES
      side: order.side === "BUY" ? "bid" : "ask",
      count: fpCount(order.quantity.value),
      price: fpDollars(price),
      time_in_force: tif,
      self_trade_prevention_type: "taker_at_cross",
    };

    const data = await this.request<{
      order_id?: string;
      fill_count?: string;
      remaining_count?: string;
      average_fill_price?: string;
    }>("POST", "/trade-api/v2/portfolio/events/orders", body);

    const fillCount =
      optionalFiniteNumber(data.fill_count, "order.fill_count", {
        broker: "kalshi",
      }) ?? 0;
    if (fillCount <= 0) {
      return {
        brokerOrderId: data.order_id ?? order.clientOrderId,
        // Unfilled: BrokerOrderResult requires a number; 0 means no fill.
        filledAvgPrice: 0,
      };
    }
    const avgRaw = data.average_fill_price;
    const hasAvg = avgRaw != null && avgRaw !== "";
    const avg = requirePositivePrice(
      hasAvg ? avgRaw : price,
      hasAvg ? "order.average_fill_price" : "order.limit_price",
      { broker: "kalshi" },
    );
    return {
      brokerOrderId: data.order_id ?? order.clientOrderId,
      filledAvgPrice: avg,
      filledSizeUsd: fillCount * avg,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/trade-api/v2/portfolio/orders/${encodeURIComponent(brokerOrderId)}`,
    );
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    if (orderId.startsWith("ghost-")) {
      return {
        brokerOrderId: orderId,
        status: "unknown",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }
    const data = await this.request<{
      order?: {
        order_id?: string;
        status?: string;
        yes_price_dollars?: string;
        average_fill_price?: string;
        fill_count_fp?: string;
        remaining_count_fp?: string;
      };
    }>("GET", `/trade-api/v2/portfolio/orders/${encodeURIComponent(orderId)}`);
    const o = data.order ?? {};
    const statusRaw = (o.status ?? "").toLowerCase();
    const closed =
      statusRaw === "executed" ||
      statusRaw === "canceled" ||
      statusRaw === "cancelled";
    const price = optionalPositivePrice(
      o.average_fill_price ?? o.yes_price_dollars,
      "order.average_fill_price",
      { broker: "kalshi", orderId },
    );
    return {
      brokerOrderId: o.order_id ?? orderId,
      status: closed ? "closed" : statusRaw ? "open" : "unknown",
      latestPrice: price,
      realizedPnlUsd: null,
    };
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    const status = await this.getOrderStatus(orderId);
    if (status.status === "open") {
      await this.cancelOrder(orderId);
    }
    return {
      brokerOrderId: orderId,
      // Cancel-only close: OrderStatus.realizedPnlUsd is null → CloseResult needs 0.
      realizedPnlUsd: status.realizedPnlUsd ?? 0,
    };
  }

  createOrderEventFeed(opts?: {
    onFallbackToPoll?: (reason: string) => void;
  }): OrderEventFeed {
    const path = "/trade-api/ws/v2";
    const timestamp = String(Date.now());
    const signature = signKalshiRequest(
      this.credentials.privateKeyPem,
      timestamp,
      "GET",
      path,
    );
    return createStreamingOrderEventFeed({
      url: this.wsUrl,
      headers: {
        "KALSHI-ACCESS-KEY": this.credentials.keyId,
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
        "KALSHI-ACCESS-SIGNATURE": signature,
      },
      adapter: this,
      pollIntervalMs: 5_000,
      onOpen: (socket) => {
        socket.send(
          JSON.stringify({
            id: 1,
            cmd: "subscribe",
            params: { channels: ["fill"] },
          }),
        );
      },
      mapMessage: (raw) => mapKalshiFillMessage(raw),
      isProtocolAck: (raw) => isKalshiSubscribedAck(raw),
      onFallbackToPoll: (reason) => {
        logger.warn({ reason }, "kalshi order feed using poll fallback");
        opts?.onFallbackToPoll?.(reason);
      },
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const timestamp = String(Date.now());
    const signature = signKalshiRequest(
      this.credentials.privateKeyPem,
      timestamp,
      method,
      path,
    );
    const startedAt = Date.now();
    const endpoint = `${method} ${path}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "KALSHI-ACCESS-KEY": this.credentials.keyId,
          "KALSHI-ACCESS-TIMESTAMP": timestamp,
          "KALSHI-ACCESS-SIGNATURE": signature,
        },
        body: body != null ? JSON.stringify(body) : undefined,
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
        broker: "Kalshi",
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

/** Decode a Kalshi websocket frame into JSON, or null if it isn't parseable JSON. */
function parseKalshiMessage(raw: unknown): unknown {
  const text =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Array.isArray(raw)
          ? Buffer.concat(raw as Buffer[]).toString("utf8")
          : raw instanceof ArrayBuffer
            ? new TextDecoder().decode(raw)
            : String(raw);
  return safeJsonParse(text, undefined, "kalshi-adapter.ws-message");
}

/**
 * Kalshi confirms a `subscribe` command with `{"type":"subscribed",...}`; a
 * bad signature or rejected channel gets `{"type":"error",...}` instead (or
 * the socket never sends a confirmation at all), so only "subscribed" proves
 * the fill channel is actually live.
 */
function isKalshiSubscribedAck(raw: unknown): boolean {
  const parsed = parseKalshiMessage(raw);
  if (!parsed || typeof parsed !== "object") return false;
  return (parsed as { type?: string }).type === "subscribed";
}

function mapKalshiFillMessage(raw: unknown): OrderEvent[] {
  const parsed = parseKalshiMessage(raw);
  if (!parsed || typeof parsed !== "object") return [];
  const msg = parsed as {
    type?: string;
    msg?: {
      order_id?: string;
      client_order_id?: string;
      yes_price_dollars?: string;
      count_fp?: string;
      ts_ms?: number;
    };
  };
  if (msg.type !== "fill" || !msg.msg?.order_id) return [];
  const details = { broker: "kalshi", orderId: msg.msg.order_id };
  const price = optionalFiniteNumber(
    msg.msg.yes_price_dollars,
    "fill.yes_price_dollars",
    details,
  );
  const qty = optionalFiniteNumber(msg.msg.count_fp, "fill.count_fp", details);
  return [
    {
      brokerOrderId: msg.msg.order_id,
      clientOrderId: msg.msg.client_order_id,
      kind: "fill",
      ts: new Date(msg.msg.ts_ms ?? Date.now()).toISOString(),
      filledAvgPrice: price != null && price > 0 ? price : undefined,
      filledQty: qty != null && qty > 0 ? qty : undefined,
    },
  ];
}

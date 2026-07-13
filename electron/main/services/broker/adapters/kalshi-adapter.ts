import { createSign, constants as cryptoConstants } from "node:crypto";
import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../../infra/log";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import { classifyHttpBrokerError } from "../broker-errors";
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

function parseFp(value: string | number | undefined | null): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
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
        ? (JSON.parse(credentialsJson) as KalshiCredentials)
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
    // Kalshi returns cents.
    const cents = data.balance ?? data.portfolio_value ?? 0;
    return cents / 100;
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
        const qty = parseFp(row.position_fp ?? row.position);
        if (qty === 0) return null;
        const position: BrokerPosition = {
          instrumentSymbol: row.ticker ?? "",
          instrumentType: "prediction_market",
          side: qty > 0 ? "long" : "short",
          sizeUsd: Math.abs(row.market_exposure ?? 0) / 100,
          unrealizedPnl: (row.realized_pnl ?? 0) / 100,
        };
        return position;
      })
      .filter(
        (p): p is BrokerPosition => p != null && p.instrumentSymbol !== "",
      );
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
    const m = data.market ?? {};
    const bid =
      parseFp(m.yes_bid_dollars) || (m.yes_bid != null ? m.yes_bid / 100 : 0);
    const ask =
      parseFp(m.yes_ask_dollars) || (m.yes_ask != null ? m.yes_ask / 100 : 0);
    const last =
      parseFp(m.last_price_dollars) ||
      (m.last_price != null ? m.last_price / 100 : 0) ||
      (bid && ask ? (bid + ask) / 2 : bid || ask);
    const mid = bid && ask ? (bid + ask) / 2 : last;
    return {
      instrumentSymbol,
      instrumentDisplayName: m.title ?? null,
      price: mid,
      bid: bid || undefined,
      ask: ask || undefined,
      spreadPct: bid && ask && mid > 0 ? ((ask - bid) / mid) * 100 : undefined,
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

    const fillCount = parseFp(data.fill_count);
    const avg = parseFp(data.average_fill_price) || price;
    return {
      brokerOrderId: data.order_id ?? order.clientOrderId,
      filledAvgPrice: fillCount > 0 ? avg : 0,
      filledSizeUsd: fillCount > 0 ? fillCount * avg : undefined,
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
    const price =
      parseFp(o.average_fill_price) || parseFp(o.yes_price_dollars) || null;
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

function mapKalshiFillMessage(raw: unknown): OrderEvent[] {
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
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
  return [
    {
      brokerOrderId: msg.msg.order_id,
      clientOrderId: msg.msg.client_order_id,
      kind: "fill",
      ts: new Date(msg.msg.ts_ms ?? Date.now()).toISOString(),
      filledAvgPrice: parseFp(msg.msg.yes_price_dollars) || undefined,
      filledQty: parseFp(msg.msg.count_fp) || undefined,
    },
  ];
}

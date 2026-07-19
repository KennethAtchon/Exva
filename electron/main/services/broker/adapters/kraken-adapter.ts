import { createHash, createHmac } from "node:crypto";
import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import { AppError } from "@electron/shared/infra/errors";
import { createLogger } from "../../infra/log";
import { requireJsonParse, safeJsonParse } from "../../infra/safe-json-parse";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import {
  classifyHttpBrokerError,
  brokerError,
  brokerDataError,
  firstPositive,
  optionalFiniteNumber,
  optionalFiniteOrNaN,
  optionalPositivePrice,
  requireFiniteNumber,
  requirePositivePrice,
} from "../broker-errors";
import {
  GhostFillSimulator,
  type GhostQuote,
} from "../mock/ghost-fill-simulator";
import {
  DEFAULT_PAPER_STARTING_BALANCE_USD,
  type PaperBalancesRepo,
} from "../../../db/repositories/brokers/paper-balances-repo";
import type { PaperPositionsRepo } from "../../../db/repositories/brokers/paper-positions-repo";
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
  /**
   * Persisted ghost position store. When set alongside `accountId`, ghost
   * positions survive an adapter rebuild (app restart): a ghost order id
   * absent from the in-memory map is rehydrated from this repo instead of
   * being treated as unknown, and `getPositions` reflects persisted state.
   */
  paperPositions?: PaperPositionsRepo;
  /** Starting balance when no persisted row yet (tests / ephemeral). */
  startingPaperBalanceUsd?: number;
};

/** Filled (or resting) ghost position keyed by ghost order id. */
type GhostPosition = {
  symbol: string;
  side: "BUY" | "SELL";
  sizeUsd: number;
  shares: number;
  entryPrice: number;
  /** Position still open (not closed). */
  open: boolean;
  /** Order still resting in GhostFillSimulator (not filled yet). */
  resting: boolean;
  /** Original order, kept to re-seed GhostFillSimulator after a restart. */
  order: BrokerOrderV2;
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
  return rows
    .slice(-barCount)
    .map((r) => parseKrakenOhlcvBar(r))
    .filter((bar): bar is OhlcvBar => bar != null);
}

function parseKrakenOhlcvBar(
  r: [number, string, string, string, string, string, string, number],
): OhlcvBar | null {
  const details = { broker: "kraken" };
  try {
    return {
      ts: new Date(r[0] * 1000).toISOString(),
      open: requirePositivePrice(r[1], "ohlc.open", details),
      high: requirePositivePrice(r[2], "ohlc.high", details),
      low: requirePositivePrice(r[3], "ohlc.low", details),
      close: requirePositivePrice(r[4], "ohlc.close", details),
      volume: optionalFiniteNumber(r[6], "ohlc.volume", details),
    };
  } catch {
    // Skip malformed bars rather than inventing zero prices.
    return null;
  }
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
  /** Ghost order id → position, filled or resting. */
  private readonly ghostPositions = new Map<string, GhostPosition>();
  /** In-memory fallback when PaperBalancesRepo is not injected (unit tests). */
  private memoryPaperBalanceUsd: number;
  private readonly accountId: string | undefined;
  private readonly paperBalances: PaperBalancesRepo | undefined;
  private readonly paperPositions: PaperPositionsRepo | undefined;

  constructor(
    credentialsJson: string | KrakenCredentials,
    private readonly mode: "paper" | "live" = "paper",
    private readonly interactionLogger?: BrokerInteractionLogger,
    options?: KrakenAdapterOptions,
  ) {
    this.credentials =
      typeof credentialsJson === "string"
        ? requireJsonParse<KrakenCredentials>(
            credentialsJson,
            undefined,
            "Invalid Kraken credentials JSON",
          )
        : credentialsJson;
    this.accountId = options?.accountId;
    this.paperBalances = options?.paperBalances;
    this.paperPositions = options?.paperPositions;
    this.memoryPaperBalanceUsd =
      options?.startingPaperBalanceUsd ?? DEFAULT_PAPER_STARTING_BALANCE_USD;
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
    if (this.mode === "paper") return this.readPaperBalance();
    const data = await this.privateRequest<{
      error?: string[];
      result?: Record<string, string>;
    }>("/0/private/Balance", {});
    this.assertNoError(data.error);
    const result = data.result ?? {};
    // Sum USD-ish balances; prefer ZUSD / USD / USDT.
    for (const key of ["ZUSD", "USD", "USDT", "USDC"]) {
      if (!(key in result)) continue;
      const v = requireFiniteNumber(result[key], `balance.${key}`, {
        broker: "kraken",
      });
      if (v > 0) return v;
    }
    const entries = Object.entries(result);
    if (entries.length === 0) {
      throw brokerDataError("Kraken balance response empty", {
        broker: "kraken",
      });
    }
    return entries.reduce(
      (sum, [key, value]) =>
        sum +
        requireFiniteNumber(value, `balance.${key}`, { broker: "kraken" }),
      0,
    );
  }

  async getPositions(): Promise<BrokerPosition[]> {
    if (this.mode === "paper") return this.getGhostPositions();
    const data = await this.privateRequest<{
      error?: string[];
      result?: Record<string, string>;
    }>("/0/private/Balance", {});
    this.assertNoError(data.error);
    const result = data.result ?? {};
    const positions: BrokerPosition[] = [];
    for (const [asset, amount] of Object.entries(result)) {
      const qty = requireFiniteNumber(amount, `balance.${asset}`, {
        broker: "kraken",
      });
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

  /**
   * Ghost positions: merge persisted rows (survives restart) with in-memory
   * state, then mark-to-market each filled (non-resting) position against a
   * fresh quote.
   */
  private async getGhostPositions(): Promise<BrokerPosition[]> {
    if (this.paperPositions && this.accountId) {
      for (const row of this.paperPositions.listOpenByAccount(this.accountId)) {
        if (!this.ghostPositions.has(row.brokerOrderId)) {
          this.rehydrateGhostPosition(row.brokerOrderId);
        }
      }
    }
    const positions: BrokerPosition[] = [];
    for (const pos of this.ghostPositions.values()) {
      if (!pos.open || pos.resting) continue;
      let price = pos.entryPrice;
      try {
        const snap = await this.getMarketSnapshot(pos.symbol);
        price = snap.price;
      } catch {
        /* mark at entry price when the venue is unreachable */
      }
      const marketValue = pos.shares * price;
      const unrealizedPnl =
        pos.side === "BUY"
          ? marketValue - pos.sizeUsd
          : pos.sizeUsd - marketValue;
      positions.push({
        instrumentSymbol: pos.symbol,
        instrumentType: "crypto",
        side: pos.side === "BUY" ? "long" : "short",
        sizeUsd: marketValue,
        unrealizedPnl,
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
    if (!ticker) {
      throw brokerDataError("Kraken ticker response missing pair data", {
        broker: "kraken",
        symbol: instrumentSymbol,
      });
    }
    const details = { broker: "kraken", symbol: instrumentSymbol };
    const last = optionalFiniteOrNaN(ticker.c?.[0], "ticker.last", details);
    const bid = optionalFiniteOrNaN(ticker.b?.[0], "ticker.bid", details);
    const ask = optionalFiniteOrNaN(ticker.a?.[0], "ticker.ask", details);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number.NaN;
    const price = requirePositivePrice(
      firstPositive(last, mid, bid, ask),
      "ticker.price",
      details,
    );
    return {
      instrumentSymbol,
      price,
      bid: bid > 0 ? bid : undefined,
      ask: ask > 0 ? ask : undefined,
      volume:
        optionalFiniteNumber(ticker.v?.[1], "ticker.volume", details) ??
        undefined,
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
      return this.fillGhostOrderV2(order, quote);
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

  /**
   * Ghost fill via shared GhostFillSimulator. Market fills immediately;
   * limits/stops rest until marketable. Debits persisted paper balance on
   * fill — never touches the real Kraken balance.
   */
  private fillGhostOrderV2(
    order: BrokerOrderV2,
    quote: GhostQuote,
  ): BrokerOrderResult {
    const receipt = this.ghosts.simulateFill(order, quote);
    const brokerOrderId = receipt.ghostOrderId;

    if (receipt.status === "filled" && receipt.filledAvgPrice != null) {
      const filledAvgPrice = receipt.filledAvgPrice;
      const sizeUsd = receipt.filledQty * filledAvgPrice;
      this.runPaperTransaction(() => {
        if (order.side === "BUY") this.debitPaper(sizeUsd);
        this.setGhostPosition(brokerOrderId, {
          symbol: order.instrument.symbol,
          side: order.side,
          sizeUsd,
          shares: receipt.filledQty,
          entryPrice: filledAvgPrice,
          open: true,
          resting: false,
          order,
        });
      });
      logger.info(
        {
          brokerOrderId,
          filledAvgPrice,
          paperBalanceUsd: this.readPaperBalance(),
        },
        "kraken ghost: order filled locally",
      );
      return {
        brokerOrderId,
        filledAvgPrice,
        filledSizeUsd: sizeUsd,
      };
    }

    // Resting limit/stop — no debit until fill on poll.
    const estPrice = order.limitPrice ?? order.stopPrice ?? quote.last;
    const estQty =
      order.quantity.kind === "units"
        ? order.quantity.value
        : order.quantity.value / Math.max(estPrice, 0.01);
    this.setGhostPosition(brokerOrderId, {
      symbol: order.instrument.symbol,
      side: order.side,
      sizeUsd: estQty * estPrice,
      shares: estQty,
      entryPrice: estPrice,
      open: true,
      resting: true,
      order,
    });
    logger.info(
      { brokerOrderId, limitPrice: order.limitPrice },
      "kraken ghost: resting order waiting for marketable quote",
    );
    return { brokerOrderId, filledAvgPrice: 0 };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    if (brokerOrderId.startsWith("ghost-")) {
      this.rehydrateGhostPosition(brokerOrderId);
      const canceled = this.ghosts.cancel(brokerOrderId);
      const pos = this.ghostPositions.get(brokerOrderId);
      if (pos?.resting) {
        pos.open = false;
        pos.resting = false;
        this.persistGhostPosition(brokerOrderId, pos);
      } else if (canceled?.status === "canceled") {
        this.ghostPositions.delete(brokerOrderId);
        this.paperPositions?.setClosed(brokerOrderId);
      }
      return;
    }
    const data = await this.privateRequest<{ error?: string[] }>(
      "/0/private/CancelOrder",
      { txid: brokerOrderId },
    );
    this.assertNoError(data.error);
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    if (orderId.startsWith("ghost-")) return this.getGhostOrderStatus(orderId);

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
    const latestPrice = optionalPositivePrice(
      row.price ?? row.avg_price,
      "order.price",
      { broker: "kraken", orderId },
    );
    return {
      brokerOrderId: orderId,
      status: closed ? "closed" : "open",
      latestPrice,
      realizedPnlUsd: null,
    };
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    if (orderId.startsWith("ghost-")) return this.closeGhostOrder(orderId);
    const status = await this.getOrderStatus(orderId);
    if (status.status === "open") await this.cancelOrder(orderId);
    return {
      brokerOrderId: orderId,
      // Cancel-only close: OrderStatus.realizedPnlUsd is null → CloseResult needs 0.
      realizedPnlUsd: status.realizedPnlUsd ?? 0,
    };
  }

  /**
   * Ghost status: resting limits/stops re-check quotes on each poll; filled
   * positions stay open until explicitly closed. Mirrors the Polymarket
   * ghost-status shape so trade-monitor treats both venues consistently.
   */
  private async getGhostOrderStatus(orderId: string): Promise<OrderStatus> {
    const sim = this.ghosts.get(orderId);
    if (sim?.status === "canceled") {
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    this.rehydrateGhostPosition(orderId);
    await this.promoteRestingIfFilled(orderId);

    const pos = this.ghostPositions.get(orderId);
    if (!pos) {
      return {
        brokerOrderId: orderId,
        status: "unknown",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    if (pos.resting) {
      return {
        brokerOrderId: orderId,
        status: "open",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    if (!pos.open) {
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: pos.entryPrice,
        realizedPnlUsd: null,
      };
    }

    let latestPrice: number | null = null;
    try {
      const snap = await this.getMarketSnapshot(pos.symbol);
      latestPrice = snap.price;
    } catch {
      latestPrice = null;
    }
    return {
      brokerOrderId: orderId,
      status: "open",
      latestPrice,
      realizedPnlUsd: null,
    };
  }

  /**
   * Close a filled ghost position: mark-to-market against a fresh quote,
   * credit proceeds, compute realized P&L. A still-resting order is
   * canceled instead (nothing to settle). Idempotent — a second close call
   * finds `open: false` and returns zero P&L rather than re-crediting.
   */
  private async closeGhostOrder(orderId: string): Promise<CloseResult> {
    this.rehydrateGhostPosition(orderId);
    await this.promoteRestingIfFilled(orderId);
    const pos = this.ghostPositions.get(orderId);
    if (!pos || !pos.open) {
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }
    if (pos.resting) {
      await this.cancelOrder(orderId);
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }

    let exitPrice = pos.entryPrice;
    try {
      const snap = await this.getMarketSnapshot(pos.symbol);
      exitPrice = snap.price;
    } catch {
      /* mark at entry price when the venue is unreachable */
    }
    const exitValue = pos.shares * exitPrice;
    const realizedPnlUsd = exitValue - pos.sizeUsd;
    this.runPaperTransaction(() => {
      this.creditPaper(exitValue);
      pos.open = false;
      this.paperPositions?.setClosed(orderId);
    });
    logger.info(
      {
        orderId,
        exitPrice,
        realizedPnlUsd,
        paperBalanceUsd: this.readPaperBalance(),
      },
      "kraken ghost: position closed locally",
    );
    return { brokerOrderId: orderId, realizedPnlUsd };
  }

  /** Re-check resting ghost against a fresh quote; debit paper on fill. */
  private async promoteRestingIfFilled(orderId: string): Promise<void> {
    const pos = this.ghostPositions.get(orderId);
    if (!pos?.resting) return;
    let quote: GhostQuote;
    try {
      const snap = await this.getMarketSnapshot(pos.symbol);
      quote = {
        bid: snap.bid ?? snap.price,
        ask: snap.ask ?? snap.price,
        last: snap.price,
      };
    } catch {
      return;
    }
    const receipt = this.ghosts.poll(orderId, quote);
    if (receipt?.status !== "filled" || receipt.filledAvgPrice == null) return;
    const filledAvgPrice = receipt.filledAvgPrice;
    const sizeUsd = receipt.filledQty * filledAvgPrice;
    this.runPaperTransaction(() => {
      if (pos.side === "BUY") this.debitPaper(sizeUsd);
      pos.resting = false;
      pos.shares = receipt.filledQty;
      pos.entryPrice = filledAvgPrice;
      pos.sizeUsd = sizeUsd;
      pos.open = true;
      this.persistGhostPosition(orderId, pos);
    });
    logger.info(
      {
        brokerOrderId: orderId,
        filledAvgPrice,
        paperBalanceUsd: this.readPaperBalance(),
      },
      "kraken ghost: resting order filled on quote cross",
    );
  }

  /**
   * Rehydrate a ghost position from the persisted repo when the in-memory
   * map lost it (adapter rebuilt after a restart). Also re-seeds a still-
   * resting order into GhostFillSimulator (which is otherwise purely
   * in-memory) so a later quote cross is still detected and debited after
   * the restart, not just before it. No-op when the position is already
   * tracked in memory, or when persistence isn't configured.
   */
  private rehydrateGhostPosition(orderId: string): void {
    if (this.ghostPositions.has(orderId)) return;
    if (!this.paperPositions) return;
    const row = this.paperPositions.get(orderId);
    if (!row || !row.open) return;
    const meta = row.metadata as {
      orderType?: BrokerOrderV2["orderType"];
      limitPrice?: number;
      stopPrice?: number;
      timeInForce?: BrokerOrderV2["timeInForce"];
      quantityKind?: "units" | "notional_usd";
      quantityValue?: number;
    };
    const order: BrokerOrderV2 = {
      clientOrderId: orderId.replace(/^ghost-/, ""),
      instrument: { symbol: row.instrumentSymbol, instrumentClass: "crypto" },
      side: row.side,
      quantity: {
        kind: meta.quantityKind ?? "units",
        value: meta.quantityValue ?? row.shares,
      },
      orderType: meta.orderType ?? "market",
      timeInForce: meta.timeInForce ?? "gtc",
      limitPrice: meta.limitPrice,
      stopPrice: meta.stopPrice,
    };
    this.ghostPositions.set(orderId, {
      symbol: row.instrumentSymbol,
      side: row.side,
      sizeUsd: row.sizeUsd,
      shares: row.shares,
      entryPrice: row.entryPrice,
      open: row.open,
      resting: row.resting,
      order,
    });
    if (row.resting) {
      this.ghosts.restoreResting(orderId, order, row.shares);
    }
    logger.info(
      { brokerOrderId: orderId, resting: row.resting },
      "kraken ghost: position rehydrated from persisted store after restart",
    );
  }

  /** Write-through: update in-memory map and (when configured) persist. */
  private setGhostPosition(orderId: string, position: GhostPosition): void {
    this.ghostPositions.set(orderId, position);
    this.persistGhostPosition(orderId, position);
  }

  private persistGhostPosition(orderId: string, position: GhostPosition): void {
    if (!this.paperPositions || !this.accountId) return;
    this.paperPositions.upsert({
      brokerOrderId: orderId,
      accountId: this.accountId,
      venue: "kraken",
      instrumentSymbol: position.symbol,
      side: position.side,
      shares: position.shares,
      entryPrice: position.entryPrice,
      sizeUsd: position.sizeUsd,
      open: position.open,
      resting: position.resting,
      metadata: {
        orderType: position.order.orderType,
        limitPrice: position.order.limitPrice,
        stopPrice: position.order.stopPrice,
        timeInForce: position.order.timeInForce,
        quantityKind: position.order.quantity.kind,
        quantityValue: position.order.quantity.value,
      },
    });
  }

  private readPaperBalance(): number {
    if (this.paperBalances && this.accountId) {
      return this.paperBalances.getBalance(this.accountId);
    }
    return this.memoryPaperBalanceUsd;
  }

  private runPaperTransaction(fn: () => void): void {
    if (this.paperBalances) this.paperBalances.runInTransaction(fn);
    else fn();
  }

  private debitPaper(amount: number): void {
    if (this.paperBalances && this.accountId) {
      this.paperBalances.debit(this.accountId, amount);
      return;
    }
    if (this.memoryPaperBalanceUsd < amount) {
      throw brokerError(
        "BROKER_INSUFFICIENT_FUNDS",
        `Insufficient paper balance: need $${amount.toFixed(2)}, have $${this.memoryPaperBalanceUsd.toFixed(2)}.`,
        { need: amount, have: this.memoryPaperBalanceUsd },
      );
    }
    this.memoryPaperBalanceUsd -= amount;
  }

  private creditPaper(amount: number): void {
    if (this.paperBalances && this.accountId) {
      this.paperBalances.credit(this.accountId, amount);
      return;
    }
    this.memoryPaperBalanceUsd += amount;
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
  return safeJsonParse(text, undefined, "kraken-adapter.ws-message");
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

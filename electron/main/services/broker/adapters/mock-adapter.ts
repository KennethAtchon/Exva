import type { ConnectionTestResult } from "@/lib/types";
import { BROKER_SUPPORTED_INSTRUMENT_CLASSES } from "@electron/shared/domain/broker-capabilities";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";
import {
  DEFAULT_MARKET_ONLY_CAPABILITIES,
  adapterSupportsOrder,
  lowerBrokerOrderV2ToV1,
  type AdapterCapabilities,
  type BrokerOrderV2,
  type OrderEventFeed,
} from "../order-contract-v2";
import { createPollOrderEventFeed } from "../order-event-feed";
import { brokerError } from "../broker-errors";
import {
  DEFAULT_MOCK_ACCOUNT_BALANCE_USD,
  DEFAULT_MOCK_EXECUTION_TIER,
  type MockExecutionTier,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import {
  isContinuousFuturesRoot,
  resolveFrontMonthContract,
} from "../futures-front-month";

const MOCK_CAPABILITIES: AdapterCapabilities = {
  ...DEFAULT_MARKET_ONLY_CAPABILITIES,
  supportsLimit: true,
  supportsStop: false,
  supportsBracket: true,
  supportsStreaming: false,
  quantityKinds: ["notional_usd", "units"],
  timeInForce: ["day", "gtc", "ioc"],
  orderTypes: ["market", "limit"],
};

export type MockScenarioBias = "bullish" | "bearish" | "sideways" | "volatile";

export interface MockScenario {
  bias?: MockScenarioBias;
  volatilityPct?: number;
  trendPctPerDay?: number;
  kind?: MockScenarioKind;
  executionTier?: MockExecutionTier;
  marketClosed?: boolean;
  brokerTimeoutMs?: number;
  /** If set, getOrderStatus returns "closed" with computed PnL after this many ms. */
  autoCloseAfterMs?: number;
  /** Cert/taxonomy: testConnection fails with BROKER_AUTH. */
  forceAuthFail?: boolean;
  /** Cert/taxonomy: placeOrder fails with BROKER_INSUFFICIENT_FUNDS. */
  forceInsufficientFunds?: boolean;
  /** Cert/taxonomy: placeOrder for this symbol fails with BROKER_UNKNOWN_SYMBOL. */
  forceUnknownSymbol?: string;
}

export interface MockOhlcvBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const BAR_MS: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "1d": DAY_MS,
  "4h": 4 * HOUR_MS,
  "1h": HOUR_MS,
  "30m": 30 * 60 * 1000,
  "15m": FIFTEEN_MIN_MS,
};

const SCENARIO_DRIFT: Record<MockScenarioBias, number> = {
  bullish: 0.005,
  bearish: -0.005,
  sideways: 0.0,
  volatile: 0.001,
};

export const DEFAULT_MOCK_SCENARIO: Required<
  Pick<MockScenario, "bias" | "volatilityPct" | "trendPctPerDay">
> = {
  bias: "bullish",
  volatilityPct: 0.018,
  trendPctPerDay: 0.006,
};

function symbolSeed(symbol: string): number {
  return [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function seededNormal(seed: number): number {
  const u1 = ((seed * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const u2 = (((seed + 1) * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  return (
    Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function shapeCleanBreakoutBars(bars: MockOhlcvBar[]): MockOhlcvBar[] {
  const rangeHigh = Math.max(...bars.map((bar) => bar.high));
  const lastIndex = bars.length - 1;
  const last = bars[lastIndex];
  if (!last) return bars;

  const targetClose = round2(rangeHigh * 0.998);
  const shapedLast: MockOhlcvBar = {
    ...last,
    close: targetClose,
    open: round2(Math.min(last.open, targetClose * 0.998)),
    high: round2(Math.max(rangeHigh, targetClose * 1.001)),
    low: round2(Math.min(last.low, targetClose * 0.992)),
    volume: Math.round((last.volume ?? 0) * 1.35),
  };

  const next = [...bars];
  next[lastIndex] = shapedLast;

  for (let i = Math.max(0, lastIndex - 4); i < lastIndex; i += 1) {
    const bar = next[i];
    if (!bar) continue;
    next[i] = {
      ...bar,
      volume: Math.round(
        (bar.volume ?? 0) * (1.05 + (i - (lastIndex - 4)) * 0.05),
      ),
    };
  }

  return next;
}

export class MockBrokerAdapter implements BrokerAdapter {
  readonly brokerType = "mock";
  readonly supportedInstrumentClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES.mock;
  /**
   * Not launch-capable: this adapter is a deterministic simulator used for
   * paper/dev workflows only. It never touches a real broker.
   */
  readonly launchCapable = false;
  readonly capabilities = MOCK_CAPABILITIES;

  private readonly orders = new Map<
    string,
    { order: BrokerOrder; price: number; placedAt: number }
  >();

  constructor(
    private readonly scenario: MockScenario = DEFAULT_MOCK_SCENARIO,
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.scenario.forceAuthFail) {
      throw brokerError("BROKER_AUTH", "Mock broker auth failed");
    }
    return {
      ok: true,
      message: "Mock broker connected",
      account_balance: DEFAULT_MOCK_ACCOUNT_BALANCE_USD,
    };
  }

  async getAccountBalance(): Promise<number> {
    return DEFAULT_MOCK_ACCOUNT_BALANCE_USD;
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    if (this.scenario.marketClosed) {
      throw new Error("Market is closed");
    }

    const price = this.basePriceFor(instrumentSymbol);
    const kind = this.scenario.kind;

    if (kind === "stale_quote") {
      const halfSpread = price * 0.0005;
      return {
        instrumentSymbol,
        price,
        bid: round2(price - halfSpread),
        ask: round2(price + halfSpread),
        spreadPct: 0.1,
        volume: Math.round(price * 600),
        timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      };
    }

    const isWideSpread = kind === "wide_spread";
    const spreadPct = isWideSpread ? 2.5 : 0.1;
    const halfSpread = price * (spreadPct / 200);
    const volume = Math.round(price * (isWideSpread ? 120 : 800));

    return {
      instrumentSymbol,
      price,
      bid: round2(price - halfSpread),
      ask: round2(price + halfSpread),
      spreadPct,
      volume,
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    if (this.scenario.marketClosed) {
      throw new Error("Market is closed; order rejected");
    }

    if (this.scenario.forceInsufficientFunds) {
      throw brokerError(
        "BROKER_INSUFFICIENT_FUNDS",
        "Mock broker insufficient funds",
      );
    }
    if (
      this.scenario.forceUnknownSymbol &&
      order.instrumentSymbol === this.scenario.forceUnknownSymbol
    ) {
      throw brokerError(
        "BROKER_UNKNOWN_SYMBOL",
        `Mock broker unknown symbol: ${order.instrumentSymbol}`,
      );
    }

    // Solution 10: continuous futures roots must roll explicitly.
    if (
      order.instrumentType === "futures" &&
      isContinuousFuturesRoot(order.instrumentSymbol)
    ) {
      order = {
        ...order,
        instrumentSymbol: resolveFrontMonthContract(order.instrumentSymbol),
      };
    }

    const kind = this.scenario.kind;

    if (kind === "broker_reject") {
      throw new Error("Order rejected by broker: RISK_LIMIT_EXCEEDED");
    }

    if (kind === "rate_limit") {
      throw new Error("429 Too Many Requests: broker rate limit exceeded");
    }

    if (this.scenario.brokerTimeoutMs) {
      await new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Broker request timed out")),
          this.scenario.brokerTimeoutMs,
        ),
      );
    }

    const brokerOrderId = `mock_${crypto.randomUUID()}`;
    const filledAvgPrice = this.basePriceFor(order.instrumentSymbol);
    this.orders.set(brokerOrderId, {
      order,
      price: filledAvgPrice,
      placedAt: Date.now(),
    });

    if (kind === "partial_fill") {
      const fillRatio = 0.4 + Math.random() * 0.4;
      return {
        brokerOrderId,
        filledAvgPrice,
        filledSizeUsd: round2(order.sizeUsd * fillRatio),
      };
    }

    return { brokerOrderId, filledAvgPrice };
  }

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) {
      throw new Error(`Mock rejects order: ${check.reason}`);
    }
    if (
      order.orderType === "market" &&
      order.quantity.kind === "notional_usd"
    ) {
      return this.placeOrder(lowerBrokerOrderV2ToV1(order));
    }
    const sizeUsd =
      order.quantity.kind === "notional_usd"
        ? order.quantity.value
        : order.quantity.value *
          (order.limitPrice ?? this.basePriceFor(order.instrument.symbol));
    return this.placeOrder({
      instrumentSymbol: order.instrument.symbol,
      instrumentDisplayName: order.instrument.displayName,
      predictionOutcome: order.instrument.predictionOutcome,
      instrumentMetadataJson: order.instrument.metadataJson,
      instrumentType: order.instrument.instrumentClass,
      side: order.side,
      sizeUsd,
      stopLossPrice: order.bracket?.stopLossPrice,
      takeProfitPrice: order.bracket?.takeProfitPrice,
      clientOrderId: order.clientOrderId,
    });
  }

  createOrderEventFeed(): OrderEventFeed {
    return createPollOrderEventFeed(this, [], 200);
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.orders.delete(orderId);
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [...this.orders.entries()].map(([, { order, price }]) => ({
      instrumentSymbol: order.instrumentSymbol,
      instrumentDisplayName: order.instrumentDisplayName ?? null,
      predictionOutcome: order.predictionOutcome ?? null,
      instrumentMetadataJson: order.instrumentMetadataJson ?? null,
      instrumentType: order.instrumentType,
      side: "long" as const,
      sizeUsd: order.sizeUsd,
      unrealizedPnl: Number((price * 0.001).toFixed(2)),
    }));
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    const existing = this.orders.get(orderId);
    this.orders.delete(orderId);
    if (!existing) {
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }

    const entryPrice = existing.price;
    const closePrice = this.computeClosePrice(
      existing.order.instrumentSymbol,
      entryPrice,
    );
    const sizeUsd = existing.order.sizeUsd;
    const isSell = existing.order.side === "SELL";

    const realizedPnlUsd = isSell
      ? ((entryPrice - closePrice) / entryPrice) * sizeUsd
      : ((closePrice - entryPrice) / entryPrice) * sizeUsd;

    return { brokerOrderId: orderId, realizedPnlUsd: round2(realizedPnlUsd) };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const existing = this.orders.get(orderId);
    if (!existing) {
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    const autoClose = this.scenario.autoCloseAfterMs;
    if (autoClose != null && Date.now() - existing.placedAt >= autoClose) {
      this.orders.delete(orderId);
      const closePrice = this.computeClosePrice(
        existing.order.instrumentSymbol,
        existing.price,
      );
      const isSell = existing.order.side === "SELL";
      const realizedPnlUsd = round2(
        isSell
          ? ((existing.price - closePrice) / existing.price) *
              existing.order.sizeUsd
          : ((closePrice - existing.price) / existing.price) *
              existing.order.sizeUsd,
      );
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: closePrice,
        realizedPnlUsd,
      };
    }

    return {
      brokerOrderId: orderId,
      status: "open",
      latestPrice: this.basePriceFor(existing.order.instrumentSymbol),
      realizedPnlUsd: null,
    };
  }

  async getOhlcv(
    instrumentSymbol: string,
    timeframe: TradingTimeframe,
    barCount: number,
  ): Promise<MockOhlcvBar[]> {
    return this.getMockOhlcv(instrumentSymbol, timeframe, barCount);
  }

  getMockOhlcv(
    symbol: string,
    timeframe = "1d",
    barCount = 200,
  ): MockOhlcvBar[] {
    const barMs = BAR_MS[timeframe] ?? DAY_MS;
    const seed = symbolSeed(symbol);
    const base = this.basePriceFor(symbol);
    const bias = this.scenario.bias ?? "sideways";
    const dailyDrift = this.scenario.trendPctPerDay ?? SCENARIO_DRIFT[bias];
    const periodDrift = dailyDrift * (barMs / DAY_MS);
    const dailyVol = this.scenario.volatilityPct ?? 0.015;
    const periodVol = dailyVol * Math.sqrt(barMs / DAY_MS);
    const noiseScale =
      bias === "volatile" ? 1.15 : bias === "sideways" ? 0.75 : 0.35;

    const bars: MockOhlcvBar[] = [];
    const trendStart =
      base * Math.exp(-periodDrift * Math.max(0, barCount - 1));

    for (let i = 0; i < barCount; i++) {
      const trendPrice = trendStart * Math.exp(periodDrift * i);
      const openNoise = seededNormal(seed + i) * periodVol * noiseScale;
      const closeNoise = seededNormal(seed + i + 500) * periodVol * noiseScale;
      const open = round2(Math.max(0.01, trendPrice * (1 + openNoise)));
      const close = round2(Math.max(0.01, trendPrice * (1 + closeNoise)));
      const high = round2(
        Math.max(open, close) *
          (1 + Math.abs(seededNormal(seed + i + 1000)) * 0.005),
      );
      const low = round2(
        Math.min(open, close) *
          (1 - Math.abs(seededNormal(seed + i + 2000)) * 0.005),
      );
      const volume = Math.round(base * (500 + ((seed + i) % 1000)));
      bars.push({
        ts: new Date(Date.now() - (barCount - 1 - i) * barMs).toISOString(),
        open,
        high,
        low,
        close,
        volume,
      });
    }

    if (this.scenario.kind === "clean_breakout" && bars.length > 0) {
      return shapeCleanBreakoutBars(bars);
    }

    return bars;
  }

  getScenarioBias(): MockScenarioBias {
    return this.scenario.bias ?? DEFAULT_MOCK_SCENARIO.bias;
  }

  getScenarioKind(): MockScenarioKind | undefined {
    return this.scenario.kind;
  }

  getExecutionTier(): MockExecutionTier {
    return this.scenario.executionTier ?? DEFAULT_MOCK_EXECUTION_TIER;
  }

  private basePriceFor(instrumentSymbol: string): number {
    const seed = symbolSeed(instrumentSymbol);
    return Number((50 + (seed % 350)).toFixed(2));
  }

  private computeClosePrice(symbol: string, entryPrice: number): number {
    switch (this.scenario.kind) {
      case "gap_down_after_entry":
        return round2(entryPrice * 0.91);
      case "failed_breakout":
        return round2(entryPrice * 0.97);
      case "news_reversal":
        return round2(entryPrice * 0.94);
      case "clean_breakout":
        return round2(entryPrice * 1.05);
      default:
        return this.basePriceFor(symbol);
    }
  }
}

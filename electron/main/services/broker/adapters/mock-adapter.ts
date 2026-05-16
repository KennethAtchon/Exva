import type { ConnectionTestResult } from "@/lib/types";
import type { InstrumentClass } from "@/lib/types";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketSnapshot,
  OrderStatus,
} from "./broker-adapter";
import type { MockScenarioKind } from "../mock/mock-scenario-fixtures";

export type MockScenarioBias = "bullish" | "bearish" | "sideways" | "volatile";

export interface MockScenario {
  bias?: MockScenarioBias;
  volatilityPct?: number;
  trendPctPerDay?: number;
  kind?: MockScenarioKind;
  marketClosed?: boolean;
  brokerTimeoutMs?: number;
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

const BAR_MS: Record<string, number> = {
  "1d": DAY_MS,
  "4h": 4 * HOUR_MS,
  "1h": HOUR_MS,
};

const SCENARIO_DRIFT: Record<MockScenarioBias, number> = {
  bullish: 0.005,
  bearish: -0.005,
  sideways: 0.0,
  volatile: 0.001,
};

export const DEFAULT_MOCK_SCENARIO: Required<Pick<MockScenario, "bias" | "volatilityPct" | "trendPctPerDay">> = {
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
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class MockBrokerAdapter implements BrokerAdapter {
  readonly brokerType = "mock";
  readonly supportedInstrumentClasses: readonly InstrumentClass[] = ["stock", "crypto", "futures", "prediction_market"];
  /**
   * Not launch-capable: this adapter is a deterministic simulator used for
   * paper/dev workflows only. It never touches a real broker.
   */
  readonly launchCapable = false;

  private readonly orders = new Map<string, { order: BrokerOrder; price: number }>();

  constructor(private readonly scenario: MockScenario = DEFAULT_MOCK_SCENARIO) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Mock broker connected", account_balance: 100000 };
  }

  async getAccountBalance(): Promise<number> {
    return 100000;
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

    const kind = this.scenario.kind;

    if (kind === "broker_reject") {
      throw new Error("Order rejected by broker: RISK_LIMIT_EXCEEDED");
    }

    if (kind === "rate_limit") {
      throw new Error("429 Too Many Requests: broker rate limit exceeded");
    }

    if (this.scenario.brokerTimeoutMs) {
      await new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Broker request timed out")), this.scenario.brokerTimeoutMs),
      );
    }

    const brokerOrderId = `mock_${crypto.randomUUID()}`;
    const filledAvgPrice = this.basePriceFor(order.instrumentSymbol);
    this.orders.set(brokerOrderId, { order, price: filledAvgPrice });

    if (kind === "partial_fill") {
      const fillRatio = 0.4 + Math.random() * 0.4;
      return { brokerOrderId, filledAvgPrice, filledSizeUsd: round2(order.sizeUsd * fillRatio) };
    }

    return { brokerOrderId, filledAvgPrice };
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
    const closePrice = this.computeClosePrice(existing.order.instrumentSymbol, entryPrice);
    const sizeUsd = existing.order.sizeUsd;
    const isSell = existing.order.side === "SELL";

    const realizedPnlUsd = isSell
      ? ((entryPrice - closePrice) / entryPrice) * sizeUsd
      : ((closePrice - entryPrice) / entryPrice) * sizeUsd;

    return { brokerOrderId: orderId, realizedPnlUsd: round2(realizedPnlUsd) };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const existing = this.orders.get(orderId);
    return {
      brokerOrderId: orderId,
      status: existing ? "open" : "closed",
      latestPrice: existing ? this.basePriceFor(existing.order.instrumentSymbol) : null,
      realizedPnlUsd: null,
    };
  }

  async getOhlcv(instrumentSymbol: string, timeframe: "1h" | "4h" | "1d", barCount: number): Promise<Array<{ high: number; low: number; close: number }>> {
    return this.getMockOhlcv(instrumentSymbol, timeframe, barCount);
  }

  getMockOhlcv(symbol: string, timeframe = "1d", barCount = 200): MockOhlcvBar[] {
    const barMs = BAR_MS[timeframe] ?? DAY_MS;
    const seed = symbolSeed(symbol);
    const base = this.basePriceFor(symbol);
    const bias = this.scenario.bias ?? "sideways";
    const dailyDrift = this.scenario.trendPctPerDay ?? SCENARIO_DRIFT[bias];
    const periodDrift = dailyDrift * (barMs / DAY_MS);
    const dailyVol = this.scenario.volatilityPct ?? 0.015;
    const periodVol = dailyVol * Math.sqrt(barMs / DAY_MS);
    const noiseScale = bias === "volatile" ? 1.15 : bias === "sideways" ? 0.75 : 0.35;

    const bars: MockOhlcvBar[] = [];
    const trendStart = base * Math.exp(-periodDrift * Math.max(0, barCount - 1));

    for (let i = 0; i < barCount; i++) {
      const trendPrice = trendStart * Math.exp(periodDrift * i);
      const openNoise = seededNormal(seed + i) * periodVol * noiseScale;
      const closeNoise = seededNormal(seed + i + 500) * periodVol * noiseScale;
      const open = round2(Math.max(0.01, trendPrice * (1 + openNoise)));
      const close = round2(Math.max(0.01, trendPrice * (1 + closeNoise)));
      const high = round2(Math.max(open, close) * (1 + Math.abs(seededNormal(seed + i + 1000)) * 0.005));
      const low = round2(Math.min(open, close) * (1 - Math.abs(seededNormal(seed + i + 2000)) * 0.005));
      const volume = Math.round(base * (500 + (seed + i) % 1000));
      bars.push({
        ts: new Date(Date.now() - (barCount - 1 - i) * barMs).toISOString(),
        open,
        high,
        low,
        close,
        volume,
      });
    }
    return bars;
  }

  getScenarioBias(): MockScenarioBias {
    return this.scenario.bias ?? DEFAULT_MOCK_SCENARIO.bias;
  }

  getScenarioKind(): MockScenarioKind | undefined {
    return this.scenario.kind;
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

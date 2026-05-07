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

export type MockScenarioBias = "bullish" | "bearish" | "sideways" | "volatile";

export interface MockScenario {
  bias?: MockScenarioBias;
  volatilityPct?: number;
  trendPctPerDay?: number;
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

const SCENARIO_DRIFT: Record<MockScenarioBias, number> = {
  bullish: 0.005,
  bearish: -0.005,
  sideways: 0.0,
  volatile: 0.001,
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

  private readonly orders = new Map<string, { order: BrokerOrder; price: number }>();

  constructor(private readonly scenario: MockScenario = {}) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Mock broker connected", account_balance: 100000 };
  }

  async getAccountBalance(): Promise<number> {
    return 100000;
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    return {
      instrumentSymbol,
      price: this.priceFor(instrumentSymbol),
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    const brokerOrderId = `mock_${crypto.randomUUID()}`;
    const filledAvgPrice = this.priceFor(order.instrumentSymbol);
    this.orders.set(brokerOrderId, { order, price: filledAvgPrice });
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
    const realizedPnlUsd = existing ? Number((existing.price * 0.002).toFixed(2)) : 0;
    return { brokerOrderId: orderId, realizedPnlUsd };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const existing = this.orders.get(orderId);
    return {
      brokerOrderId: orderId,
      status: existing ? "open" : "closed",
      latestPrice: existing ? this.priceFor(existing.order.instrumentSymbol) : null,
      realizedPnlUsd: null,
    };
  }

  getMockOhlcv(symbol: string, barCount = 30): MockOhlcvBar[] {
    const seed = symbolSeed(symbol);
    const base = this.priceFor(symbol);
    const bias = this.scenario.bias ?? "sideways";
    const dailyDrift = this.scenario.trendPctPerDay ?? SCENARIO_DRIFT[bias];
    const dailyVol = this.scenario.volatilityPct ?? 0.015;

    const bars: MockOhlcvBar[] = [];
    let price = base * Math.exp(-dailyDrift * barCount);

    for (let i = 0; i < barCount; i++) {
      const noise = seededNormal(seed + i) * dailyVol;
      const ret = dailyDrift + noise;
      const open = round2(Math.max(0.01, price));
      const close = round2(Math.max(0.01, price * (1 + ret)));
      const high = round2(Math.max(open, close) * (1 + Math.abs(seededNormal(seed + i + 1000)) * 0.005));
      const low = round2(Math.min(open, close) * (1 - Math.abs(seededNormal(seed + i + 2000)) * 0.005));
      const volume = Math.round(base * (500 + (seed + i) % 1000));
      bars.push({
        ts: new Date(Date.now() - (barCount - 1 - i) * DAY_MS).toISOString(),
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }
    return bars;
  }

  private priceFor(instrumentSymbol: string): number {
    const seed = symbolSeed(instrumentSymbol);
    return Number((50 + (seed % 350)).toFixed(2));
  }
}

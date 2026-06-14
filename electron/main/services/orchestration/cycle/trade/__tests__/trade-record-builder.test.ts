import { describe, expect, it, vi } from "vitest";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { TradingCycleContext } from "../../trading-cycle-context";
import {
  buildTradeFromDecision,
  createTradeFromDecision,
} from "../trade-record-builder";

describe("trade-record-builder", () => {
  it("createTradeFromDecision builds pending trade for buy signal", () => {
    const ctx = createContext();
    const signal = makeBuySignal("NVDA", 185);

    const trade = createTradeFromDecision(
      ctx,
      { symbol: "NVDA", instrumentClass: "stock" },
      ctx.getSessionConfig(),
      signal,
      0.25,
      "proceed",
    );

    expect(trade.status).toBe("pending");
    expect(trade.instrumentSymbol).toBe("NVDA");
    expect(trade.position_size_usd).toBeGreaterThan(0);
  });

  it("createTradeFromDecision marks skip decisions as rejected", () => {
    const ctx = createContext();
    const signal = makeBuySignal("NVDA", 185, { action: "skip" });

    const trade = createTradeFromDecision(
      ctx,
      { symbol: "NVDA", instrumentClass: "stock" },
      ctx.getSessionConfig(),
      signal,
      0.1,
    );

    expect(trade.status).toBe("rejected");
    expect(trade.position_size_usd).toBe(0);
    expect(trade.closed_at).not.toBeNull();
  });

  it("buildTradeFromDecision preserves provided trade id", () => {
    const ctx = createContext();
    const signal = makeBuySignal("BTC-USD", 65000);

    const trade = buildTradeFromDecision(
      ctx,
      "trade-existing",
      { symbol: "BTC-USD", instrumentClass: "crypto" },
      ctx.getSessionConfig(),
      signal,
      0.5,
      "proceed",
    );

    expect(trade.id).toBe("trade-existing");
    expect(trade.instrumentType).toBe("crypto");
  });

  it("remaps prediction market metadata for selected outcome", () => {
    const ctx = createContext();
    const signal = makeBuySignal("ELECTION-2028", 0.62);

    const trade = createTradeFromDecision(
      ctx,
      {
        symbol: "ELECTION-2028",
        instrumentClass: "prediction_market",
        predictionOutcome: "YES",
        instrumentMetadataJson: JSON.stringify({
          outcomes: ["YES", "NO"],
          resolutionTime: "2028-11-05T00:00:00.000Z",
        }),
      },
      ctx.getSessionConfig(),
      signal,
      0.2,
    );

    expect(trade.predictionOutcome).toBe("YES");
    expect(trade.instrumentMetadataJson).toContain("YES");
  });
});

function makeBuySignal(
  symbol: string,
  entryPrice: number,
  overrides?: Partial<TradeSignal>,
): TradeSignal {
  return {
    symbol,
    action: "buy",
    executionStrategy: "breakout",
    entryPrice,
    confidence: 0.85,
    reasoning: "setup aligns",
    ...overrides,
  };
}

function createContext() {
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => "active",
    },
    strategyContextService: {
      get: () => ({
        researchPosture: {},
        rules: { sideBias: "long_only", setupType: "momentum" },
        riskConfig: {
          maxPositionUsd: 500,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
        },
        timeframe: {
          holdingStyle: "intraday_flat",
          maxHoldDays: 1,
        },
      }),
    },
    sessionSelectorSettingsRepo: {
      get: () => ({ noInstrumentRetryMinutes: 5 }),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: { runtimeStatus: () => "active", emit: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    brokerRouting: {
      resolveBrokerAccountId: () => "broker-mock",
    },
  } as never);

  ctx.resolveBrokerAccountId = () => "broker-mock";
  return ctx;
}

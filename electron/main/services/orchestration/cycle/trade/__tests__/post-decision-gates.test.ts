import { afterEach, describe, expect, it, vi } from "vitest";
import * as stageDispatchModule from "../../../../pipeline/execution/stage-dispatch";
import { TradingCycleContext } from "../../trading-cycle-context";
import { runPostDecisionGates } from "../post-decision-gates";

describe("runPostDecisionGates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs risk gate engine chain and returns sized order", async () => {
    vi.spyOn(stageDispatchModule, "runEngineChainStage").mockResolvedValue({
      quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
      riskOrder: {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
      brokerAccountId: "broker-1",
    });
    const ctx = createContext();

    const result = await runPostDecisionGates(
      ctx,
      { symbol: "NVDA", instrumentClass: "stock" },
      {
        quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
        decision: {
          run: { id: "run-1" } as never,
          message: { id: "msg-1" } as never,
          output: {
            symbol: "NVDA",
            action: "buy",
            executionStrategy: "breakout",
            entryPrice: 185,
            confidence: 0.85,
            reasoning: "setup aligns",
          },
        },
      },
      "cycle-1",
      "trade-1",
    );

    expect(stageDispatchModule.runEngineChainStage).toHaveBeenCalled();
    expect(result.riskOrder).toMatchObject({
      instrumentSymbol: "NVDA",
      side: "BUY",
      sizeUsd: 500,
    });
  });
});

function createContext() {
  return new TradingCycleContext("session-1", {
    sessionRepo: {
      requireById: () => ({
        id: "session-1",
        instrumentClasses: ["stock"],
      }),
      getStatus: () => "active",
      uptimeMin: () => 0,
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        researchPosture: {},
        rules: { sideBias: "long_only", setupType: "momentum" },
        riskConfig: {
          maxPositionUsd: 1000,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
        },
        timeframe: {
          holdingStyle: "intraday_flat",
          maxHoldDays: 1,
        },
      }),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: { runtimeStatus: () => "active", emit: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    statsRepo: {
      dashboardStats: () => ({
        daily_api_spend: 0,
        api_budget: 5,
        portfolio_value: 5000,
      }),
    },
    tradesRepo: {
      listOpenAndPending: () => [],
      checkDuplicateClientOrder: () => false,
      checkInstrumentConflict: () => false,
    },
    brokerRouting: {
      resolveAdapter: vi.fn(async () => ({
        adapter: {
          brokerType: "mock",
          supportedInstrumentClasses: ["stock"],
        },
        brokerAccountId: "broker-1",
      })),
      resolveBrokerAccountId: () => "broker-1",
    },
    brokerAllocationGate: {
      checkOrderFits: () => ({ ok: true }),
      checkInstrumentConflict: () => ({ ok: true }),
    },
    capitalReservation: {
      runInTransaction: <T>(fn: () => T) => fn(),
      listActiveBySession: () => [],
    },
    sessionBrokerAssignmentsRepo: {
      listAssignments: () => [
        { brokerAccountId: "broker-1", allocatedUsd: 5000 },
      ],
    },
  } as never);
}

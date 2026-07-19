import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstrumentAnalysisResult } from "../../../../pipeline/analysis/types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import type { Trade } from "@/lib/types";
import type { TradeCycleContext } from "../../types";
import { TradingCycleContext } from "../../trading-cycle-context";
import {
  finalizeOpenedTrade,
  persistPendingTradeFromPipeline,
  placeBrokerOrder,
  runApprovalAndCapital,
} from "../effect-runner";
import * as approvalFlowModule from "../approval-flow";
import * as enginePromptModule from "../../../../pipeline/execution/engine-prompt-injector";
import * as orderPlacerModule from "../order-placer";
import { registerDefaultEngines } from "../../../../pipeline/engines/signal-registry/register-default-engines";
import { RiskEngine } from "../../../../risk/risk-engine";
import { BrokerAllocationGate } from "../../../../risk/broker-allocation-gate";
import { ExitPolicyEvaluator } from "../../../../risk/exit-policy-evaluator";
import { OrderPolicyGate } from "../../../policy/order-policy-gate";
import { CandidateValidationService } from "../../../policy/candidate-validation-service";

registerDefaultEngines({
  riskEngine: new RiskEngine(),
  candidateValidation: new CandidateValidationService(),
  orderPolicyGate: new OrderPolicyGate(),
  brokerAllocationGate: {
    checkOrderFits: () => ({ ok: true as const }),
    checkInstrumentConflict: () => ({ ok: true as const }),
  } as unknown as BrokerAllocationGate,
  exitPolicyEvaluator: new ExitPolicyEvaluator(),
});

describe("effect-runner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persistPendingTradeFromPipeline inserts trade and agent runs", () => {
    const ctx = createContext();
    const context: TradeCycleContext = {
      kind: "trade",
      cycleId: "cycle-1",
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
    };
    const pipeline = makePipeline();

    const trade = persistPendingTradeFromPipeline(ctx, context, pipeline);

    expect(ctx.deps.tradesRepo.insert).toHaveBeenCalled();
    expect(ctx.deps.agentRunsRepo.insert).toHaveBeenCalledTimes(4);
    expect(context.trade?.id).toBe(trade.id);
  });

  it("runApprovalAndCapital auto-approves when human approval is not required", async () => {
    const ctx = createContext({ humanApprovalRequired: false });
    const trade = makeTrade();

    const result = await runApprovalAndCapital(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      trade,
      makeDecision(),
    );

    expect(result).toEqual({ approved: true, approvalId: null });
    expect(ctx.deps.capitalReservation.reserveForOrder).toHaveBeenCalled();
  });

  it("runApprovalAndCapital rejects and releases capital on user rejection", async () => {
    const ctx = createContext({ humanApprovalRequired: true });
    const trade = makeTrade();
    vi.spyOn(approvalFlowModule, "waitForApproval").mockResolvedValue({
      approved: false,
      approvalId: "approval-1",
    });

    const result = await runApprovalAndCapital(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      trade,
      makeDecision(),
    );

    expect(result.approved).toBe(false);
    expect(ctx.deps.capitalReservation.releaseByApproval).toHaveBeenCalled();
    expect(ctx.deps.tradesRepo.updateStatus).toHaveBeenCalledWith(
      trade.id,
      "rejected",
      0,
    );
  });

  it("placeBrokerOrder throws transient error when quote fetch fails", async () => {
    const ctx = createContext();
    ctx.deps.brokerRouting.resolveAdapter = vi.fn(
      async () =>
        ({
          adapter: {
            brokerType: "mock",
            supportedInstrumentClasses: ["stock"],
            getMarketSnapshot: vi.fn(async () => {
              throw new Error("quote unavailable");
            }),
          },
          brokerAccountId: "broker-1",
        }) as never,
    );

    await expect(
      placeBrokerOrder(
        ctx,
        {
          kind: "trade",
          cycleId: "cycle-1",
          instrument: { symbol: "NVDA", instrumentClass: "stock" },
        },
        makeTrade(),
        {
          instrumentSymbol: "NVDA",
          instrumentType: "stock",
          side: "BUY",
          sizeUsd: 500,
        },
      ),
    ).rejects.toMatchObject({
      code: "BROKER_UNREACHABLE",
      details: expect.objectContaining({
        outcome: "transient",
        retryable: true,
      }),
    });
  });

  it("placeBrokerOrder feeds the resolved adapter's v2 order + capabilities to the policy gate", async () => {
    const ctx = createContext();
    const runEngineSpy = vi.spyOn(enginePromptModule, "runEngineForWorker");
    const placeRoutedOrderSpy = vi
      .spyOn(orderPlacerModule, "placeRoutedOrder")
      .mockResolvedValue({
        brokerOrderId: "mock-order-1",
        filledAvgPrice: 185.5,
      });

    await placeBrokerOrder(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      makeTrade(),
      {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
    );

    expect(runEngineSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          orderV2: expect.objectContaining({
            orderType: "market",
            quantity: { kind: "notional_usd", value: 500 },
          }),
          adapterCapabilities: expect.objectContaining({
            orderTypes: expect.arrayContaining(["market"]),
          }),
        }),
      }),
    );
    expect(placeRoutedOrderSpy).toHaveBeenCalled();
  });

  it("placeBrokerOrder rejects an adapter-unsupported order shape before any broker HTTP call", async () => {
    const ctx = createContext();
    const placeRoutedOrderSpy = vi.spyOn(orderPlacerModule, "placeRoutedOrder");
    ctx.deps.brokerRouting.resolveAdapter = vi.fn(
      async () =>
        ({
          adapter: {
            brokerType: "mock",
            supportedInstrumentClasses: ["stock"],
            capabilities: {
              supportsLimit: false,
              supportsStop: false,
              supportsStopLimit: false,
              supportsBracket: false,
              supportsStreaming: false,
              quantityKinds: ["units"],
              timeInForce: ["day"],
              orderTypes: ["limit"],
            },
            getMarketSnapshot: vi.fn(async () => ({
              price: 185,
              timestamp: new Date().toISOString(),
            })),
            placeOrder: vi.fn(async () => {
              throw new Error("placeOrder should never be called");
            }),
          },
          brokerAccountId: "broker-1",
        }) as never,
    );

    await expect(
      placeBrokerOrder(
        ctx,
        {
          kind: "trade",
          cycleId: "cycle-1",
          instrument: { symbol: "NVDA", instrumentClass: "stock" },
        },
        makeTrade(),
        {
          instrumentSymbol: "NVDA",
          instrumentType: "stock",
          side: "BUY",
          sizeUsd: 500,
        },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("orderType market unsupported"),
      details: expect.objectContaining({
        outcome: "no_trade",
        reasonCategory: "broker_reject",
      }),
    });
    expect(placeRoutedOrderSpy).not.toHaveBeenCalled();
  });

  it("finalizeOpenedTrade marks trade open and emits trade_opened", () => {
    const ctx = createContext();
    const trade = makeTrade();

    finalizeOpenedTrade(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      trade,
      "mock-order-1",
      186,
      null,
      { price: 185, spreadPct: 0.1, timestamp: new Date().toISOString() },
    );

    expect(ctx.deps.tradesRepo.markOpen).toHaveBeenCalledWith(
      trade.id,
      "mock-order-1",
      186,
      expect.objectContaining({ spreadAtEntryBps: expect.any(Number) }),
    );
    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "trade_opened",
      expect.objectContaining({ id: trade.id }),
    );
    expect(ctx.deps.sessionExecutionStepsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "monitoring", status: "succeeded" }),
    );
  });
});

function makeDecision(): TradeSignal {
  return {
    symbol: "NVDA",
    action: "buy",
    executionStrategy: "breakout",
    entryPrice: 185,
    confidence: 0.85,
    reasoning: "setup aligns",
  };
}

function makeTrade(): Trade {
  return {
    id: "trade-1",
    sessionId: "session-1",
    brokerAccountId: "broker-1",
    instrumentSymbol: "NVDA",
    instrumentDisplayName: null,
    predictionOutcome: null,
    instrumentMetadataJson: null,
    instrumentType: "stock",
    side: "BUY",
    entry_price: 185,
    position_size_usd: 500,
    stop_loss_price: 175,
    take_profit_price: 200,
    strategy: "momentum",
    execution_strategy: "breakout",
    status: "pending",
    opened_at: null,
    closed_at: null,
    final_pnl_usd: null,
    ai_cost_usd: 0.2,
    confidence_score: 0.85,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  };
}

function makePipeline(): InstrumentAnalysisResult {
  return {
    state: {
      quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
      technical: stubRun(
        "technical",
      ) as InstrumentAnalysisResult["state"]["technical"],
      fundamental: stubRun(
        "fundamental",
      ) as InstrumentAnalysisResult["state"]["fundamental"],
      review: stubRun("review") as InstrumentAnalysisResult["state"]["review"],
      decision: stubRun(
        "decision",
        makeDecision(),
      ) as InstrumentAnalysisResult["state"]["decision"],
      riskOrder: {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
    },
    totalAiCostUsd: 0.2,
  };
}

function stubRun(role: string, output?: TradeSignal) {
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  return {
    run: {
      id: runId,
      trade_id: null,
      agent_type: role,
      model: "test-model",
      provider_key: "test-provider",
      finish_reason: "stop" as const,
      input_tokens: 10,
      output_tokens: 10,
      cost_usd: 0.01,
      output_text: "{}",
      duration_ms: 5,
      created_at: now,
    },
    message: {
      id: crypto.randomUUID(),
      agent_run_id: runId,
      session_id: "session-1",
      trade_id: null,
      cycle_id: "cycle-1",
      role,
      provider_key: "test-provider",
      model_id: "test-model",
      messages_json: "[]",
      thinking_json: null,
      tool_calls_json: "[]",
      output_json: "{}",
      output_schema_name: `${role}Signal`,
      parse_fallback: false,
      strategy_snapshot_json: "{}",
      market_snapshot_json: null,
      created_at: now,
    },
    output: output ?? {},
  };
}

function createContext(options?: { humanApprovalRequired?: boolean }) {
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => "active",
      requireById: () => ({ id: "session-1", instrumentClasses: ["stock"] }),
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
          maxPositionUsd: 500,
          maxAiSpendUsd: 5,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          atrStopMultiplier: null,
        },
        timeframe: {
          holdingStyle: "intraday_flat",
          primaryTradingTimeframe: "15m",
          targetHoldDays: 1,
          maxHoldDays: 1,
          timeframeNotes: "",
        },
      }),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn((step) => step) },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: { runtimeStatus: () => "active", emit: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tradesRepo: {
      insert: vi.fn((trade: Trade) => trade),
      markOpen: vi.fn((id, brokerOrderId, filledAvgPrice) => ({
        id,
        broker_order_id: brokerOrderId,
        entry_price: filledAvgPrice,
        status: "open",
      })),
      updateStatus: vi.fn((id, status) => ({ id, status })),
      checkDuplicateClientOrder: vi.fn(() => false),
      patchPendingExecution: vi.fn(),
    },
    agentRunsRepo: { insert: vi.fn() },
    agentMessagesRepo: { insert: vi.fn() },
    tradeApprovalsRepo: {
      runInTransaction: <T>(fn: () => T) => fn(),
      createPending: vi.fn(() => ({ id: "approval-1" })),
    },
    capitalReservation: {
      runInTransaction: <T>(fn: () => T) => fn(),
      reserveForOrder: vi.fn(),
      reserveForApproval: vi.fn(),
      releaseByApproval: vi.fn(),
      convertApprovalToOpenOrder: vi.fn(),
      convertOrderToPosition: vi.fn(),
    },
    brokerRouting: {
      resolveAdapter: vi.fn(async () => ({
        adapter: {
          brokerType: "mock",
          supportedInstrumentClasses: ["stock"],
          getMarketSnapshot: vi.fn(async () => ({
            price: 185,
            timestamp: new Date().toISOString(),
          })),
          placeOrder: vi.fn(async () => ({
            brokerOrderId: "mock-order-1",
            filledAvgPrice: 185.5,
          })),
        },
        brokerAccountId: "broker-1",
      })),
      resolveBrokerAccountId: () => "broker-1",
    },
    brokerRegistry: {},
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    },
    statsRepo: {
      dashboardStats: vi.fn(() => ({
        daily_api_spend: 0,
        api_budget: 5,
      })),
    },
  } as never);

  ctx.getStrategyContext = () =>
    ({
      rules: { setupType: "momentum" },
      riskConfig: {
        maxPositionUsd: 500,
        maxAiSpendUsd: 5,
        humanApprovalRequired: options?.humanApprovalRequired ?? false,
      },
      timeframe: { holdingStyle: "multi_day_swing", maxHoldDays: 5 },
    }) as never;
  ctx.resolveBrokerAccountId = () => "broker-1";
  ctx.totalAllocatedUsd = () => 5000;
  return ctx;
}

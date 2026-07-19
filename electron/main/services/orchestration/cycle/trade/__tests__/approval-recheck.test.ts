import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { registerDefaultEngines } from "../../../../pipeline/engines/signal-registry/register-default-engines";
import { RiskEngine } from "../../../../risk/risk-engine";
import { BrokerAllocationGate } from "../../../../risk/broker-allocation-gate";
import { ExitPolicyEvaluator } from "../../../../risk/exit-policy-evaluator";
import { OrderPolicyGate } from "../../../policy/order-policy-gate";
import { CandidateValidationService } from "../../../policy/candidate-validation-service";
import { TradingCycleContext } from "../../trading-cycle-context";
import { runApprovalRecheck } from "../approval-recheck";
import * as orderPlacerModule from "../order-placer";
import * as enginePromptModule from "../../../../pipeline/execution/engine-prompt-injector";
import * as postDecisionGatesModule from "../post-decision-gates";

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

describe("runApprovalRecheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects trade when fresh decision is skip", async () => {
    const ctx = createContext({ decisionAction: "skip" });

    await runApprovalRecheck(ctx, {
      sessionId: "session-1",
      instrumentSymbol: "NVDA",
      approvalId: "approval-1",
      instrumentClass: "stock",
    });

    expect(ctx.deps.capitalReservation.releaseByApproval).toHaveBeenCalledWith(
      "approval-1",
    );
    expect(ctx.deps.tradesRepo.updateStatus).toHaveBeenCalledWith(
      "trade-1",
      "rejected",
      0,
    );
    expect(ctx.deps.tradesRepo.markOpen).not.toHaveBeenCalled();
  });

  it("opens trade after successful recheck and order placement", async () => {
    const ctx = createContext({ decisionAction: "buy" });
    vi.spyOn(postDecisionGatesModule, "runPostDecisionGates").mockResolvedValue(
      {
        quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
        riskOrder: {
          instrumentSymbol: "NVDA",
          instrumentType: "stock",
          side: "BUY",
          sizeUsd: 500,
        },
        brokerAccountId: "broker-1",
      },
    );
    vi.spyOn(enginePromptModule, "runEngineForWorker").mockReturnValue({
      allowed: true,
    });
    vi.spyOn(orderPlacerModule, "placeRoutedOrder").mockResolvedValue({
      brokerOrderId: "mock-order-1",
      filledAvgPrice: 185.5,
    });

    await runApprovalRecheck(ctx, {
      sessionId: "session-1",
      instrumentSymbol: "NVDA",
      approvalId: "approval-1",
      instrumentClass: "stock",
    });

    expect(ctx.deps.tradesRepo.markOpen).toHaveBeenCalled();
    expect(
      ctx.deps.capitalReservation.convertApprovalToOpenOrder,
    ).toHaveBeenCalledWith("approval-1", "trade-1");
    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "trade_opened",
      expect.objectContaining({ id: "trade-1" }),
    );
  });

  it("returns early when runtime is inactive", async () => {
    const ctx = createContext({ runtimeActive: false });

    await runApprovalRecheck(ctx, {
      sessionId: "session-1",
      instrumentSymbol: "NVDA",
      approvalId: "approval-1",
      instrumentClass: "stock",
    });

    expect(ctx.deps.ai.runPlan).not.toHaveBeenCalled();
  });
});

function createContext(options?: {
  decisionAction?: "buy" | "skip";
  runtimeActive?: boolean;
}) {
  const trade = makeTrade();
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      requireById: () => ({
        id: "session-1",
        instrumentClasses: ["stock"],
        instrumentScope: "NVDA",
        selectionMode: "manual_shortlist",
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
          maxAiSpendUsd: 5,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
          atrStopMultiplier: null,
          humanApprovalRequired: true,
        },
        timeframe: {
          holdingStyle: "intraday_flat",
          maxHoldDays: 1,
        },
      }),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: {
      runtimeStatus: () =>
        options?.runtimeActive === false ? "paused" : "active",
      emit: vi.fn(),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tradeApprovalsRepo: {
      require: vi.fn(() => ({ id: "approval-1", tradeId: trade.id })),
    },
    tradesRepo: {
      require: vi.fn(() => trade),
      patchPendingExecution: vi.fn(),
      patchAiCost: vi.fn(),
      markOpen: vi.fn((id, brokerOrderId, filledAvgPrice) => ({
        ...trade,
        id,
        status: "open",
        broker_order_id: brokerOrderId,
        entry_price: filledAvgPrice,
      })),
      updateStatus: vi.fn((id, status) => ({ ...trade, id, status })),
      checkDuplicateClientOrder: vi.fn(() => false),
      checkInstrumentConflict: vi.fn(() => false),
    },
    agentRunsRepo: { insert: vi.fn() },
    agentMessagesRepo: { insert: vi.fn() },
    capitalReservation: {
      runInTransaction: <T>(fn: () => T) => fn(),
      releaseByApproval: vi.fn(),
      updateReservedAmountForApproval: vi.fn(),
      convertApprovalToOpenOrder: vi.fn(),
      convertOrderToPosition: vi.fn(),
    },
    statsRepo: {
      dashboardStats: () => ({
        daily_api_spend: 0,
        api_budget: 5,
        portfolio_value: 5000,
      }),
    },
    brokerRouting: {
      resolveAdapter: vi.fn(async () => ({
        adapter: {
          brokerType: "mock",
          supportedInstrumentClasses: ["stock"],
          placeOrder: vi.fn(async () => ({
            brokerOrderId: "mock-order-1",
            filledAvgPrice: 185.5,
          })),
        },
        brokerAccountId: "broker-1",
      })),
      resolveBrokerAccountId: () => "broker-1",
    },
    brokerRegistry: {
      get: vi.fn(async () => ({
        brokerType: "mock",
        supportedInstrumentClasses: ["stock"],
      })),
    },
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    },
    brokerAllocationGate: {
      checkOrderFits: () => ({ ok: true }),
      checkInstrumentConflict: () => ({ ok: true }),
    },
    capitalReservationsRepo: {},
    sessionBrokerAssignmentsRepo: {
      listAssignments: () => [
        { brokerAccountId: "broker-1", allocatedUsd: 5000 },
      ],
      listBrokerAccountIds: () => ["broker-1"],
    },
    brokerAccountsRepo: {
      find: () => ({
        id: "broker-1",
        supportedInstrumentClasses: ["stock"],
      }),
    },
    ai: {
      runPlan: vi.fn(async () =>
        makePipeline(options?.decisionAction ?? "buy"),
      ),
    },
  } as never);

  ctx.getStrategyContext = () =>
    ({
      rules: { setupType: "momentum" },
      riskConfig: {
        maxPositionUsd: 500,
        maxAiSpendUsd: 5,
        humanApprovalRequired: true,
        stopLossPct: 2,
        takeProfitPct: 4,
        atrStopMultiplier: null,
      },
      timeframe: { holdingStyle: "multi_day_swing", maxHoldDays: 5 },
    }) as never;
  ctx.totalAllocatedUsd = () => 5000;
  ctx.resolveBrokerAccountId = () => "broker-1";
  return ctx;
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

function makePipeline(action: "buy" | "skip") {
  const decision = {
    symbol: "NVDA",
    action,
    executionStrategy: "breakout",
    entryPrice: 185,
    confidence: 0.85,
    reasoning: action === "skip" ? "stale setup" : "setup aligns",
  };
  const stub = (role: string, output: unknown) => ({
    run: {
      id: crypto.randomUUID(),
      trade_id: "trade-1",
      agent_type: role,
      model: "test",
      provider_key: "test",
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 0.01,
      output_text: "{}",
      duration_ms: 1,
      created_at: new Date().toISOString(),
    },
    message: {
      id: crypto.randomUUID(),
      agent_run_id: crypto.randomUUID(),
      session_id: "session-1",
      trade_id: "trade-1",
      cycle_id: "cycle-1",
      role,
      provider_key: "test",
      model_id: "test",
      messages_json: "[]",
      thinking_json: null,
      tool_calls_json: "[]",
      output_json: "{}",
      output_schema_name: `${role}Signal`,
      parse_fallback: false,
      strategy_snapshot_json: "{}",
      market_snapshot_json: null,
      created_at: new Date().toISOString(),
    },
    output: output,
  });

  return {
    state: {
      quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
      technical: stub("technical", {}),
      fundamental: stub("fundamental", {}),
      review: stub("review", { recommendation: "proceed" }),
      decision: stub("decision", decision),
      riskOrder: {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
      },
      brokerAccountId: "broker-1",
    },
    totalAiCostUsd: 0.2,
  };
}

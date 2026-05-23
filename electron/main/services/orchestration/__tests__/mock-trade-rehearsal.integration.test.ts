import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentResult } from "../../llm/ai-runtime-types";
import type { TradePipelineResult } from "../../pipeline/analysis/types";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/pipeline-signals";
import type { Trade, WorkspaceSession } from "@/lib/types";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";
import { registerDefaultEngines } from "../../signal/registry/register-default-engines";
import { ExitPolicyEvaluator } from "../../risk/exit-policy-evaluator";
import { RiskEngine } from "../../risk/risk-engine";
import { BrokerAllocationGate } from "../../risk/broker-allocation-gate";
import { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";
import { OrderPolicyGate } from "../policy/order-policy-gate";
import { CandidateValidationService } from "../policy/candidate-validation-service";
import { OrchestratorContext } from "../cycle/orchestrator-context";
import { executeTradeCycle } from "../cycle/trade/trade-cycle";
import * as runTradePipelineModule from "../cycle/trade/run-trade-pipeline";

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

describe("mock trade rehearsal integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mock broker clean_breakout completes a trade cycle with status open", async () => {
    const sessionId = "session-1";
    const harness = createHarness(sessionId);
    const ctx = new OrchestratorContext(
      sessionId,
      harness.deps as unknown as import("../../session/session-types").OrchestratorDeps,
    );
    const cycleId = crypto.randomUUID();
    const quote = await harness.mockAdapter.getMarketSnapshot("NVDA");

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue(
      makeMockBuyPipeline(quote.price),
    );

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId,
      instrument: {
        symbol: "NVDA",
        instrumentClass: "stock",
      },
    });

    const trades = harness.listTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0]?.status).toBe("open");
    expect(trades[0]?.broker_order_id).toMatch(/^mock_/);
    expect(trades[0]?.instrumentSymbol).toBe("NVDA");
    expect(trades[0]?.opened_at).not.toBeNull();
  });
});

function createHarness(sessionId: string) {
  const trades = new Map<string, Trade>();
  const eventBus = new EventBus();
  eventBus.setRuntimeStatus(sessionId, "active");
  const mockAdapter = MockMarketSimulator.createAdapter("clean_breakout");

  const session: WorkspaceSession = {
    id: sessionId,
    name: "Mock Rehearsal",
    objective: "Verify mock broker happy path",
    status: "active",
    isFocused: true,
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "NVDA",
    defaultSearchProviderId: null,
    executionMode: "paper_only",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const deps = {
    sessionRepo: {
      requireById: () => session,
      getStatus: () => session.status,
      setStatus: (status: WorkspaceSession["status"]) => {
        session.status = status;
        return status;
      },
      uptimeMin: () => 0,
    },
    sessionStrategiesRepo: {} as never,
    strategyContextService: {
      get: () => ({
        researchPosture: {},
        rules: { sideBias: "long_only" },
        riskConfig: {
          maxPositionUsd: 1000,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          waitForOpenThreshold: 0,
          humanApprovalRequired: false,
        },
        timeframe: {
          holdingStyle: "intraday_flat",
          maxHoldDays: 1,
        },
        aiSettings: {
          workerGuidanceMarkdown: "",
        },
      }),
    },
    tradesRepo: {
      insert: (trade: Trade) => {
        trades.set(trade.id, trade);
      },
      require: (id: string) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`Trade ${id} not found`);
        return trade;
      },
      markOpen: (id: string, brokerOrderId: string, filledAvgPrice: number) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`Trade ${id} not found`);
        const opened: Trade = {
          ...trade,
          status: "open",
          broker_order_id: brokerOrderId,
          entry_price: filledAvgPrice,
          opened_at: new Date().toISOString(),
        };
        trades.set(id, opened);
        return opened;
      },
      patchPendingExecution: (id: string, patch: Partial<Trade>) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`Trade ${id} not found`);
        const next = { ...trade, ...patch };
        trades.set(id, next);
        return next;
      },
      updateStatus: (id: string, status: Trade["status"], finalPnlUsd: number) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`Trade ${id} not found`);
        const next = {
          ...trade,
          status,
          final_pnl_usd: finalPnlUsd,
          closed_at: new Date().toISOString(),
        };
        trades.set(id, next);
        return next;
      },
      checkDuplicateClientOrder: () => false,
      checkInstrumentConflict: () => false,
    },
    tradeApprovalsRepo: {} as never,
    agentRunsRepo: { insert: vi.fn() },
    agentMessagesRepo: { insert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    statsRepo: {
      dashboardStats: () => ({
        daily_api_spend: 0,
        api_budget: 10,
        portfolio_value: 5000,
        portfolio_value_source: "broker",
        portfolio_broker_count: 1,
        unrealized_pnl: 0,
        session_uptime_min: 0,
      }),
    },
    sessionAiPhasesRepo: {} as never,
    sessionSelectorSettingsRepo: {
      get: () => ({ aiPickerEnabled: false, noInstrumentRetryMinutes: null }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn((step) => step),
      get: () => null,
      getLatestByCycle: () => [],
      getLatestBySession: () => [],
      clearFailed: vi.fn(),
    },
    providerAccountsRepo: {} as never,
    workspacePreferencesRepo: {} as never,
    capitalReservationsRepo: {} as never,
    capitalReservation: {
      reserveForOrder: vi.fn(),
      releaseByApproval: vi.fn(),
      convertApprovalToOpenOrder: vi.fn(),
      convertOrderToPosition: vi.fn(),
      releaseOnFailure: vi.fn(),
      listActiveBySession: () => [],
    },
    brokerRoutingRepo: {} as never,
    sessionBrokerAssignmentsRepo: {
      listAssignments: () => [{ brokerAccountId: "mock-broker", allocatedUsd: 5000 }],
    },
    brokerAccountsRepo: {} as never,
    brokerRegistry: {} as never,
    brokerRouting: {
      resolveAdapter: async () => ({
        adapter: mockAdapter,
        brokerAccountId: "mock-broker",
      }),
      resolveBrokerAccountId: () => "mock-broker",
    },
    brokerBalanceCache: {} as never,
    brokerCapital: {} as never,
    brokerAllocationGate: {} as never,
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    },
    ai: {} as never,
    riskEngine: {} as never,
    bus: eventBus,
    logger: createLogger("mock-trade-rehearsal-test"),
    instrumentCacheRepo: {} as never,
  };

  return {
    deps,
    mockAdapter,
    listTrades: () => [...trades.values()],
  };
}

function makeMockBuyPipeline(entryPrice: number): TradePipelineResult {
  const technical: TechnicalSignal = {
    symbol: "NVDA",
    trendDirection: "bullish",
    trendStrength: 0.91,
    momentumScore: 0.87,
    volumeScore: 0.74,
    volumeSignal: "accumulation",
    patternName: "breakout",
    patternStrength: 0.78,
    nearestSupport: 183.5,
    nearestResistance: 188,
    timeframeAlignment: 0.82,
    rawSummary: "bullish trend continuation",
  };
  const fundamental: FundamentalSignal = {
    symbol: "NVDA",
    catalystType: "partnership",
    catalystStrength: 0.72,
    catalystFreshness: 0.81,
    catalystScore: 0.76,
    catalystSummary: "new channel checks point to accelerating demand",
    earningsScore: null,
    sentimentScore: 0.68,
    contradictionRisk: 0.12,
    rawSummary: "positive catalyst backdrop",
  };
  const review: ReviewSignal = {
    symbol: "NVDA",
    technicalFundamentalConflict: 0.12,
    conflictExplanation: "signals align",
    tailRisks: [],
    overallRisk: "low",
    recommendation: "proceed",
    rawSummary: "no material conflict",
  };
  const decision: TradeSignal = {
    symbol: "NVDA",
    action: "buy",
    executionStrategy: "breakout",
    entryPrice,
    confidence: 0.82,
    reasoning: "trend, catalyst, and review all align",
  };

  return {
    state: {
      quoteSnapshot: {
        price: entryPrice,
        timestamp: new Date().toISOString(),
      },
      technical: makeStubAgentResult("technical", technical),
      fundamental: makeStubAgentResult("fundamental", fundamental),
      review: makeStubAgentResult("review", review),
      decision: makeStubAgentResult("decision", decision),
      riskOrder: {
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 600,
      },
    },
    totalAiCostUsd: 0.18,
  };
}

function makeStubAgentResult<T>(role: string, output: T): AgentResult<T> {
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  return {
    run: {
      id: runId,
      trade_id: null,
      agent_type: role,
      model: "test-model",
      provider_key: "test-provider",
      finish_reason: "stop",
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.01,
      output_text: JSON.stringify(output),
      duration_ms: 100,
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
      output_json: JSON.stringify(output),
      output_schema_name: `${role}Signal`,
      parse_fallback: false,
      strategy_snapshot_json: "{}",
      market_snapshot_json: null,
      created_at: now,
    },
    output,
  };
}
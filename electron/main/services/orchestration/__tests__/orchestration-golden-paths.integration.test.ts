import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../pipeline/worker-tools/resolve-mock-tool-context", () => ({
  resolveMockToolContext: vi.fn(async () => ({
    isMockSession: false,
    executionTier: "live",
  })),
}));

import type { LLMRunResult } from "../../llm/llm-types";
import type { InstrumentAnalysisResult } from "../../pipeline/analysis/types";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { Trade, WorkspaceSession } from "@/lib/types";
import { createOutcomeError } from "../cycle/runtime-outcome";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";
import { registerDefaultEngines } from "../../signal/registry/register-default-engines";
import { registerDefaultInstrumentAnalyses } from "../../pipeline/implementations/registry/register-analyses";
import { ExitPolicyEvaluator } from "../../risk/exit-policy-evaluator";
import { RiskEngine } from "../../risk/risk-engine";
import { BrokerAllocationGate } from "../../risk/broker-allocation-gate";
import { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";
import { OrderPolicyGate } from "../policy/order-policy-gate";
import { CandidateValidationService } from "../policy/candidate-validation-service";
import { TradingCycleContext } from "../cycle/trading-cycle-context";
import { AgentOrchestrator } from "../cycle/agent-orchestrator";
import { executeTradeCycle } from "../cycle/trade/trade-cycle";
import * as runTradePipelineModule from "../cycle/trade/run-trade-pipeline";
import * as effectRunnerModule from "../cycle/trade/effect-runner";
import * as orchestratorStepModule from "../cycle/orchestrator-step";

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

// The orchestrator resolves a session's pipeline from its experience.
registerDefaultInstrumentAnalyses();

describe("orchestration golden paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("approval-required path reserves capital then opens trade after approval", async () => {
    const harness = createHarness("session-approval", {
      humanApprovalRequired: true,
    });
    const ctx = new TradingCycleContext(
      harness.session.id,
      harness.deps as never,
    );
    const cycleId = crypto.randomUUID();
    const quote = await harness.mockAdapter.getMarketSnapshot("NVDA");

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makeMockBuyPipeline(quote.price),
    });
    vi.spyOn(effectRunnerModule, "runApprovalAndCapital").mockResolvedValue({
      approved: true,
      approvalId: "approval-1",
    });
    vi.spyOn(orchestratorStepModule, "runOrchestratorStep").mockResolvedValue({
      status: "ok",
      value: { brokerOrderId: "mock-order-1", filledAvgPrice: quote.price },
    });

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId,
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
    });

    expect(harness.listTrades()[0]?.status).toBe("open");
  });

  it("approval rejection releases capital and keeps session active", async () => {
    const harness = createHarness("session-reject", {
      humanApprovalRequired: true,
    });
    const ctx = new TradingCycleContext(
      harness.session.id,
      harness.deps as never,
    );
    const cycleId = crypto.randomUUID();
    const quote = await harness.mockAdapter.getMarketSnapshot("NVDA");
    const approvalSpy = vi
      .spyOn(effectRunnerModule, "runApprovalAndCapital")
      .mockResolvedValue({
        approved: false,
        approvalId: "approval-1",
      });

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makeMockBuyPipeline(quote.price),
    });

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId,
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
    });

    expect(approvalSpy).toHaveBeenCalled();
    expect(harness.listTrades()[0]?.status).not.toBe("open");
    expect(harness.session.status).toBe("active");
  });

  it("broker down during order rejects trade and releases capital", async () => {
    const harness = createHarness("session-broker-down");
    const ctx = new TradingCycleContext(
      harness.session.id,
      harness.deps as never,
    );
    ctx.scheduleSelectorCycle = vi.fn(async () => undefined);
    const quote = await harness.mockAdapter.getMarketSnapshot("NVDA");

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makeMockBuyPipeline(quote.price),
    });
    vi.spyOn(effectRunnerModule, "placeBrokerOrder").mockImplementation(
      async () => {
        throw createOutcomeError("broker unreachable", "BROKER_UNREACHABLE", {
          outcome: "transient",
          reasonCategory: "provider_transient",
          retryable: true,
        });
      },
    );

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId: crypto.randomUUID(),
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
    });

    expect(harness.listTrades()[0]?.status).toBe("rejected");
    expect(harness.deps.capitalReservation.releaseOnFailure).toHaveBeenCalled();
    expect(harness.session.status).toBe("active");
  });

  it("signal FIFO processes deliveries one at a time", async () => {
    const harness = createHarness("session-fifo", { signalDriven: true });
    const orchestrator = new AgentOrchestrator(
      harness.session.id,
      harness.deps as never,
    );
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    vi.spyOn(
      orchestrator as never as {
        executeSelectorCycle: (ctx: {
          signalTrigger?: { deliveryId?: string };
        }) => Promise<void>;
      },
      "executeSelectorCycle",
    ).mockImplementation(async (ctx) => {
      order.push(String(ctx.signalTrigger?.deliveryId ?? "unknown"));
      if (order.length === 1) {
        await firstGate;
      }
    });

    await orchestrator.start();

    harness.emitSignalDelivery("delivery-1", "signal-1");
    harness.emitSignalDelivery("delivery-2", "signal-2");
    await Promise.resolve();

    expect(order).toEqual(["delivery-1"]);

    releaseFirst();
    await (
      orchestrator as never as {
        ctx: { signalDeliveryQueue: { onIdle: () => Promise<void> } };
      }
    ).ctx.signalDeliveryQueue.onIdle();

    expect(order).toEqual(["delivery-1", "delivery-2"]);
    await orchestrator.stop();
  });
});

function createHarness(
  sessionId: string,
  options?: {
    humanApprovalRequired?: boolean;
    signalDriven?: boolean;
  },
) {
  const trades = new Map<string, Trade>();
  let pendingTradeId: string | null = null;
  const eventBus = new EventBus();
  eventBus.setRuntimeStatus(sessionId, "active");
  const mockAdapter = MockMarketSimulator.createAdapter("clean_breakout");

  const session: WorkspaceSession = {
    id: sessionId,
    name: "Golden Path Session",
    objective: "Verify orchestration golden paths",
    status: "active",
    isFocused: true,
    selectionMode: options?.signalDriven
      ? "manual_shortlist"
      : "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: options?.signalDriven ? "" : "NVDA",
    defaultSearchProviderId: null,
    executionMode: "paper_only",
    experienceId: "edgar-catalyst",
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
    strategyContextService: {
      get: () => ({
        researchPosture: {},
        rules: { sideBias: "long_only", setupType: "momentum" },
        riskConfig: {
          maxPositionUsd: 1000,
          maxConcurrentTrades: 3,
          maxConsecutiveLosers: 5,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
          humanApprovalRequired: options?.humanApprovalRequired ?? false,
        },
        timeframe: {
          holdingStyle: "intraday_flat",
          primaryTradingTimeframe: "15m",
          targetHoldDays: 1,
          maxHoldDays: 1,
          timeframeNotes: "",
        },
        aiSettings: { workerGuidanceMarkdown: "" },
      }),
    },
    tradesRepo: {
      insert: (trade: Trade) => {
        trades.set(trade.id, trade);
        pendingTradeId = trade.id;
      },
      require: (id: string) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`Trade ${id} not found`);
        return trade;
      },
      markOpen: (id: string, brokerOrderId: string, filledAvgPrice: number) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`Trade ${id} not found`);
        const opened = {
          ...trade,
          status: "open" as const,
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
      updateStatus: (
        id: string,
        status: Trade["status"],
        finalPnlUsd: number,
      ) => {
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
      listOpenAndPending: () =>
        [...trades.values()].filter(
          (trade) => trade.status === "open" || trade.status === "pending",
        ),
    },
    tradeApprovalsRepo: {
      createPending: vi.fn(() => ({ id: "approval-1" })),
    },
    agentRunsRepo: { insert: vi.fn() },
    agentMessagesRepo: { insert: vi.fn() },
    eventsRepo: { insert: vi.fn((event) => event) },
    statsRepo: {
      dashboardStats: () => ({
        daily_api_spend: 0,
        api_budget: 10,
        portfolio_value: 5000,
      }),
    },
    sessionAiPhasesRepo: {} as never,
    sessionSelectorSettingsRepo: {
      get: () => ({ aiPickerEnabled: false, noInstrumentRetryMinutes: 5 }),
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
      reserveForApproval: vi.fn(),
      releaseByApproval: vi.fn(),
      convertApprovalToOpenOrder: vi.fn(),
      convertOrderToPosition: vi.fn(),
      releaseOnFailure: vi.fn(),
      releaseOnClose: vi.fn(),
      listActiveBySession: () => [],
    },
    brokerRoutingRepo: {} as never,
    sessionBrokerAssignmentsRepo: {
      listAssignments: () => [
        { brokerAccountId: "mock-broker", allocatedUsd: 5000 },
      ],
      listBrokerAccountIds: () => ["mock-broker"],
    },
    brokerAccountsRepo: {
      find: () => ({
        id: "mock-broker",
        supportedInstrumentClasses: ["stock"],
      }),
    },
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
    logger: createLogger("golden-path-test"),
    instrumentCacheRepo: {} as never,
    signalSourcesRepo: {
      subscribedSourceTypesForSession: () =>
        options?.signalDriven ? ["edgar_8k"] : [],
    },
    signalDeliveriesRepo: {
      getDetailedById: (id: string) => ({
        delivery: { id },
        event: {
          id: id.replace("delivery", "signal"),
          sourceType: "edgar_8k",
          ticker: "NVDA",
          companyName: "NVIDIA",
          documentUrl: "https://example.com",
          accessionNumber: id,
          payloadJson: "{}",
        },
      }),
      updateStatus: vi.fn(),
    },
    signalDeliveryLifecycle: {
      complete: vi.fn(),
      expireIfStillProcessing: vi.fn(),
    },
  };

  return {
    session,
    deps,
    mockAdapter,
    pendingTradeId: () => pendingTradeId,
    getPendingTradeId: () => pendingTradeId,
    listTrades: () => [...trades.values()],
    emitSignalDelivery: (deliveryId: string, signalId: string) => {
      eventBus.emit("signal_delivery_updated", {
        deliveryId,
        sessionId,
        signalId,
        status: "queued",
        statusBucket: "pending",
      });
    },
  };
}

function makeMockBuyPipeline(entryPrice: number): InstrumentAnalysisResult {
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
    catalystSummary: "demand accelerating",
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
      quoteSnapshot: { price: entryPrice, timestamp: new Date().toISOString() },
      technical: stubRun("technical", technical),
      fundamental: stubRun("fundamental", fundamental),
      review: stubRun("review", review),
      decision: stubRun("decision", decision),
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

function stubRun<T>(role: string, output: T): LLMRunResult<T> {
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

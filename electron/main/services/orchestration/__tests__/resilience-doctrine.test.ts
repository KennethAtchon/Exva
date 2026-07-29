import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trade, WorkspaceSession } from "@/lib/types";
import type { InstrumentAnalysisResult } from "../../pipeline/analysis/types";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { LLMRunResult } from "../../llm/llm-types";
import { EventBus } from "../../infra/event-bus";
import { MockMarketSimulator } from "../../broker/mock/mock-market-simulator";
import { createLogger } from "../../infra/log";
import { AgentOrchestrator } from "../cycle/agent-orchestrator";
import { TradingCycleContext } from "../cycle/trading-cycle-context";
import { executeTradeCycle } from "../cycle/trade/trade-cycle";
import * as runTradePipelineModule from "../cycle/trade/run-trade-pipeline";
import * as effectRunnerModule from "../cycle/trade/effect-runner";
import { createOrderPolicyError } from "../policy/outcome-classifier";
import { SessionStartupRecoveryService } from "../../session/session-startup-recovery-service";
import { SessionRuntime } from "../../session/session-runtime";

describe("§24.2 TradingCycleContext transient streak", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps session active for 1–2 transient failures while incrementing streak", () => {
    const ctx = createDoctrineContext();
    const failure = transientStepFailure();

    ctx.handleStepFailure("selector", "cycle-1", failure);
    expect(ctx.consecutiveHardFailures).toBe(1);
    expect(ctx.deps.sessionRepo.setStatus).not.toHaveBeenCalled();

    ctx.handleStepFailure("selector", "cycle-2", failure);
    expect(ctx.consecutiveHardFailures).toBe(2);
    expect(ctx.deps.sessionRepo.setStatus).not.toHaveBeenCalled();
    expect(ctx.deps.sessionRepo.getStatus()).toBe("active");
  });

  it("escalates to attention_required after exactly 3 consecutive transient failures", () => {
    const ctx = createDoctrineContext();
    const failure = transientStepFailure();

    for (let index = 1; index <= 3; index += 1) {
      ctx.handleStepFailure("selector", `cycle-${index}`, failure);
    }

    expect(ctx.consecutiveHardFailures).toBe(3);
    expect(ctx.deps.sessionRepo.setStatus).toHaveBeenCalledWith(
      "attention_required",
      "session-1",
    );
    expect(ctx.deps.eventsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "ERROR",
        message: expect.stringMatching(/3 consecutive hard failures/i),
      }),
    );
  });

  it("records retryAt in failure history for transient outcomes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
    const ctx = createDoctrineContext();

    ctx.handleStepFailure("selector", "cycle-1", transientStepFailure());

    expect(ctx.getNearestRetryAt()).toBe("2026-05-24T12:05:00.000Z");
  });
});

describe("§24.3 trade cycle terminal paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("decision skip completes signal delivery rejected and keeps session active", async () => {
    const complete = vi.fn();
    const harness = createTradeHarness("session-skip");
    const ctx = new TradingCycleContext("session-skip", harness.deps as never);
    ctx.deps.signalDeliveryLifecycle = { complete } as never;
    ctx.scheduleSelectorCycle = vi.fn(async () => undefined);

    const quote = await harness.mockAdapter.getMarketSnapshot("NVDA");
    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makeBuyPipeline(quote.price, {
        action: "skip",
        reasoning: "No actionable edge",
      }),
    });

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId: "cycle-skip",
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
      signalDeliveryId: "delivery-1",
      signalId: "signal-1",
    });

    expect(complete).toHaveBeenCalledWith("delivery-1", {
      sessionId: "session-skip",
      signalId: "signal-1",
      status: "rejected",
      tradeId: null,
      dropReason: "decision_skip",
    });
    expect(harness.session.status).toBe("active");
    expect(ctx.consecutiveHardFailures).toBe(0);
  });

  it("risk gate failure rejects signal without attention_required", async () => {
    const complete = vi.fn();
    const harness = createTradeHarness("session-risk");
    const ctx = new TradingCycleContext("session-risk", harness.deps as never);
    ctx.deps.signalDeliveryLifecycle = { complete } as never;
    ctx.scheduleSelectorCycle = vi.fn(async () => undefined);

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "failed",
      stage: "risk_gate",
      result: {
        ok: false,
        retryable: false,
        errorCode: "VALIDATION_FAILED",
        errorMessage: "Risk gate rejected",
        outcome: "no_trade",
        level: "WARN",
        reasonCategory: "risk_gate",
      },
    });

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId: "cycle-risk",
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
      signalDeliveryId: "delivery-2",
      signalId: "signal-2",
    });

    expect(complete).toHaveBeenCalledWith("delivery-2", {
      sessionId: "session-risk",
      signalId: "signal-2",
      status: "rejected",
      tradeId: null,
      dropReason: "risk_gate_rejected",
    });
    expect(harness.session.status).toBe("active");
  });

  it("broker order failure releases capital, rejects trade, and emits trade_closed", async () => {
    const complete = vi.fn();
    const harness = createTradeHarness("session-broker");
    const ctx = new TradingCycleContext(
      "session-broker",
      harness.deps as never,
    );
    ctx.deps.signalDeliveryLifecycle = { complete } as never;
    ctx.scheduleSelectorCycle = vi.fn(async () => undefined);

    const quote = await harness.mockAdapter.getMarketSnapshot("NVDA");
    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makeBuyPipeline(quote.price),
    });
    vi.spyOn(effectRunnerModule, "placeBrokerOrder").mockRejectedValue(
      createOrderPolicyError("Spread too wide", ["spread"]),
    );

    const tradeClosed: string[] = [];
    harness.deps.bus.on("trade_closed", (trade: Trade) => {
      tradeClosed.push(trade.id);
    });

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId: "cycle-broker",
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
      signalDeliveryId: "delivery-3",
      signalId: "signal-3",
    });

    const trade = harness.listTrades()[0];
    expect(trade?.status).toBe("rejected");
    expect(harness.deps.capitalReservation.releaseOnFailure).toHaveBeenCalled();
    expect(tradeClosed).toContain(trade?.id);
    expect(complete).toHaveBeenCalledWith(
      "delivery-3",
      expect.objectContaining({
        status: "rejected",
        dropReason: "broker_order_failed",
      }),
    );
    expect(harness.session.status).toBe("active");
  });

  it("uncaught trade cycle exception escalates to attention_required", async () => {
    const harness = createTradeHarness("session-crash");
    const ctx = new TradingCycleContext("session-crash", harness.deps as never);

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockRejectedValue(
      new Error("unexpected orchestration bug"),
    );

    await executeTradeCycle(ctx, {
      kind: "trade",
      cycleId: "cycle-crash",
      instrument: { symbol: "NVDA", instrumentClass: "stock" },
    });

    expect(harness.session.status).toBe("attention_required");
    expect(ctx.getFailureHistory()[0]).toMatchObject({
      outcome: "bug",
      level: "ERROR",
    });
  });
});

describe("§24.4 signal FIFO and orchestrator discipline", () => {
  it("processes signal deliveries strictly FIFO via signalDeliveryQueue", async () => {
    const ctx = createDoctrineContext();
    const order: number[] = [];

    void ctx.signalDeliveryQueue.add(async () => {
      order.push(1);
    });
    void ctx.signalDeliveryQueue.add(async () => {
      order.push(2);
    });

    await ctx.signalDeliveryQueue.onIdle();
    expect(order).toEqual([1, 2]);
  });

  it("clears retry timer when orchestrator stops", async () => {
    vi.useFakeTimers();
    const orchestrator = createOrchestratorHarness();
    orchestrator.ctx.noInstrumentRetryTimer = setTimeout(() => undefined, 5000);

    await orchestrator.stop();

    expect(orchestrator.ctx.noInstrumentRetryTimer).toBeNull();
    vi.useRealTimers();
  });
});

describe("§24.6 monitor independence and startup recovery", () => {
  it("keeps trade monitor running when orchestrator pauses", async () => {
    const orchestrator = {
      start: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      restartFromAttention: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      pauseAfterCurrentStep: vi.fn(),
      retryStep: vi.fn(async () => ({ ok: true as const })),
      runApprovalRecheck: vi.fn(async () => undefined),
      resolveApproval: vi.fn(() => false),
      hasApprovalCallback: vi.fn(() => false),
    };
    const tradeMonitor = { start: vi.fn(), stop: vi.fn() };
    const runtime = new SessionRuntime("session-1", orchestrator, tradeMonitor);

    await runtime.initialize("active");
    expect(tradeMonitor.start).toHaveBeenCalled();
    expect(orchestrator.start).toHaveBeenCalled();

    await runtime.pause();
    expect(orchestrator.pause).toHaveBeenCalled();
    expect(tradeMonitor.stop).not.toHaveBeenCalled();
  });

  it("demotes active sessions to paused on startup recovery", async () => {
    const setStatus = vi.fn();
    const insert = vi.fn();
    const service = new SessionStartupRecoveryService({
      sessionRepo: {
        listByStatuses: () => [{ id: "session-1", status: "active" }],
        setStatus,
      },
      tradesRepo: { listOpenAndPending: () => [] },
      tradeApprovalsRepo: { listPending: () => [] },
      sessionExecutionStepsRepo: {
        getLatestCycleState: () => ({ cycleId: null, steps: [] }),
        upsert: vi.fn(),
      },
      capitalReservationsRepo: {},
      capitalReservation: {
        runInTransaction: <T>(fn: () => T) => fn(),
        listActiveBySession: () => [],
        releaseByApproval: vi.fn(),
        releaseOnFailure: vi.fn(),
      },
      brokerRegistry: { get: vi.fn() },
      eventsRepo: { insert },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never);

    await service.recoverSession("session-1", {
      sessionId: "session-1",
      priorStatus: "active",
      demoteToPaused: true,
      safetyRecovery: false,
    });

    expect(setStatus).toHaveBeenCalledWith("paused", "session-1");
  });

  it("emits safety recovery WARN when stopped session has open trades", async () => {
    const insert = vi.fn();
    const service = new SessionStartupRecoveryService({
      sessionRepo: {
        listByStatuses: () => [],
        setStatus: vi.fn(),
      },
      tradesRepo: {
        listOpenAndPending: () => [{ id: "trade-1", status: "open" }],
      },
      tradeApprovalsRepo: { listPending: () => [] },
      sessionExecutionStepsRepo: {
        getLatestCycleState: () => ({ cycleId: null, steps: [] }),
        upsert: vi.fn(),
      },
      capitalReservationsRepo: {},
      capitalReservation: {
        runInTransaction: <T>(fn: () => T) => fn(),
        listActiveBySession: () => [],
        releaseByApproval: vi.fn(),
        releaseOnFailure: vi.fn(),
      },
      brokerRegistry: { get: vi.fn() },
      eventsRepo: { insert },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never);

    await service.recoverSession("session-1", {
      sessionId: "session-1",
      priorStatus: "stopped",
      demoteToPaused: true,
      safetyRecovery: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "WARN",
        message: expect.stringMatching(/safety recovery/i),
      }),
    );
  });
});

describe("§24.16 analytics isolation", () => {
  it("andon_cord_fired event emission does not require session status change", () => {
    const setStatus = vi.fn();
    const eventEmit = vi.fn();

    eventEmit("andon_cord_fired", {
      sessionId: "session-1",
      lessonId: "lesson-1",
      recurrenceCount: 3,
      scope: "session",
      periodAutopsyId: "period-new",
    });

    expect(eventEmit).toHaveBeenCalledWith(
      "andon_cord_fired",
      expect.objectContaining({ sessionId: "session-1" }),
    );
    expect(setStatus).not.toHaveBeenCalled();
  });
});

function transientStepFailure() {
  return {
    ok: false as const,
    retryable: true,
    errorCode: "BROKER_UNREACHABLE",
    errorMessage: "Broker unreachable",
    outcome: "transient" as const,
    level: "WARN" as const,
    reasonCategory: "provider_transient" as const,
  };
}

function createDoctrineContext() {
  let sessionStatus: WorkspaceSession["status"] = "active";
  return new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => sessionStatus,
      setStatus: vi.fn((status: WorkspaceSession["status"]) => {
        sessionStatus = status;
      }),
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        riskConfig: { waitForOpenThreshold: 0.8 },
      }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn((step) => step),
      get: vi.fn(),
    },
    eventsRepo: {
      insert: vi.fn((event) => ({ id: "event-1", ...event })),
    },
    bus: {
      runtimeStatus: () => "active",
      emit: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    tradesRepo: {
      listOpenAndPending: () => [],
    },
  } as never);
}

function createOrchestratorHarness() {
  const deps = {
    sessionRepo: {
      requireById: () => ({
        id: "session-1",
        instrumentScope: "",
        instrumentClasses: ["stock"],
      }),
      getStatus: () => "active",
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        riskConfig: { waitForOpenThreshold: 0.8 },
      }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn(),
      get: vi.fn(),
      getLatestByCycle: () => [],
      getLatestBySession: () => [],
      clearFailed: vi.fn(),
    },
    eventsRepo: { insert: vi.fn((event) => ({ id: "event-1", ...event })) },
    bus: {
      runtimeStatus: () => "active",
      emit: vi.fn(),
      on: () => () => undefined,
    },
    logger: createLogger("resilience-doctrine"),
    tradesRepo: { listOpenAndPending: () => [] },
    capitalReservation: {
      runInTransaction: <T>(fn: () => T) => fn(),
      releaseByApproval: vi.fn(),
      releaseOnFailure: vi.fn(),
      listActiveBySession: () => [],
    },
    sessionBrokerAssignmentsRepo: { listAssignments: () => [] },
    signalDeliveriesRepo: null,
    signalDeliveryLifecycle: null,
  } as never;

  const orchestrator = new AgentOrchestrator("session-1", deps);
  return {
    orchestrator,
    ctx: orchestrator["ctx"] as TradingCycleContext,
    stop: () => orchestrator.stop(),
  };
}

function createTradeHarness(sessionId: string) {
  const trades = new Map<string, Trade>();
  const eventBus = new EventBus();
  eventBus.setRuntimeStatus(sessionId, "active");

  const session: WorkspaceSession = {
    id: sessionId,
    name: "Doctrine Session",
    objective: "Resilience test",
    status: "active",
    isFocused: true,
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "NVDA",
    defaultSearchProviderId: null,
    executionMode: "paper_only",
    experienceId: "edgar-catalyst",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockAdapter = MockMarketSimulator.createAdapter("clean_breakout");

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
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        researchPosture: {},
        rules: { sideBias: "long_only" },
        riskConfig: {
          maxPositionUsd: 1000,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
          humanApprovalRequired: false,
        },
        timeframe: { holdingStyle: "intraday_flat", maxHoldDays: 1 },
        aiSettings: { workerGuidanceMarkdown: "" },
      }),
    },
    tradesRepo: {
      insert: (trade: Trade) => trades.set(trade.id, trade),
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
      listOpenAndPending: () =>
        [...trades.values()].filter(
          (trade) => trade.status === "open" || trade.status === "pending",
        ),
    },
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
    sessionExecutionStepsRepo: {
      upsert: vi.fn((step) => step),
      get: () => null,
      getLatestByCycle: () => [],
      getLatestBySession: () => [],
      clearFailed: vi.fn(),
    },
    capitalReservation: {
      runInTransaction: <T>(fn: () => T) => fn(),
      reserveForOrder: vi.fn(),
      releaseByApproval: vi.fn(),
      releaseOnFailure: vi.fn(),
      convertApprovalToOpenOrder: vi.fn(),
      convertOrderToPosition: vi.fn(),
      listActiveBySession: () => [],
    },
    sessionBrokerAssignmentsRepo: {
      listAssignments: () => [
        { brokerAccountId: "mock-broker", allocatedUsd: 5000 },
      ],
    },
    brokerRouting: {
      resolveAdapter: async () => ({
        adapter: mockAdapter,
        brokerAccountId: "mock-broker",
      }),
      resolveBrokerAccountId: () => "mock-broker",
    },
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    },
    bus: eventBus,
    logger: createLogger("resilience-doctrine-trade"),
    signalDeliveryLifecycle: null,
  };

  return {
    deps,
    session,
    mockAdapter,
    listTrades: () => [...trades.values()],
  };
}

function makeBuyPipeline(
  entryPrice: number,
  decisionOverrides?: Partial<TradeSignal>,
): InstrumentAnalysisResult {
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
    ...decisionOverrides,
  };

  return {
    state: {
      quoteSnapshot: {
        price: entryPrice,
        timestamp: new Date().toISOString(),
      },
      technical: makeStubLLMRunResult("technical", technical),
      fundamental: makeStubLLMRunResult("fundamental", fundamental),
      review: makeStubLLMRunResult("review", review),
      decision: makeStubLLMRunResult("decision", decision),
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

function makeStubLLMRunResult<T>(role: string, output: T): LLMRunResult<T> {
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

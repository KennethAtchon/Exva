import { afterEach, describe, expect, it, vi } from "vitest";
import * as orchestratorStepModule from "../orchestrator-step";
import type {
  FundamentalSignal,
  ReviewSignal,
  TechnicalSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { InstrumentAnalysisResult } from "../../../pipeline/analysis/types";
import type { Trade } from "@/lib/types";
import { TradingCycleContext } from "../trading-cycle-context";
import { executeTradeCycle } from "../trade/trade-cycle";
import * as runTradePipelineModule from "../trade/run-trade-pipeline";
import * as effectRunnerModule from "../trade/effect-runner";

describe("executeTradeCycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns early when runtime is inactive", async () => {
    const ctx = createContext({ runtimeActive: false });
    const runPipeline = vi.spyOn(runTradePipelineModule, "runTradePipeline");

    await executeTradeCycle(ctx, makeContext());

    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("records no_trade failure and skips broker when decision is skip", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ runtimeActive: true });
    ctx.scheduleSelectorCycle = vi.fn(async () => undefined);

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makePipeline({ action: "skip", reasoning: "model skip" }),
    });
    const placeBrokerOrder = vi.spyOn(effectRunnerModule, "placeBrokerOrder");

    await executeTradeCycle(ctx, makeContext());

    expect(placeBrokerOrder).not.toHaveBeenCalled();
    expect(ctx.getFailureHistory()).toHaveLength(1);
    expect(ctx.getFailureHistory()[0]).toMatchObject({
      outcome: "no_trade",
      reasonCategory: "model_no_trade",
    });
  });

  it("releases capital and rejects trade when broker order fails", async () => {
    const ctx = createContext({ runtimeActive: true });
    ctx.scheduleSelectorCycle = vi.fn(async () => undefined);

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makePipeline(),
    });
    vi.spyOn(effectRunnerModule, "runApprovalAndCapital").mockResolvedValue({
      approved: true,
      approvalId: null,
    });
    vi.spyOn(
      orchestratorStepModule,
      "runOrchestratorStep",
    ).mockResolvedValueOnce({
      status: "failed",
      result: {
        ok: false,
        retryable: true,
        errorCode: "BROKER_UNREACHABLE",
        errorMessage: "broker down",
        outcome: "transient",
        level: "WARN",
        reasonCategory: "provider_transient",
      },
    });

    await executeTradeCycle(ctx, makeContext());

    expect(ctx.deps.capitalReservation.releaseOnFailure).toHaveBeenCalled();
    expect(ctx.deps.tradesRepo.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      "rejected",
      0,
    );
    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "trade_closed",
      expect.objectContaining({ status: "rejected" }),
    );
  });

  it("finalizes opened trade on successful broker placement", async () => {
    const ctx = createContext({ runtimeActive: true });
    const finalize = vi.spyOn(effectRunnerModule, "finalizeOpenedTrade");

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockResolvedValue({
      status: "ok",
      result: makePipeline(),
    });
    vi.spyOn(effectRunnerModule, "runApprovalAndCapital").mockResolvedValue({
      approved: true,
      approvalId: null,
    });
    vi.spyOn(
      orchestratorStepModule,
      "runOrchestratorStep",
    ).mockResolvedValueOnce({
      status: "ok",
      value: { brokerOrderId: "mock-order-1", filledAvgPrice: 186 },
    });

    await executeTradeCycle(ctx, makeContext());

    expect(finalize).toHaveBeenCalled();
  });

  it("sets attention_required when trade cycle crashes", async () => {
    const ctx = createContext({ runtimeActive: true });

    vi.spyOn(runTradePipelineModule, "runTradePipeline").mockRejectedValue(
      new Error("unexpected crash"),
    );

    await executeTradeCycle(ctx, makeContext());

    expect(ctx.deps.sessionRepo.setStatus).toHaveBeenCalledWith(
      "attention_required",
      "session-1",
    );
    expect(ctx.getFailureHistory()[0]).toMatchObject({
      outcome: "bug",
      reasonCategory: "unexpected_bug",
    });
  });
});

function makeContext() {
  return {
    kind: "trade" as const,
    cycleId: "cycle-1",
    instrument: { symbol: "NVDA", instrumentClass: "stock" as const },
  };
}

function makePipeline(
  decisionOverrides?: Partial<TradeSignal>,
): InstrumentAnalysisResult {
  const technical: TechnicalSignal = {
    symbol: "NVDA",
    trendDirection: "bullish",
    trendStrength: 0.9,
    momentumScore: 0.85,
    volumeScore: 0.7,
    volumeSignal: "accumulation",
    patternName: "breakout",
    patternStrength: 0.8,
    nearestSupport: 180,
    nearestResistance: 190,
    timeframeAlignment: 0.8,
    rawSummary: "bullish",
  };
  const fundamental: FundamentalSignal = {
    symbol: "NVDA",
    catalystType: "partnership",
    catalystStrength: 0.7,
    catalystFreshness: 0.8,
    catalystScore: 0.75,
    catalystSummary: "demand",
    earningsScore: null,
    sentimentScore: 0.65,
    contradictionRisk: 0.1,
    rawSummary: "positive",
  };
  const review: ReviewSignal = {
    symbol: "NVDA",
    technicalFundamentalConflict: 0.1,
    conflictExplanation: "aligned",
    tailRisks: [],
    overallRisk: "low",
    recommendation: "proceed",
    rawSummary: "ok",
  };
  const decision: TradeSignal = {
    symbol: "NVDA",
    action: "buy",
    executionStrategy: "breakout",
    entryPrice: 185,
    confidence: 0.85,
    reasoning: "setup aligns",
    ...decisionOverrides,
  };

  return {
    state: {
      quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
      technical: stubRun("technical", technical),
      fundamental: stubRun("fundamental", fundamental),
      review: stubRun("review", review),
      decision: stubRun("decision", decision),
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
      input_tokens: 10,
      output_tokens: 10,
      cost_usd: 0.01,
      output_text: JSON.stringify(output),
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

function createContext(options: { runtimeActive: boolean }) {
  const trades = new Map<string, Trade>();

  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => "active",
      setStatus: vi.fn(),
      requireById: () => ({
        id: "session-1",
        instrumentClasses: ["stock"],
      }),
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
          maxConcurrentTrades: 3,
          maxConsecutiveLosers: 5,
          stopLossPct: 5,
          takeProfitPct: 10,
          kellyFraction: 0.6,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
          humanApprovalRequired: false,
        },
        timeframe: { holdingStyle: "intraday_flat", maxHoldDays: 1 },
      }),
    },
    sessionExecutionStepsRepo: { upsert: vi.fn((step) => step) },
    eventsRepo: { insert: vi.fn((event) => event) },
    bus: {
      runtimeStatus: () => (options.runtimeActive ? "active" : "paused"),
      emit: vi.fn(),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tradesRepo: {
      insert: vi.fn((trade: Trade) => {
        trades.set(trade.id, trade);
      }),
      require: vi.fn((id: string) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`missing trade ${id}`);
        return trade;
      }),
      patchPendingExecution: vi.fn((id, patch) => {
        const trade = trades.get(id);
        if (trade) trades.set(id, { ...trade, ...patch });
      }),
      updateStatus: vi.fn((id, status, pnl) => {
        const trade = trades.get(id);
        if (!trade) throw new Error(`missing trade ${id}`);
        const next = { ...trade, status, final_pnl_usd: pnl };
        trades.set(id, next);
        return next;
      }),
      markOpen: vi.fn(),
      checkDuplicateClientOrder: vi.fn(() => false),
      checkInstrumentConflict: vi.fn(() => false),
      listOpenAndPending: vi.fn(() => []),
    },
    agentRunsRepo: { insert: vi.fn() },
    agentMessagesRepo: { insert: vi.fn() },
    capitalReservation: {
      reserveForOrder: vi.fn(),
      releaseOnFailure: vi.fn(),
      convertOrderToPosition: vi.fn(),
    },
    brokerRouting: {
      resolveBrokerAccountId: () => "broker-1",
      resolveAdapter: vi.fn(),
    },
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    },
    statsRepo: { dashboardStats: vi.fn(() => ({})) },
    signalDeliveryLifecycle: {
      complete: vi.fn(),
    },
  } as never);

  ctx.getStrategyContext = () =>
    ({
      rules: { setupType: "momentum" },
      riskConfig: {
        maxPositionUsd: 500,
        maxAiSpendUsd: 5,
        humanApprovalRequired: false,
      },
    }) as never;
  ctx.resolveBrokerAccountId = () => "broker-1";
  return ctx;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMRunResult } from "../../../../llm/llm-types";
import type { InstrumentAnalysisResult } from "../../../../pipeline/analysis/types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { TradingCycleContext } from "../../trading-cycle-context";
import {
  applyTradePipelineToContext,
  persistTradeAiRuns,
  requirePipelineAiResults,
  runTradePipeline,
} from "../run-trade-pipeline";

describe("run-trade-pipeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok result when ai plan completes", async () => {
    const ctx = createContext();
    const pipeline = makePipelineResult();

    ctx.deps.ai.runPlan = vi.fn(async (_id, opts) => {
      await opts.runStep("technical", async () => "technical-out");
      await opts.runStep("decision", async () => "decision-out");
      return pipeline;
    });

    const result = await runTradePipeline(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      vi.fn(),
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.result.totalAiCostUsd).toBe(0.2);
    }
  });

  it("returns paused when orchestrator step pauses mid-pipeline", async () => {
    const ctx = createContext();
    ctx.pauseAfterStep = true;

    ctx.deps.ai.runPlan = vi.fn(async (_id, opts) => {
      await opts.runStep("technical", async () => "out");
      return makePipelineResult();
    });

    const result = await runTradePipeline(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      vi.fn(),
    );

    expect(result.status).toBe("paused");
  });

  it("returns failed when a non-warn stage fails", async () => {
    const ctx = createContext();

    ctx.deps.ai.runPlan = vi.fn(async (_id, opts) => {
      await opts.runStep("risk_gate", async () => {
        throw Object.assign(new Error("concurrent cap"), {
          code: "VALIDATION_FAILED",
        });
      });
      return makePipelineResult();
    });

    const result = await runTradePipeline(
      ctx,
      {
        kind: "trade",
        cycleId: "cycle-1",
        instrument: { symbol: "NVDA", instrumentClass: "stock" },
      },
      vi.fn(),
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.stage).toBe("risk_gate");
    }
  });

  it("applyTradePipelineToContext copies pipeline state keys", () => {
    const context = {
      kind: "trade" as const,
      cycleId: "cycle-1",
      instrument: { symbol: "NVDA", instrumentClass: "stock" as const },
    };
    const pipeline = makePipelineResult();

    applyTradePipelineToContext(context, pipeline);

    expect(context).toMatchObject({
      decision: pipeline.state.decision,
      technical: pipeline.state.technical,
    });
  });

  it("persistTradeAiRuns inserts agent runs and messages", () => {
    const ctx = createContext();
    const run = makeStubRun("decision");

    persistTradeAiRuns(ctx, "trade-1", [run]);

    expect(ctx.deps.agentRunsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ trade_id: "trade-1", session_id: "session-1" }),
    );
    expect(ctx.deps.agentMessagesRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ trade_id: "trade-1", session_id: "session-1" }),
    );
  });

  it("requirePipelineAiResults throws when decision is missing", () => {
    const pipeline = makePipelineResult();
    delete (pipeline.state as { decision?: unknown }).decision;

    expect(() => requirePipelineAiResults(pipeline)).toThrow(
      /missing: decision/,
    );
  });
});

function makePipelineResult(): InstrumentAnalysisResult {
  const decision: TradeSignal = {
    symbol: "NVDA",
    action: "buy",
    executionStrategy: "breakout",
    entryPrice: 185,
    confidence: 0.85,
    reasoning: "setup aligns",
  };
  return {
    state: {
      quoteSnapshot: { price: 185, timestamp: new Date().toISOString() },
      technical: makeStubRun("technical"),
      fundamental: makeStubRun("fundamental"),
      review: makeStubRun("review"),
      decision: makeStubRun("decision", decision),
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

function makeStubRun<T>(role: string, output?: T): LLMRunResult<T> {
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
    output: (output ?? {}) as T,
  };
}

function createContext() {
  const ctx = new TradingCycleContext("session-1", {
    sessionRepo: {
      requireById: () => ({
        id: "session-1",
        instrumentClasses: ["stock"],
        instrumentScope: "NVDA",
        selectionMode: "manual_shortlist",
      }),
      getStatus: () => "active",
      setStatus: vi.fn(),
    },
    strategyContextService: {
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
        timeframe: { holdingStyle: "intraday_flat", maxHoldDays: 1 },
      }),
    },
    sessionSelectorSettingsRepo: {
      get: () => ({ noInstrumentRetryMinutes: 5 }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn((step) => step),
      get: vi.fn(),
      clearFailed: vi.fn(),
    },
    eventsRepo: {
      insert: vi.fn((event) => ({ id: "event-1", ...event })),
    },
    bus: {
      runtimeStatus: () => "active",
      setRuntimeStatus: vi.fn(),
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
      updateStatus: vi.fn(),
    },
    agentRunsRepo: { insert: vi.fn() },
    agentMessagesRepo: { insert: vi.fn() },
    ai: { runPlan: vi.fn() },
    sessionBrokerAssignmentsRepo: {
      listBrokerAccountIds: () => ["broker-1"],
    },
    brokerAccountsRepo: {
      find: () => ({
        id: "broker-1",
        supportedInstrumentClasses: ["stock"],
      }),
    },
  } as never);
  return ctx;
}

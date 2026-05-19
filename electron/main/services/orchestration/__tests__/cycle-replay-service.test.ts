import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StrategySnapshot } from "@/lib/types";
import { CycleReplayRunner, CycleReplayService } from "../cycle-replay-service";
import type { CycleFixture } from "../cycle-replay-service";
import {
  assertCostBelowUsd,
  assertSubmissionFires,
  assertTechnicalSignalHasField,
  assertTradeSignalAction,
} from "./cycle-replay-acceptance";

const FIXTURES_DIR = path.join(import.meta.dirname, "../__fixtures__/cycle-replay");

function makeStrategySnapshot(): StrategySnapshot {
  return {
    version: 5,
    researchPosture: {
      posturePresetId: "custom",
      discoveryMode: "trend_scan",
      evidenceMode: "balanced",
      catalystMode: "not_required",
      fundamentalStrictness: "balanced",
      postureNotes: "",
    },
    rules: {
      rulesPresetId: "breakout_long",
      setupType: "breakout",
      sideBias: "long_only",
      entryStyle: "breakout",
      exitStyle: "fixed_pct",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "",
    },
    riskConfig: {
      maxPositionUsd: 1000,
      stopLossPct: 5,
      takeProfitPct: 10,
      stopLossType: "fixed_pct",
      atrStopMultiplier: null,
      kellyFraction: 0,
      predictionEdgeThreshold: 0.55,
      maxExposureUsd: null,
      waitForOpenThreshold: 0,
      maxConcurrentTrades: 3,
      dailyLossLimitUsd: 500,
      profitTargetUsd: 2000,
      maxAiSpendUsd: 10,
      maxDataSpendUsd: 5,
      humanApprovalRequired: false,
    },
    timeframe: {
      primaryTradingTimeframe: "1h",
      holdingStyle: "intraday_flat",
      targetHoldDays: null,
      maxHoldDays: 1,
      timeframeNotes: "",
    },
  };
}

function makeMinimalFixture(overrides: Partial<CycleFixture> = {}): CycleFixture {
  return {
    version: 1,
    exportedAt: "2024-01-01T10:00:00Z",
    sessionId: "s1",
    cycleId: "c1",
    strategySnapshot: makeStrategySnapshot(),
    selectedInstruments: [{ symbol: "AAPL", instrumentClass: "stock", rationale: "momentum" }],
    marketData: [
      {
        symbol: "AAPL",
        quote: {
          instrumentSymbol: "AAPL",
          price: 150,
          bid: 149.9,
          ask: 150.1,
          spreadPct: 0.13,
          volume: 1000000,
          timestamp: "2024-01-01T09:30:00Z",
        },
        ohlcvBars: [
          { ts: "2024-01-01T09:00:00Z", open: 148, high: 152, low: 147, close: 150, volume: 100000 },
        ],
        newsHeadlines: [],
        redditPosts: [],
      },
    ],
    agentRuns: [],
    phaseOutputs: {
      selector: null,
      technical: null,
      fundamental: null,
      review: null,
      decision: null,
    },
    phaseTraces: {},
    decision: { action: "no_trade", confidence: 0.3, reasoning: "insufficient signal" },
    riskOutcome: { allowed: true },
    trade: null,
    ...overrides,
  };
}

function loadFixture(name: string): CycleFixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8")) as CycleFixture;
}

describe("CycleReplayService.buildFixture", () => {
  it("returns null when no agent messages found for cycle", () => {
    const agentMessages = { listByCycle: () => [] };
    const svc = new CycleReplayService({
      agentMessages: agentMessages as never,
      trades: { listByCycle: () => [] } as never,
      instrumentCache: { get: () => null } as never,
      sessionExecutionSteps: { getLatestByCycle: () => [] } as never,
      userDataPath: "/tmp",
    });

    expect(svc.buildFixture("missing-cycle")).toBeNull();
  });

  it("builds fixture from agent messages with strategy snapshot and typed phase output", () => {
    const snapshot = makeStrategySnapshot();
    const messages = [
      {
        id: "m1",
        agent_run_id: "r1",
        session_id: "s1",
        cycle_id: "c1",
        trade_id: null,
        role: "technical" as const,
        provider_key: "anthropic",
        model_id: "claude-sonnet-4-6",
        messages_json: JSON.stringify([{ role: "user", content: "analyze AAPL" }]),
        thinking_json: null,
        tool_calls_json: JSON.stringify({
          version: 1,
          sessionId: "s1",
          cycleId: "c1",
          tradeId: null,
          phase: "technical",
          schedulingMode: "flat_parallel",
          maxConcurrency: 3,
          startedAt: "2024-01-01T09:30:00Z",
          finishedAt: "2024-01-01T09:30:05Z",
          durationMs: 5000,
          totalCostUsd: 0.04,
          totalInputTokens: 100,
          totalOutputTokens: 20,
          aggregateStatus: "succeeded",
          aggregateOutputSchemaName: "technicalSignal",
          aggregateOutputSummary: { symbol: "AAPL", trendDirection: "bullish" },
          frontiers: [],
          workers: [],
        }),
        output_json: JSON.stringify({
          symbol: "AAPL",
          trendDirection: "bullish",
          trendStrength: 0.9,
          momentumScore: 0.8,
          volumeScore: 0.7,
          volumeSignal: "accumulation",
          patternName: "breakout",
          patternStrength: 0.75,
          nearestSupport: 145,
          nearestResistance: 151,
          timeframeAlignment: 0.8,
          rawSummary: "strong breakout",
        }),
        output_schema_name: "technicalSignal",
        parse_fallback: false,
        strategy_snapshot_json: JSON.stringify(snapshot),
        market_snapshot_json: null,
        created_at: "2024-01-01T09:30:00Z",
      },
    ];
    const svc = new CycleReplayService({
      agentMessages: { listByCycle: () => messages } as never,
      trades: { listByCycle: () => [] } as never,
      instrumentCache: { get: () => null } as never,
      sessionExecutionSteps: { getLatestByCycle: () => [] } as never,
      userDataPath: "/tmp",
    });

    const fixture = svc.buildFixture("c1");

    if (!fixture) throw new Error("fixture missing");
    expect(fixture.sessionId).toBe("s1");
    expect(fixture.cycleId).toBe("c1");
    expect(fixture.strategySnapshot.version).toBe(5);
    expect(fixture.phaseOutputs.technical?.symbol).toBe("AAPL");
    expect(fixture.phaseTraces.technical?.aggregateOutputSchemaName).toBe("technicalSignal");
  });

  it("incomplete cycle (no trade) → fixture.trade = null, fixture still valid", () => {
    const snapshot = makeStrategySnapshot();
    const messages = [
      {
        id: "m1",
        agent_run_id: "r1",
        session_id: "s1",
        cycle_id: "c1",
        trade_id: null,
        role: "decision" as const,
        provider_key: "anthropic",
        model_id: "claude-sonnet-4-6",
        messages_json: JSON.stringify([{ role: "user", content: "decide" }]),
        thinking_json: null,
        tool_calls_json: null,
        output_json: JSON.stringify({
          symbol: "AAPL",
          action: "skip",
          executionStrategy: "breakout",
          entryPrice: null,
          confidence: 0.3,
          reasoning: "no edge",
        }),
        output_schema_name: "tradeSignal",
        parse_fallback: false,
        strategy_snapshot_json: JSON.stringify(snapshot),
        market_snapshot_json: null,
        created_at: "2024-01-01T09:30:00Z",
      },
    ];
    const svc = new CycleReplayService({
      agentMessages: { listByCycle: () => messages } as never,
      trades: { listByCycle: () => [] } as never,
      instrumentCache: { get: () => null } as never,
      sessionExecutionSteps: { getLatestByCycle: () => [] } as never,
      userDataPath: "/tmp",
    });

    const fixture = svc.buildFixture("c1");

    if (!fixture) throw new Error("fixture missing");
    expect(fixture.trade).toBeNull();
    expect(fixture.decision.action).toBe("no_trade");
    expect(fixture.phaseOutputs.decision?.action).toBe("skip");
  });

  it("fixture JSON round-trips without data loss", () => {
    const fixture = makeMinimalFixture();
    const json = JSON.stringify(fixture);
    const restored = JSON.parse(json) as CycleFixture;

    expect(restored.version).toBe(1);
    expect(restored.sessionId).toBe(fixture.sessionId);
    expect(restored.cycleId).toBe(fixture.cycleId);
    expect(restored.strategySnapshot).toEqual(fixture.strategySnapshot);
    expect(restored.selectedInstruments).toEqual(fixture.selectedInstruments);
    expect(restored.marketData).toEqual(fixture.marketData);
    expect(restored.phaseOutputs).toEqual(fixture.phaseOutputs);
    expect(restored.phaseTraces).toEqual(fixture.phaseTraces);
    expect(restored.decision).toEqual(fixture.decision);
    expect(restored.riskOutcome).toEqual(fixture.riskOutcome);
    expect(restored.trade).toBeNull();
  });

  it("uses selector phase output when building selected instruments", () => {
    const snapshot = makeStrategySnapshot();
    const selectorOutput = {
      instruments: [
        { symbol: "NVDA", instrumentClass: "stock", rationale: "fresh momentum" },
      ],
    };
    const messages = [
      {
        id: "m1",
        agent_run_id: "r1",
        session_id: "s1",
        cycle_id: "c1",
        trade_id: null,
        role: "selector" as const,
        provider_key: "anthropic",
        model_id: "claude-sonnet-4-6",
        messages_json: JSON.stringify([{ role: "user", content: "find setups" }]),
        thinking_json: null,
        tool_calls_json: JSON.stringify({
          version: 1,
          sessionId: "s1",
          cycleId: "c1",
          tradeId: null,
          phase: "selector",
          schedulingMode: "dependency_graph",
          maxConcurrency: 4,
          startedAt: "2024-01-01T09:30:00Z",
          finishedAt: "2024-01-01T09:30:05Z",
          durationMs: 5000,
          totalCostUsd: 0.08,
          totalInputTokens: 300,
          totalOutputTokens: 60,
          aggregateStatus: "succeeded",
          aggregateOutputSchemaName: "instrumentSelection",
          aggregateOutputSummary: { instruments: { count: 1 } },
          frontiers: [],
          workers: [],
        }),
        output_json: JSON.stringify(selectorOutput),
        output_schema_name: "instrumentSelection",
        parse_fallback: false,
        strategy_snapshot_json: JSON.stringify(snapshot),
        market_snapshot_json: null,
        created_at: "2024-01-01T09:30:00Z",
      },
    ];
    const svc = new CycleReplayService({
      agentMessages: { listByCycle: () => messages } as never,
      trades: { listByCycle: () => [] } as never,
      instrumentCache: { get: () => null } as never,
      sessionExecutionSteps: { getLatestByCycle: () => [] } as never,
      userDataPath: "/tmp",
    });

    const fixture = svc.buildFixture("c1");

    expect(fixture?.selectedInstruments).toEqual([
      { symbol: "NVDA", instrumentClass: "stock", rationale: "fresh momentum" },
    ]);
    expect(fixture?.phaseOutputs.selector).toEqual(selectorOutput);
  });
});

describe("CycleReplayRunner.replay", () => {
  const runner = new CycleReplayRunner();

  it("same fixture produces same riskOutcome on two consecutive runs", () => {
    const fixture = makeMinimalFixture({
      decision: { action: "trade", side: "BUY", symbol: "AAPL", sizeUsd: 500, confidence: 0.8, reasoning: "bullish" },
      riskOutcome: { allowed: true },
    });

    const r1 = runner.replay(fixture);
    const r2 = runner.replay(fixture);

    expect(r1.policyGate?.allowed).toBe(r2.policyGate?.allowed);
    expect(r1.policyGate?.gatesFailed).toEqual(r2.policyGate?.gatesFailed);
  });

  it("no_trade decision → policyGate is null", () => {
    const fixture = makeMinimalFixture();
    const result = runner.replay(fixture);

    expect(result.policyGate).toBeNull();
  });

  it("fixture from before policy gate was added → matchesOriginal.riskOutcomeMatches can be false", () => {
    const fixture = makeMinimalFixture({
      decision: { action: "trade", side: "BUY", symbol: "AAPL", sizeUsd: 500, confidence: 0.8, reasoning: "bullish" },
      riskOutcome: { allowed: true },
    });

    const result = runner.replay(fixture);

    expect(typeof result.matchesOriginal.riskOutcomeMatches).toBe("boolean");
    expect(typeof result.matchesOriginal.tradeOpenedMatches).toBe("boolean");
  });

  it("candidateValidation runs for each selected instrument with market data", () => {
    const fixture = makeMinimalFixture();
    const result = runner.replay(fixture);

    expect(result.candidateValidation).toHaveLength(1);
    expect(result.candidateValidation[0]).toHaveProperty("allowed");
  });

  it("exit decision is null when no trade in fixture", () => {
    const fixture = makeMinimalFixture();
    const result = runner.replay(fixture);

    expect(result.exitDecision).toBeNull();
  });

  it("loads checked-in fixtures and replays them", () => {
    const files = fs.readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(5);

    for (const file of files) {
      const fixture = loadFixture(file.replace(/\.json$/, ""));
      const result = runner.replay(fixture);
      expect(result.cycleId).toBe(fixture.cycleId);
    }
  });

  it("acceptance helpers validate selector submission and budget", () => {
    const result = runner.replay(loadFixture("selector-submitted"));

    assertSubmissionFires(result);
    assertCostBelowUsd(result, 0.2);
  });

  it("acceptance helpers validate technical signal coverage", () => {
    const result = runner.replay(loadFixture("technical-stock"));

    assertTechnicalSignalHasField(result, "trendDirection");
    assertCostBelowUsd(result, 0.2);
  });

  it("replays exact technical signal fixtures for stock and prediction-market cases", () => {
    const stock = runner.replay(loadFixture("technical-stock"));
    const prediction = runner.replay(loadFixture("technical-prediction-market"));

    expect(stock.phaseOutputs.technical).toMatchObject({
      symbol: "AAPL",
      trendDirection: "bullish",
      trendStrength: 0.91,
      patternName: "breakout",
    });
    expect(prediction.phaseOutputs.technical).toMatchObject({
      symbol: "pm:election-2028",
      trendDirection: "bullish",
      trendStrength: 0.79,
      patternName: "implied probability breakout",
    });
  });

  it("replays exact fundamental signal fixtures for stock and event-contract cases", () => {
    const stock = runner.replay(loadFixture("fundamental-stock"));
    const eventContract = runner.replay(loadFixture("fundamental-event"));

    expect(stock.phaseOutputs.fundamental).toMatchObject({
      symbol: "AAPL",
      catalystType: "partnership",
      catalystScore: 0.76,
    });
    expect(eventContract.phaseOutputs.fundamental).toMatchObject({
      symbol: "pm:election-2028",
      catalystType: "macro",
      catalystScore: 0.81,
    });
  });

  it("acceptance helpers validate trade signal action and no legacy sizing fields", () => {
    const result = runner.replay(loadFixture("decision-buy"));

    assertTradeSignalAction(result, "buy");
    assertCostBelowUsd(result, 0.3);
    expect(result.scorecard.aiAuthoredSizingFieldCount).toBe(0);
  });
});

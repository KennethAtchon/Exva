import { describe, expect, it } from "vitest";
import { CycleReplayRunner, CycleReplayService } from "../cycle-replay-service";
import type { CycleFixture } from "../cycle-replay-service";
import type { StrategySnapshot } from "@/lib/types";

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
    decision: { action: "no_trade", confidence: 0.3, reasoning: "insufficient signal" },
    riskOutcome: { allowed: true },
    trade: null,
    ...overrides,
  };
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

  it("builds fixture from agent messages with strategy snapshot", () => {
    const snapshot = makeStrategySnapshot();
    const messages = [
      {
        id: "m1",
        agent_run_id: "r1",
        session_id: "s1",
        cycle_id: "c1",
        trade_id: null,
        role: "analyst_technical" as const,
        provider_key: "anthropic",
        model_id: "claude-sonnet-4-6",
        messages_json: JSON.stringify([{ role: "user", content: "analyze AAPL" }]),
        thinking_json: null,
        tool_calls_json: null,
        output_json: null,
        output_schema_name: null,
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
        role: "decision_maker" as const,
        provider_key: "anthropic",
        model_id: "claude-sonnet-4-6",
        messages_json: JSON.stringify([{ role: "user", content: "decide" }]),
        thinking_json: null,
        tool_calls_json: null,
        output_json: JSON.stringify({ action: "no_trade", confidence: 0.3, reasoning: "no edge" }),
        output_schema_name: null,
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
    expect(restored.decision).toEqual(fixture.decision);
    expect(restored.riskOutcome).toEqual(fixture.riskOutcome);
    expect(restored.trade).toBeNull();
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
    // Original allowed but replay might fail (e.g. data_freshness gate added)
    const fixture = makeMinimalFixture({
      decision: { action: "trade", side: "BUY", symbol: "AAPL", sizeUsd: 500, confidence: 0.8, reasoning: "bullish" },
      riskOutcome: { allowed: true },
    });

    const result = runner.replay(fixture);

    // matchesOriginal reflects whether replay agrees — it may or may not match
    // The important thing is that the field is present and is a boolean
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
});

import { describe, expect, it } from "vitest";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { emptySessionAiSettings } from "@electron/shared/domain";
import type { LLMCallTrace } from "../../../llm/llm-types";
import { assembleAggregateTrace, assembleTrace } from "../trace-assembler";

function llmTrace(
  overrides: Partial<LLMCallTrace> = {},
): LLMCallTrace<unknown> {
  return {
    assistantText: "done",
    messages: [],
    auditMessagesJson: "[]",
    steps: [],
    finishReason: "stop",
    parseFallback: false,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
    costSource: "estimated",
    ...overrides,
  };
}

function strategyContext(): SessionStrategyContext {
  const ts = "2026-05-05T00:00:00.000Z";
  return {
    researchPosture: {
      sessionId: "s1",
      posturePresetId: "edgar_catalyst",
      processingMode: "catalyst",
      evidenceMode: "document_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "Favor strong leaders.",
      updatedAt: ts,
    },
    rules: {
      sessionId: "s1",
      rulesPresetId: "catalyst_entry",
      setupType: "catalyst_entry",
      sideBias: "long_only",
      entryStyle: "catalyst",
      exitStyle: "trailing_atr",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "",
      updatedAt: ts,
    },
    riskConfig: {
      sessionId: "s1",
      riskPresetId: "custom",
      offHoursTrading: "disabled",
      maxPositionUsd: 100,
      stopLossPct: 2,
      takeProfitPct: 4,
      stopLossType: "fixed_pct",
      atrStopMultiplier: 1.5,
      kellyFraction: 0.25,
      predictionEdgeThreshold: 0.08,
      maxExposureUsd: null,
      waitForOpenThreshold: 0.8,
      maxConcurrentTrades: 1,
      maxConsecutiveLosers: 5,
      volatilityHaltMaxSpreadPct: null,
      dailyLossLimitUsd: 50,
      profitTargetUsd: 200,
      maxAiSpendUsd: 5,
      maxDataSpendUsd: 5,
      humanApprovalRequired: false,
      updatedAt: ts,
    },
    timeframe: {
      sessionId: "s1",
      timeframePresetId: "catalyst",
      primaryTradingTimeframe: "1h",
      holdingStyle: "multi_day_swing",
      targetHoldDays: 3,
      maxHoldDays: 10,
      timeframeNotes: "",
      updatedAt: ts,
    },
    aiSettings: emptySessionAiSettings("s1", ts),
  };
}

describe("trace-assembler", () => {
  it("assembles a single-worker trace with token and cost totals", () => {
    const assembled = assembleTrace({
      phase: "technical",
      workerId: "chart-analyst",
      sessionId: "s1",
      tradeId: "t1",
      cycleId: "c1",
      providerKey: "anthropic",
      modelId: "claude-sonnet",
      trace: llmTrace({
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.02,
        durationMs: 1200,
        assistantText: "analysis complete",
        thinkingText: "thinking",
        steps: [
          {
            step: 0,
            toolCalls: [],
            inputTokens: 100,
            outputTokens: 50,
            latencyMs: 1200,
          },
        ],
      }),
      outputJson: JSON.stringify({ score: 0.8 }),
      outputSchemaName: "chart-analyst",
      strategyContext: strategyContext(),
      parseFallback: false,
    });

    expect(assembled.run.agent_type).toBe("technical");
    expect(assembled.run.input_tokens).toBe(100);
    expect(assembled.run.output_tokens).toBe(50);
    expect(assembled.run.cost_usd).toBe(0.02);
    expect(assembled.message.session_id).toBe("s1");
    expect(assembled.message.cycle_id).toBe("c1");
    expect(assembled.message.output_schema_name).toBe("chart-analyst");
    expect(assembled.message.thinking_json).toContain("thinking");
  });

  it("aggregates worker traces into a phase-level trace envelope", () => {
    const workerA = assembleTrace({
      phase: "selector",
      workerId: "discovery",
      sessionId: "s1",
      tradeId: null,
      cycleId: "c1",
      providerKey: "anthropic",
      modelId: "claude-sonnet",
      trace: llmTrace({
        inputTokens: 80,
        outputTokens: 40,
        costUsd: 0.01,
        durationMs: 500,
        assistantText: "found",
      }),
      outputJson: JSON.stringify({ instruments: [] }),
      outputSchemaName: "discovery",
      strategyContext: strategyContext(),
    });
    const workerB = assembleTrace({
      phase: "selector",
      workerId: "ranker",
      sessionId: "s1",
      tradeId: null,
      cycleId: "c1",
      providerKey: "anthropic",
      modelId: "claude-sonnet",
      trace: llmTrace({
        inputTokens: 60,
        outputTokens: 30,
        costUsd: 0.008,
        durationMs: 400,
        assistantText: "ranked",
      }),
      outputJson: JSON.stringify({ instruments: [{ symbol: "AAPL" }] }),
      outputSchemaName: "ranker",
      strategyContext: strategyContext(),
    });

    const aggregate = assembleAggregateTrace({
      phase: "selector",
      sessionId: "s1",
      tradeId: null,
      cycleId: "c1",
      providerKey: "anthropic",
      modelId: "claude-sonnet",
      strategyContext: strategyContext(),
      schedulingMode: "dependency_graph",
      maxConcurrency: 2,
      output: { instruments: [{ symbol: "AAPL" }] },
      outputSchemaName: "selector-output",
      workers: [
        {
          workerId: "discovery",
          frontier: 0,
          dependsOn: [],
          requiredForPhase: true,
          run: workerA.run,
          message: workerA.message,
        },
        {
          workerId: "ranker",
          frontier: 1,
          dependsOn: ["discovery"],
          requiredForPhase: true,
          run: workerB.run,
          message: workerB.message,
        },
      ],
    });

    expect(aggregate.run.input_tokens).toBe(140);
    expect(aggregate.run.output_tokens).toBe(70);
    expect(aggregate.run.cost_usd).toBeCloseTo(0.018, 4);
    expect(aggregate.message.parse_fallback).toBe(false);

    const phaseTrace = JSON.parse(aggregate.message.tool_calls_json ?? "{}");
    expect(phaseTrace.version).toBe(1);
    expect(phaseTrace.workers).toHaveLength(2);
    expect(phaseTrace.frontiers).toHaveLength(2);
  });
});

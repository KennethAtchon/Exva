import { describe, expect, it } from "vitest";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { emptySessionAiSettings } from "@electron/shared/domain";
import {
  buildStrategyPromptContext,
  buildWorkerStrategyPromptContext,
  prependStrategyContextToUserPrompt,
} from "../strategy-prompt-context";
import { buildWorkerPrompt } from "../worker-prompt-builder";

function baseContext(): SessionStrategyContext {
  const ts = "2026-05-05T00:00:00.000Z";
  return {
    researchPosture: {
      sessionId: "s1",
      posturePresetId: "edgar_catalyst",
      processingMode: "catalyst",
      evidenceMode: "document_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "Favor strong leaders with clean trend persistence.",
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
      ruleNotes: "Avoid earnings week.",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    riskConfig: {
      sessionId: "s1",
      riskPresetId: "custom" as const,
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
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    timeframe: {
      sessionId: "s1",
      timeframePresetId: "catalyst",
      primaryTradingTimeframe: "1h",
      holdingStyle: "multi_day_swing",
      targetHoldDays: 3,
      maxHoldDays: 10,
      timeframeNotes: "",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    aiSettings: emptySessionAiSettings("s1", "2026-05-05T00:00:00.000Z"),
  };
}

const TEST_STRATEGY_CONTEXT_REQUEST = {
  fields: [
    "identity",
    "researchPosture",
    "tradeRules",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

describe("strategy-prompt-context", () => {
  it("truncates long timeframe notes inside the prompt snapshot", () => {
    const context = baseContext();
    context.timeframe.timeframeNotes = "x".repeat(600);

    const built = buildStrategyPromptContext(context);

    expect(built.snapshot.timeframe.timeframeNotes).toContain("...");
    expect(built.prompt).toContain("## Session trading horizon");
    expect(built.prompt).toContain("## Session research posture");
    expect(built.prompt).toContain("## Session trade rules");
    expect(built.prompt.length).toBeLessThan(2200);
  });

  it("prepends full strategy context before user content", () => {
    const out = prependStrategyContextToUserPrompt(
      baseContext(),
      "Instrument: AAPL",
    );

    expect(out.prompt.startsWith("## Session research posture")).toBe(true);
    expect(out.prompt).toContain("edgar_catalyst");
    expect(out.prompt.endsWith("Instrument: AAPL")).toBe(true);
    expect(out.snapshot.rules.setupType).toBe("catalyst_entry");
  });

  it("builds a smaller worker-scoped strategy context than the full snapshot prompt", () => {
    const context = baseContext();
    const full = buildStrategyPromptContext(context).prompt;
    const worker = buildWorkerStrategyPromptContext(
      context,
      TEST_STRATEGY_CONTEXT_REQUEST,
    );
    expect(worker.length).toBeLessThan(full.length);
    expect(worker).toContain("Processing: catalyst");
    expect(worker).toContain("Stop loss type:");
    expect(worker).not.toContain("Posture notes:");
    expect(worker).not.toContain("Trade rules markdown:");
  });

  it("does not truncate worker envelope content when notes are long", () => {
    const context = baseContext();
    context.researchPosture.postureNotes = "x".repeat(800);
    context.rules.ruleNotes = "y".repeat(800);
    context.rules.tradeRulesMarkdown = "z".repeat(800);

    const messages = buildWorkerPrompt({
      phase: "technical",
      workerId: "price-reaction-checker",
      basePromptMarkdown: "# Chart pattern",
      task: { instrumentSymbol: "AAPL", context: "brief from selector" },
      strategyContext: context,
      strategyContextRequest: TEST_STRATEGY_CONTEXT_REQUEST,
    });
    const userMessage = messages[1]?.content ?? "";

    expect(userMessage).not.toContain("…");
    expect(userMessage).not.toMatch(/\.\.\.$/m);
    expect(userMessage).not.toContain(context.researchPosture.postureNotes);
    expect(userMessage).toContain('"instrumentSymbol": "AAPL"');
    expect(userMessage).toContain("brief from selector");
  });

  it("adds preset-derived behavior guidance to worker messages", () => {
    const context = baseContext();
    context.riskConfig.riskPresetId = "moderate";
    context.timeframe.timeframePresetId = "catalyst";

    const messages = buildWorkerPrompt({
      phase: "selector",
      workerId: "web-scout",
      basePromptMarkdown: "# Web scout",
      task: { selectionInstructions: "Find candidates" },
      strategyContext: context,
      strategyContextRequest: TEST_STRATEGY_CONTEXT_REQUEST,
    });

    const userMessage = messages[1]?.content ?? "";

    expect(userMessage).toContain("<trusted_strategy_facts>");
    expect(userMessage).toContain("Processing: catalyst");
    expect(userMessage).toContain("<trusted_strategy_guidance>");
    expect(userMessage).not.toContain("<trusted_session_context>");
    expect(userMessage).not.toContain("<preset_behavior>");
    expect(userMessage).not.toContain("## Session research posture");
    expect(userMessage).not.toContain("Worker focus:");
    expect(userMessage).not.toContain("Discovery guidance:");
  });

  it("nudges entry timer toward enter_now in clean_breakout sandbox", () => {
    const context = baseContext();
    const messages = buildWorkerPrompt({
      phase: "decision",
      workerId: "entry-timer",
      basePromptMarkdown: "# Entry timer",
      task: { instrumentSymbol: "NVDA" },
      strategyContext: context,
      strategyContextRequest: TEST_STRATEGY_CONTEXT_REQUEST,
      sandboxMode: true,
      mockScenarioKind: "clean_breakout",
    });

    const userMessage = messages[1]?.content ?? "";

    expect(userMessage).toContain("entryTimingHint");
    expect(userMessage).toContain("prefer enter_now");
    expect(messages[0]?.content).toContain("Sandbox Mode");
  });

  it("renders worker-declared strategy facts and guidance only", () => {
    const context = baseContext();
    context.riskConfig.riskPresetId = "moderate";
    context.timeframe.timeframePresetId = "catalyst";

    const messages = buildWorkerPrompt({
      phase: "selector",
      workerId: "liquidity-gate:AAPL",
      basePromptMarkdown: "# Liquidity gate",
      task: { instrumentSymbol: "AAPL" },
      strategyContext: context,
      strategyContextRequest: {
        fields: ["identity", "riskLimits", "timeframe", "presetBehavior"],
        guidance: ["howToEvaluate", "avoid"],
        maxGuidanceItems: 2,
      },
    });

    const userMessage = messages[1]?.content ?? "";

    expect(userMessage).toContain("<trusted_strategy_facts>");
    expect(userMessage).toContain("Max position USD: 100");
    expect(userMessage).toContain("Horizon: 1h (multi_day_swing)");
    expect(userMessage).not.toContain("<trusted_session_context>");
    expect(userMessage).not.toContain("Processing: catalyst");
    expect(userMessage).not.toContain("Entry: catalyst");

    expect(userMessage).toContain("<trusted_strategy_guidance>");
    expect(userMessage).toContain("Global preset: EDGAR Catalyst");
    expect(userMessage).toContain("How to evaluate");
    expect(userMessage).not.toContain("What to look for");
    expect(userMessage).not.toContain("Research posture: Trend Hunt");
  });
});

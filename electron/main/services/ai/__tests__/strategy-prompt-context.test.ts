import { describe, expect, it } from "vitest";
import type { SessionStrategyContext } from "@electron/shared/domain";
import {
  buildStrategyPromptContext,
  buildWorkerStrategyPromptContext,
  prependStrategyContextToUserPrompt,
} from "../strategy-prompt-context";
import {
  buildPromptEnvelope,
  envelopeToMessages,
  measurePromptEnvelope,
} from "../pipeline-runtime/prompting/prompt-envelope-builder";

function baseContext(): SessionStrategyContext {
  const ts = "2026-05-05T00:00:00.000Z";
  return {
    researchPosture: {
      sessionId: "s1",
      posturePresetId: "trend_hunt",
      discoveryMode: "trend_scan",
      evidenceMode: "price_action_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "Favor strong leaders with clean trend persistence.",
      updatedAt: ts,
    },
    rules: {
      sessionId: "s1",
      rulesPresetId: "breakout_long",
      setupType: "breakout",
      sideBias: "long_only",
      entryStyle: "breakout",
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
      dailyLossLimitUsd: 50,
      profitTargetUsd: 200,
      maxAiSpendUsd: 5,
      maxDataSpendUsd: 5,
      humanApprovalRequired: false,
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    timeframe: {
      sessionId: "s1",
      timeframePresetId: "custom" as const,
      primaryTradingTimeframe: "1h",
      holdingStyle: "multi_day_swing",
      targetHoldDays: 3,
      maxHoldDays: 10,
      timeframeNotes: "",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
  };
}

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
    expect(out.prompt).toContain("trend_hunt");
    expect(out.prompt.endsWith("Instrument: AAPL")).toBe(true);
    expect(out.snapshot.rules.setupType).toBe("breakout");
  });

  it("builds a smaller worker-scoped strategy context than the full snapshot prompt", () => {
    const context = baseContext();
    const full = buildStrategyPromptContext(context).prompt;
    const worker = buildWorkerStrategyPromptContext(context, "technical");
    expect(worker.length).toBeLessThan(full.length);
    expect(worker).toContain("Discovery: trend_scan");
    expect(worker).toContain("Stop type:");
    expect(worker).not.toContain("Posture notes:");
    expect(worker).not.toContain("Trade rules markdown:");
  });

  it("does not truncate worker envelope content when notes are long", () => {
    const context = baseContext();
    context.researchPosture.postureNotes = "x".repeat(800);
    context.rules.ruleNotes = "y".repeat(800);
    context.rules.tradeRulesMarkdown = "z".repeat(800);

    const envelope = buildPromptEnvelope({
      phase: "technical",
      workerId: "chart-pattern",
      basePromptMarkdown: "# Chart pattern",
      task: { instrumentSymbol: "AAPL", context: "brief from selector" },
      strategyContext: context,
    });

    const messages = envelopeToMessages(envelope, context);
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
    context.timeframe.timeframePresetId = "swing";

    const envelope = buildPromptEnvelope({
      phase: "selector",
      workerId: "web-scout",
      basePromptMarkdown: "# Web scout",
      task: { selectionInstructions: "Find candidates" },
      strategyContext: context,
    });

    const messages = envelopeToMessages(envelope, context);
    const userMessage = messages[1]?.content ?? "";

    expect(userMessage).toContain("<trusted_session_context>");
    expect(userMessage).toContain("Discovery: trend_scan");
    expect(userMessage).toContain("<preset_behavior>");
    expect(userMessage).not.toContain("## Session research posture");
    expect(userMessage).not.toContain("Worker focus:");
    expect(userMessage).not.toContain("Discovery guidance:");
  });
});

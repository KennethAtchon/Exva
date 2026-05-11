import { describe, expect, it } from "vitest";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { buildStrategyPromptContext, prependStrategyContextToUserPrompt } from "../strategy-prompt-context";

function baseContext(): SessionStrategyContext {
  return {
    style: {
      sessionId: "s1",
      stylePresetId: "trend_hunt",
      discoveryMode: "trend_scan",
      evidenceMode: "price_action_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      styleNotes: "Favor strong leaders with clean trend persistence.",
      updatedAt: "2026-05-05T00:00:00.000Z",
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
    expect(built.prompt).toContain("## Session trading style");
    expect(built.prompt).toContain("## Session trade rules");
    expect(built.prompt.length).toBeLessThan(2200);
  });

  it("prepends full strategy context before user content", () => {
    const out = prependStrategyContextToUserPrompt(baseContext(), "Instrument: AAPL");

    expect(out.prompt.startsWith("## Session trading style")).toBe(true);
    expect(out.prompt).toContain("trend_hunt");
    expect(out.prompt.endsWith("Instrument: AAPL")).toBe(true);
    expect(out.snapshot.rules.setupType).toBe("breakout");
  });
});

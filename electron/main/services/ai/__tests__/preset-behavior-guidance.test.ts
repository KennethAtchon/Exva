import { describe, expect, it } from "vitest";
import { buildPresetBehaviorGuidance } from "../pipeline-runtime/prompting/preset-behavior-guidance";
import type { SessionStrategyContext } from "@electron/shared/domain";

function minimalContext(
  overrides: Record<string, unknown> = {},
): SessionStrategyContext {
  return {
    researchPosture: {
      posturePresetId: "trend_hunt",
      discoveryMode: "trend_scan",
      evidenceMode: "price_action_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "",
    },
    rules: {
      rulesPresetId: "breakout_long",
      setupType: "momentum",
      sideBias: "long_only",
      entryStyle: "breakout",
      exitStyle: "trailing",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "",
    },
    riskConfig: {
      riskPresetId: "conservative",
      maxPositionUsd: 1000,
      stopLossType: "fixed_pct",
      stopLossPct: 2,
      takeProfitPct: 4,
      atrStopMultiplier: null,
      maxExposureUsd: null,
      kellyFraction: 0.25,
      predictionEdgeThreshold: 0.05,
      waitForOpenThreshold: 0.5,
      maxConcurrentTrades: 3,
      dailyLossLimitUsd: 500,
      profitTargetUsd: null,
      maxAiSpendUsd: 5,
      maxDataSpendUsd: 1,
      humanApprovalRequired: false,
    },
    timeframe: {
      timeframePresetId: "swing",
      primaryTradingTimeframe: "1d",
      holdingStyle: "swing",
      targetHoldDays: 5,
      maxHoldDays: 10,
      timeframeNotes: "",
    },
    ...overrides,
  } as unknown as SessionStrategyContext;
}

describe("buildPresetBehaviorGuidance", () => {
  it("includes selector-phase guidance from built-in presets", () => {
    const text = buildPresetBehaviorGuidance(minimalContext(), "selector");
    expect(text).toContain("Preset behavior guidance");
    expect(text.length).toBeGreaterThan(20);
  });

  it("returns empty when no preset guidance is configured", () => {
    const text = buildPresetBehaviorGuidance(
      minimalContext({
        researchPosture: {
          posturePresetId: "custom_unknown",
          discoveryMode: "custom",
          evidenceMode: "custom",
          catalystMode: "optional",
          fundamentalStrictness: "balanced",
          postureNotes: "",
        },
        rules: {
          rulesPresetId: "custom_unknown",
          setupType: "custom",
          sideBias: "long_only",
          entryStyle: "market",
          exitStyle: "fixed",
          scalingMode: "single_entry",
          tradeRulesMarkdown: "",
          ruleNotes: "",
        },
        riskConfig: {
          riskPresetId: "custom_unknown",
          maxPositionUsd: 1000,
          stopLossType: "fixed_pct",
          stopLossPct: 2,
          takeProfitPct: 4,
          atrStopMultiplier: null,
          maxExposureUsd: null,
          kellyFraction: 0.25,
          predictionEdgeThreshold: 0.05,
          waitForOpenThreshold: 0.5,
          maxConcurrentTrades: 1,
          dailyLossLimitUsd: 100,
          profitTargetUsd: null,
          maxAiSpendUsd: 1,
          maxDataSpendUsd: 0.5,
          humanApprovalRequired: false,
        },
        timeframe: {
          timeframePresetId: "custom_unknown",
          primaryTradingTimeframe: "1d",
          holdingStyle: "swing",
          targetHoldDays: null,
          maxHoldDays: null,
          timeframeNotes: "",
        },
      }),
      "technical",
    );
    expect(text).toBe("");
  });
});

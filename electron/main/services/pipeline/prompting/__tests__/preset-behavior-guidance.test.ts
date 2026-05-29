import { describe, expect, it } from "vitest";
import { buildStrategyGuidance } from "../strategy-guidance";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { emptySessionAiSettings } from "@electron/shared/domain";

function minimalContext(
  overrides: Record<string, unknown> = {},
): SessionStrategyContext {
  return {
    researchPosture: {
      posturePresetId: "edgar_catalyst",
      processingMode: "catalyst",
      evidenceMode: "document_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "",
      sessionId: "s1",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    rules: {
      sessionId: "s1",
      rulesPresetId: "catalyst_entry",
      setupType: "catalyst_entry",
      sideBias: "long_only",
      entryStyle: "catalyst",
      exitStyle: "thesis_based",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    riskConfig: {
      sessionId: "s1",
      riskPresetId: "moderate",
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
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    timeframe: {
      sessionId: "s1",
      timeframePresetId: "catalyst",
      primaryTradingTimeframe: "1d",
      holdingStyle: "multi_day_swing",
      targetHoldDays: 5,
      maxHoldDays: 10,
      timeframeNotes: "",
    },
    aiSettings: emptySessionAiSettings("s1"),
    ...overrides,
  } as unknown as SessionStrategyContext;
}

describe("buildStrategyGuidance", () => {
  it("includes selector-phase guidance from built-in presets", () => {
    const text = buildStrategyGuidance(minimalContext(), "selector");
    expect(text).toContain("Preset behavior guidance");
    expect(text.length).toBeGreaterThan(20);
  });

  it("returns empty when no preset guidance is configured", () => {
    const text = buildStrategyGuidance(
      minimalContext({
        researchPosture: {
          posturePresetId: "custom_unknown",
          processingMode: "manual",
          evidenceMode: "balanced",
          catalystMode: "preferred",
          fundamentalStrictness: "balanced",
          postureNotes: "",
          sessionId: "s1",
          updatedAt: "2026-05-05T00:00:00.000Z",
        },
        rules: {
          sessionId: "s1",
          rulesPresetId: "custom_unknown",
          setupType: "custom",
          sideBias: "long_only",
          entryStyle: "catalyst",
          exitStyle: "fixed_pct",
          scalingMode: "single_entry",
          tradeRulesMarkdown: "",
          ruleNotes: "",
          updatedAt: "2026-05-05T00:00:00.000Z",
        },
        riskConfig: {
          sessionId: "s1",
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
          updatedAt: "2026-05-05T00:00:00.000Z",
        },
        timeframe: {
          sessionId: "s1",
          timeframePresetId: "custom_unknown",
          primaryTradingTimeframe: "1d",
          holdingStyle: "multi_day_swing",
          targetHoldDays: null,
          maxHoldDays: null,
          timeframeNotes: "",
          updatedAt: "2026-05-05T00:00:00.000Z",
        },
      }),
      "technical",
    );
    expect(text).toBe("");
  });

  it("filters guidance sources and categories for worker requests", () => {
    const text = buildStrategyGuidance(
      minimalContext({
        riskConfig: {
          ...minimalContext().riskConfig,
          riskPresetId: "moderate",
        },
      }),
      "selector",
      {
        fields: ["identity", "riskLimits", "timeframe", "presetBehavior"],
        guidance: ["howToEvaluate", "avoid"],
        maxGuidanceItems: 1,
      },
    );

    expect(text).toContain("Global preset: EDGAR Catalyst");
    expect(text).toContain("How to evaluate");
    expect(text).not.toContain("Research posture: Trend Hunt");
    expect(text).not.toContain("Trade rules: Breakout Long");
    expect(text).not.toContain("What to look for");
  });
});

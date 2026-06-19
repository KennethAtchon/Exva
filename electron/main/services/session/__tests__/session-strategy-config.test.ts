import { describe, expect, it } from "vitest";
import { buildStrategySnapshot } from "@electron/shared/domain/session";
import {
  buildSessionStrategyConfigJson,
  parseSessionStrategyConfigJson,
  patchSessionStrategyConfigJson,
  strategyConfigToContext,
} from "../session-strategy-config";

const updatedAt = "2026-06-13T12:00:00.000Z";

function sampleContext(sessionId = "session-1") {
  return strategyConfigToContext(
    sessionId,
    buildSessionStrategyConfigJson({
      researchPosture: {
        sessionId,
        posturePresetId: "edgar_catalyst",
        processingMode: "catalyst",
        evidenceMode: "balanced",
        catalystMode: "required",
        fundamentalStrictness: "balanced",
        postureNotes: "watch filings",
        updatedAt,
      },
      rules: {
        sessionId,
        rulesPresetId: "catalyst_entry",
        setupType: "custom",
        sideBias: "both",
        entryStyle: "catalyst",
        exitStyle: "fixed_pct",
        scalingMode: "single_entry",
        tradeRulesMarkdown: "enter on catalyst",
        ruleNotes: "",
        updatedAt,
      },
      riskConfig: {
        sessionId,
        riskPresetId: "moderate",
        offHoursTrading: "disabled",
        maxPositionUsd: 500,
        stopLossPct: 2,
        takeProfitPct: 4,
        stopLossType: "fixed_pct",
        atrStopMultiplier: null,
        kellyFraction: 0.25,
        predictionEdgeThreshold: 0.08,
        maxExposureUsd: null,
        waitForOpenThreshold: 0.8,
        maxConcurrentTrades: 2,
        maxConsecutiveLosers: 3,
        volatilityHaltMaxSpreadPct: 1.5,
        dailyLossLimitUsd: 250,
        profitTargetUsd: 500,
        maxAiSpendUsd: 25,
        maxDataSpendUsd: 10,
        humanApprovalRequired: false,
        updatedAt,
      },
      timeframe: {
        sessionId,
        timeframePresetId: "catalyst",
        primaryTradingTimeframe: "1d",
        holdingStyle: "multi_day_swing",
        targetHoldDays: 5,
        maxHoldDays: 10,
        timeframeNotes: "",
        updatedAt,
      },
      aiSettings: {
        sessionId,
        workerGuidanceMarkdown: "stay disciplined",
        updatedAt,
      },
    }),
    updatedAt,
  );
}

describe("session-strategy-config", () => {
  it("round-trips strategy context through JSON snapshot v5", () => {
    const context = sampleContext();
    const json = buildSessionStrategyConfigJson(context);

    expect(json.version).toBe(5);
    expect(json.presetIds).toEqual({
      posturePresetId: "edgar_catalyst",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "catalyst",
    });
    expect(json.aiSettings.workerGuidanceMarkdown).toBe("stay disciplined");

    const parsed = parseSessionStrategyConfigJson(
      "session-1",
      JSON.stringify(json),
      updatedAt,
    );
    expect(parsed).toEqual(context);
  });

  it("rejects unsupported snapshot versions and malformed JSON", () => {
    const context = sampleContext();
    const json = buildSessionStrategyConfigJson(context);

    expect(
      parseSessionStrategyConfigJson(
        "session-1",
        JSON.stringify({ ...json, version: 4 }),
        updatedAt,
      ),
    ).toBeNull();
    expect(
      parseSessionStrategyConfigJson("session-1", "{not-json", updatedAt),
    ).toBeNull();
    expect(parseSessionStrategyConfigJson("session-1", null, updatedAt)).toBe(
      null,
    );
  });

  it("patches strategy JSON without dropping unrelated fields", () => {
    const context = sampleContext();
    const current = buildSessionStrategyConfigJson(context);
    const next = patchSessionStrategyConfigJson(current, {
      riskConfig: { ...context.riskConfig, maxPositionUsd: 750 },
      aiSettings: {
        ...context.aiSettings,
        workerGuidanceMarkdown: "tighter risk",
      },
    });

    expect(next.riskConfig.maxPositionUsd).toBe(750);
    expect(next.aiSettings.workerGuidanceMarkdown).toBe("tighter risk");
    expect(next.rules.rulesPresetId).toBe("catalyst_entry");
    expect(
      buildStrategySnapshot(strategyConfigToContext("s1", next, updatedAt)),
    ).toMatchObject({
      version: 5,
      rules: current.rules,
    });
  });
});

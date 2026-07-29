import { describe, expect, it } from "vitest";
import type { SessionTemplatePayload } from "@/lib/types";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionTemplatesRepo } from "./session-templates-repo";

const NOW = "2026-01-01T00:00:00.000Z";

function minimalTemplatePayload(): SessionTemplatePayload {
  return {
    version: 1,
    identity: {
      objective: "Template objective",
      experienceId: "rules-mean-reversion",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "Large-cap",
      executionMode: "paper_only",
      defaultSearchProviderId: null,
    },
    selectorSettings: { aiPickerEnabled: true },
    strategyContext: {
      researchPosture: {
        sessionId: "s1",
        posturePresetId: "custom",
        processingMode: "manual",
        evidenceMode: "balanced",
        catalystMode: "preferred",
        fundamentalStrictness: "balanced",
        postureNotes: "",
        updatedAt: NOW,
      },
      rules: {
        sessionId: "s1",
        rulesPresetId: "custom",
        setupType: "custom",
        sideBias: "both",
        entryStyle: "catalyst",
        exitStyle: "fixed_pct",
        scalingMode: "single_entry",
        tradeRulesMarkdown: "",
        ruleNotes: "",
        updatedAt: NOW,
      },
      riskConfig: {
        sessionId: "s1",
        riskPresetId: "custom",
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
        maxConcurrentTrades: 3,
        maxConsecutiveLosers: 5,
        volatilityHaltMaxSpreadPct: null,
        dailyLossLimitUsd: 200,
        profitTargetUsd: 1000,
        maxAiSpendUsd: 5,
        maxDataSpendUsd: 5,
        humanApprovalRequired: false,
        updatedAt: NOW,
      },
      timeframe: {
        sessionId: "s1",
        timeframePresetId: "custom",
        primaryTradingTimeframe: "1d",
        holdingStyle: "multi_day_swing",
        targetHoldDays: null,
        maxHoldDays: null,
        timeframeNotes: "",
        updatedAt: NOW,
      },
      aiSettings: {
        sessionId: "s1",
        workerGuidanceMarkdown: "",
        updatedAt: NOW,
      },
    },
    brokerAssignments: [],
    brokerOverridesByInstrumentClass: {},
  };
}

describe("SessionTemplatesRepo", () => {
  it("creates, lists, gets, and deletes templates", () => {
    const db = createTestDb();
    const repo = new SessionTemplatesRepo(db);
    const session = createMinimalSession(db);

    const created = repo.create({
      name: "Swing Template",
      description: "Test template",
      sourceSessionId: session.id,
      payload: minimalTemplatePayload(),
    });

    expect(repo.list()).toMatchObject([
      { id: created.id, name: "Swing Template" },
    ]);
    expect(repo.get(created.id)?.name).toBe("Swing Template");
    expect(repo.delete(created.id)).toBe(true);
    expect(repo.get(created.id)).toBeNull();

    db.sqlite.close();
  });
});

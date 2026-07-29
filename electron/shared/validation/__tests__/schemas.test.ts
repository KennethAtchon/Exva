import { describe, expect, it } from "vitest";
import {
  sessionCreateInputSchema,
  sessionIdParamSchema,
  sessionListFiltersSchema,
  sessionUpdateInputSchema,
  templateCreateInputSchema,
  workspacePrefsPatchSchema,
  listSignalDeadLettersInputSchema,
  replaySignalDeadLetterInputSchema,
} from "../schemas";

const validSessionCreate = {
  name: "Test",
  objective: "Find catalysts",
  selectionMode: "manual_shortlist" as const,
  instrumentClasses: ["stock" as const],
  instrumentScope: "Large cap",
  selectorSettings: { aiPickerEnabled: false },
  executionMode: "paper_only" as const,
  brokerAssignments: [{ brokerAccountId: "broker-1", allocatedUsd: 10_000 }],
};

describe("validation schemas", () => {
  it("accepts valid session create input", () => {
    expect(sessionCreateInputSchema.parse(validSessionCreate)).toMatchObject({
      name: "Test",
      experienceId: "edgar-catalyst",
    });
  });

  it("rejects empty session name", () => {
    expect(() =>
      sessionCreateInputSchema.parse({ ...validSessionCreate, name: "" }),
    ).toThrow();
  });

  it("coerces workspace prefs patch and rejects unknown fields", () => {
    expect(
      workspacePrefsPatchSchema.parse({
        globalIncludeArchived: true,
        autoApproveAssistantTools: true,
      }),
    ).toEqual({ globalIncludeArchived: true, autoApproveAssistantTools: true });
    expect(() =>
      workspacePrefsPatchSchema.parse({
        globalIncludeArchived: true,
        unknownField: true,
      }),
    ).toThrow();
  });

  it("validates session lifecycle inputs", () => {
    expect(sessionIdParamSchema.parse({ sessionId: "s1" })).toEqual({
      sessionId: "s1",
    });
    expect(
      sessionListFiltersSchema.parse({ includeArchived: true }),
    ).toBeDefined();
    expect(
      sessionUpdateInputSchema.parse({
        id: "s1",
        input: { ...validSessionCreate, name: "Renamed" },
      }),
    ).toBeDefined();
  });

  it("validates template and signal dead-letter inputs", () => {
    expect(
      templateCreateInputSchema.parse({
        name: "Template",
        description: "Saved setup",
        sourceSessionId: "s1",
        payload: {
          version: 1,
          identity: {
            objective: "Test",
            experienceId: "rules-mean-reversion",
            selectionMode: "manual_shortlist",
            instrumentClasses: ["stock"],
            instrumentScope: "Large cap",
            executionMode: "paper_only",
            defaultSearchProviderId: null,
          },
          selectorSettings: { aiPickerEnabled: false },
          strategyContext: {
            researchPosture: {
              sessionId: "s1",
              posturePresetId: "custom",
              processingMode: "manual",
              evidenceMode: "balanced",
              catalystMode: "preferred",
              fundamentalStrictness: "balanced",
              postureNotes: "",
              updatedAt: "2026-01-01T00:00:00.000Z",
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
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            riskConfig: {
              sessionId: "s1",
              maxPositionUsd: 100,
              stopLossPct: 2,
              takeProfitPct: 4,
              stopLossType: "fixed_pct",
              atrStopMultiplier: null,
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
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            timeframe: {
              sessionId: "s1",
              primaryTradingTimeframe: "1d",
              holdingStyle: "multi_day_swing",
              targetHoldDays: null,
              maxHoldDays: null,
              timeframeNotes: "",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            aiSettings: {
              sessionId: "s1",
              workerGuidanceMarkdown: "",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
          brokerAssignments: [
            { brokerAccountId: "broker-1", allocatedUsd: 10_000 },
          ],
          brokerOverridesByInstrumentClass: {},
        },
      }),
    ).toBeDefined();
    expect(
      listSignalDeadLettersInputSchema.parse({ sessionId: "s1" }),
    ).toBeDefined();
    expect(
      replaySignalDeadLetterInputSchema.parse({
        sessionId: "s1",
        deadLetterId: "dl-1",
      }),
    ).toBeDefined();
  });
});

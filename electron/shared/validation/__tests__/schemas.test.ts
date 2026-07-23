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
          strategy: {
            strategyProfile: "custom",
            maxPositionUsd: 100,
            stopLossPct: 2,
            takeProfitPct: 4,
            maxConcurrentTrades: 1,
            researchDepth: "balanced",
            dailyLossLimitUsd: 50,
            profitTargetUsd: 200,
            maxAiSpendUsd: 5,
            humanApprovalRequired: false,
            primaryTradingTimeframe: "1d",
            holdingStyle: "multi_day_swing",
            targetHoldDays: null,
            maxHoldDays: null,
            timeframeNotes: "",
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

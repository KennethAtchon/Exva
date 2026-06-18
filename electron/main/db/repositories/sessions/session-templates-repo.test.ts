import { describe, expect, it } from "vitest";
import type { SessionTemplatePayload } from "@/lib/types";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionTemplatesRepo } from "./session-templates-repo";

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
    strategy: {
      strategyProfile: "passive_income",
      maxPositionUsd: 500,
      stopLossPct: 2,
      takeProfitPct: 4,
      maxConcurrentTrades: 3,
      researchDepth: "balanced",
      dailyLossLimitUsd: 200,
      profitTargetUsd: 1000,
      maxAiSpendUsd: 5,
      humanApprovalRequired: false,
      primaryTradingTimeframe: "1d",
      holdingStyle: "multi_day_swing",
      targetHoldDays: null,
      maxHoldDays: null,
      timeframeNotes: "",
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

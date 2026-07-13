import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  builtInGlobalStrategyPresets,
  builtInResearchPosturePresets,
  builtInRiskPresets,
  builtInTimeframePresets,
  builtInTradeRulePresets,
} from "@electron/shared/presets";
import { parseSessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config";
import { createTestDb } from "./test-helpers";
import { createMinimalSession } from "./test-fixtures";
import {
  backfillSessionStrategyConfigs,
  assembleInitialSessionStrategyConfigDoc,
} from "./session-strategy-config-backfill";
import { LEGACY_SESSION_CONFIG_TABLES } from "./drop-legacy-session-config-tables";
import { configPresets, sessionStrategyConfigs, sessions } from "./schema";
import { SessionTemplatesRepo } from "./repositories/sessions/session-templates-repo";
import {
  DEFAULT_RESEARCH_POSTURE_SECTION,
  DEFAULT_RISK_SECTION,
  DEFAULT_TIMEFRAME_SECTION,
  DEFAULT_TRADE_RULES_SECTION,
  defaultAiSection,
} from "@electron/shared/domain/session-strategy-config-defaults";

describe("0008–0010 session strategy config + legacy drop", () => {
  it("creates the three new tables and drops fourteen legacy tables", () => {
    const testDb = createTestDb();
    const names = testDb.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
          'session_strategy_configs', 'config_presets', 'session_strategy_config_history'
        )`,
      )
      .all() as { name: string }[];
    expect(names.map((n) => n.name).sort()).toEqual([
      "config_presets",
      "session_strategy_config_history",
      "session_strategy_configs",
    ]);

    for (const table of LEGACY_SESSION_CONFIG_TABLES) {
      const row = testDb.sqlite
        .prepare(
          `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(table);
      expect(row).toBeUndefined();
    }

    testDb.sqlite.close();
  });

  it("seeds config_presets directly (no legacy preset tables)", () => {
    const testDb = createTestDb();
    const { db } = testDb;

    const expected =
      builtInRiskPresets().length +
      builtInTimeframePresets().length +
      builtInResearchPosturePresets().length +
      builtInTradeRulePresets().length +
      builtInGlobalStrategyPresets().length;

    const configCount = db.select().from(configPresets).all().length;
    expect(configCount).toBe(expected);

    const riskKind = db
      .select()
      .from(configPresets)
      .where(eq(configPresets.kind, "risk"))
      .all();
    expect(riskKind).toHaveLength(builtInRiskPresets().length);
    expect(riskKind.every((r) => r.id.startsWith("risk/"))).toBe(true);

    const fullKind = db
      .select()
      .from(configPresets)
      .where(eq(configPresets.kind, "full"))
      .all();
    expect(fullKind).toHaveLength(builtInGlobalStrategyPresets().length);
    for (const row of fullKind) {
      const doc = parseSessionStrategyConfigDoc(row.doc);
      expect(doc.schemaVersion).toBe(1);
      expect(doc.risk.riskPresetId).toBeTruthy();
    }

    const again = backfillSessionStrategyConfigs(testDb.sqlite);
    expect(again.presetsBackfilled).toBe(0);
    expect(db.select().from(configPresets).all().length).toBe(expected);

    testDb.sqlite.close();
  });

  it("SessionRepo.create writes a Zod-valid session_strategy_configs row", () => {
    const testDb = createTestDb();
    const session = createMinimalSession(testDb);

    const row = testDb.db
      .select()
      .from(sessionStrategyConfigs)
      .where(eq(sessionStrategyConfigs.sessionId, session.id))
      .get();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing config");
    expect(row.version).toBe(1);
    expect(row.schemaVersion).toBe(1);

    const doc = parseSessionStrategyConfigDoc(row.doc);
    expect(doc.strategy.strategyProfile).toBe("passive_income");
    expect(doc.ai.phases.length).toBeGreaterThan(0);
    expect(doc.selector.aiPickerEnabled).toBe(true);

    const sessionCount = testDb.db.select().from(sessions).all().length;
    const configCount = testDb.db
      .select()
      .from(sessionStrategyConfigs)
      .all().length;
    expect(configCount).toBe(sessionCount);

    const again = backfillSessionStrategyConfigs(testDb.sqlite);
    expect(again.sessionsBackfilled).toBe(0);

    testDb.sqlite.close();
  });

  it("maps session_templates to kind full when present", () => {
    const testDb = createTestDb();
    const session = createMinimalSession(testDb);
    backfillSessionStrategyConfigs(testDb.sqlite);

    const templates = new SessionTemplatesRepo(testDb);
    templates.create({
      name: "Fixture Template",
      sourceSessionId: session.id,
      payload: {
        version: 1,
        identity: {
          objective: "Test",
          experienceId: "edgar-catalyst",
          selectionMode: "manual_shortlist",
          instrumentClasses: ["stock"],
          instrumentScope: "Test",
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
        brokerAssignments: [
          { brokerAccountId: "any-broker", allocatedUsd: 1000 },
        ],
        brokerOverridesByInstrumentClass: {},
      },
    });

    const before = testDb.db.select().from(configPresets).all().length;
    const result = backfillSessionStrategyConfigs(testDb.sqlite);
    expect(result.presetsBackfilled).toBe(1);
    expect(testDb.db.select().from(configPresets).all().length).toBe(
      before + 1,
    );

    const templatePreset = testDb.db
      .select()
      .from(configPresets)
      .all()
      .find((r) => r.id.includes("template:"));
    expect(templatePreset).toBeDefined();
    expect(templatePreset?.kind).toBe("full");
    if (!templatePreset) throw new Error("missing template preset");
    parseSessionStrategyConfigDoc(templatePreset.doc);

    testDb.sqlite.close();
  });

  it("aborts loudly when assembling a doc with invalid entryStyle", () => {
    expect(() =>
      assembleInitialSessionStrategyConfigDoc({
        risk: { ...DEFAULT_RISK_SECTION },
        timeframe: { ...DEFAULT_TIMEFRAME_SECTION },
        tradeRules: {
          ...DEFAULT_TRADE_RULES_SECTION,
          entryStyle: "breakout" as never,
        },
        researchPosture: { ...DEFAULT_RESEARCH_POSTURE_SECTION },
        ai: defaultAiSection(),
      }),
    ).toThrow(/entryStyle|Invalid|validation/i);
  });
});

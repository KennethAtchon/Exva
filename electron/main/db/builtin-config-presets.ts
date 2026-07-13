import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type {
  ResearchPosturePreset,
  RiskPreset,
  TimeframePreset,
  TradeRulesPreset,
} from "@electron/shared/domain/session";
import {
  parseSessionStrategyConfigDoc,
  parseSessionStrategyConfigPartialDoc,
  SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
  type ConfigPresetKind,
  type SessionStrategyConfigDoc,
  type SessionStrategyConfigPartialDoc,
} from "@electron/shared/domain/session-strategy-config";
import {
  DEFAULT_RESEARCH_POSTURE_SECTION,
  DEFAULT_RISK_SECTION,
  DEFAULT_STRATEGY_SECTION,
  DEFAULT_TIMEFRAME_SECTION,
  DEFAULT_TRADE_RULES_SECTION,
  defaultSessionStrategyConfigDoc,
} from "@electron/shared/domain/session-strategy-config-defaults";
import {
  builtInGlobalStrategyPresets,
  builtInResearchPosturePresets,
  builtInRiskPresets,
  builtInTimeframePresets,
  builtInTradeRulePresets,
  findResearchPosturePresetById,
  findRiskPresetById,
  findTimeframePresetById,
  findTradeRulePresetById,
  type GlobalStrategyPreset,
} from "@electron/shared/presets";
import * as schema from "./schema";

function presetId(kind: ConfigPresetKind, legacyId: string): string {
  return `${kind}/${legacyId}`;
}

function mergeRisk(
  partial: Partial<typeof DEFAULT_RISK_SECTION> & {
    riskPresetId?: typeof DEFAULT_RISK_SECTION.riskPresetId;
  },
): typeof DEFAULT_RISK_SECTION {
  return {
    ...DEFAULT_RISK_SECTION,
    ...partial,
    riskPresetId: partial.riskPresetId ?? DEFAULT_RISK_SECTION.riskPresetId,
  };
}

function mergeTimeframe(
  partial: Partial<typeof DEFAULT_TIMEFRAME_SECTION> & {
    timeframePresetId?: typeof DEFAULT_TIMEFRAME_SECTION.timeframePresetId;
  },
): typeof DEFAULT_TIMEFRAME_SECTION {
  return {
    ...DEFAULT_TIMEFRAME_SECTION,
    ...partial,
    timeframePresetId:
      partial.timeframePresetId ?? DEFAULT_TIMEFRAME_SECTION.timeframePresetId,
  };
}

function mergeTradeRules(
  partial: Partial<typeof DEFAULT_TRADE_RULES_SECTION>,
): typeof DEFAULT_TRADE_RULES_SECTION {
  return { ...DEFAULT_TRADE_RULES_SECTION, ...partial };
}

function mergeResearchPosture(
  partial: Partial<typeof DEFAULT_RESEARCH_POSTURE_SECTION>,
): typeof DEFAULT_RESEARCH_POSTURE_SECTION {
  return { ...DEFAULT_RESEARCH_POSTURE_SECTION, ...partial };
}

/** Assemble a full strategy doc from the four component built-in presets. */
export function assembleFullDocFromComponentPresets(ids: {
  posturePresetId: string;
  rulesPresetId: string;
  riskPresetId: string;
  timeframePresetId: string;
}): SessionStrategyConfigDoc {
  const posture = findResearchPosturePresetById(
    ids.posturePresetId as ResearchPosturePreset["id"],
  );
  const rules = findTradeRulePresetById(
    ids.rulesPresetId as TradeRulesPreset["id"],
  );
  const risk = findRiskPresetById(ids.riskPresetId as RiskPreset["id"]);
  const timeframe = findTimeframePresetById(
    ids.timeframePresetId as TimeframePreset["id"],
  );

  if (!posture || !rules || !risk || !timeframe) {
    throw new Error(
      `Cannot resolve full preset — missing component preset(s) for ` +
        `posture=${ids.posturePresetId} rules=${ids.rulesPresetId} ` +
        `risk=${ids.riskPresetId} timeframe=${ids.timeframePresetId}`,
    );
  }

  const doc: SessionStrategyConfigDoc = {
    ...defaultSessionStrategyConfigDoc(),
    researchPosture: mergeResearchPosture({
      ...posture.posture,
      postureNotes: "",
    }),
    tradeRules: mergeTradeRules({
      ...rules.rules,
      tradeRulesMarkdown: "",
      ruleNotes: "",
    }),
    risk: mergeRisk({
      riskPresetId: risk.id,
      ...risk.values,
    }),
    timeframe: mergeTimeframe({
      timeframePresetId: timeframe.id,
      ...timeframe.values,
    }),
    strategy: {
      ...DEFAULT_STRATEGY_SECTION,
      maxPositionUsd:
        risk.values.maxPositionUsd ?? DEFAULT_STRATEGY_SECTION.maxPositionUsd,
      stopLossPct:
        risk.values.stopLossPct ?? DEFAULT_STRATEGY_SECTION.stopLossPct,
      takeProfitPct:
        risk.values.takeProfitPct ?? DEFAULT_STRATEGY_SECTION.takeProfitPct,
      maxConcurrentTrades:
        risk.values.maxConcurrentTrades ??
        DEFAULT_STRATEGY_SECTION.maxConcurrentTrades,
      dailyLossLimitUsd:
        risk.values.dailyLossLimitUsd ??
        DEFAULT_STRATEGY_SECTION.dailyLossLimitUsd,
      profitTargetUsd:
        risk.values.profitTargetUsd ?? DEFAULT_STRATEGY_SECTION.profitTargetUsd,
      maxAiSpendUsd:
        risk.values.maxAiSpendUsd ?? DEFAULT_STRATEGY_SECTION.maxAiSpendUsd,
      humanApprovalRequired:
        risk.values.humanApprovalRequired ??
        DEFAULT_STRATEGY_SECTION.humanApprovalRequired,
      primaryTradingTimeframe:
        timeframe.values.primaryTradingTimeframe ??
        DEFAULT_STRATEGY_SECTION.primaryTradingTimeframe,
      holdingStyle:
        timeframe.values.holdingStyle ?? DEFAULT_STRATEGY_SECTION.holdingStyle,
      targetHoldDays:
        timeframe.values.targetHoldDays ??
        DEFAULT_STRATEGY_SECTION.targetHoldDays,
      maxHoldDays:
        timeframe.values.maxHoldDays ?? DEFAULT_STRATEGY_SECTION.maxHoldDays,
      timeframeNotes:
        timeframe.values.timeframeNotes ??
        DEFAULT_STRATEGY_SECTION.timeframeNotes,
    },
  };

  return parseSessionStrategyConfigDoc(doc);
}

function insertIfAbsent(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    id: string;
    name: string;
    kind: ConfigPresetKind;
    doc: SessionStrategyConfigPartialDoc | SessionStrategyConfigDoc;
    builtin: boolean;
    updatedAt: string;
  },
): void {
  const existing = db
    .select({ id: schema.configPresets.id })
    .from(schema.configPresets)
    .where(eq(schema.configPresets.id, input.id))
    .get();
  if (existing) return;

  const validated =
    input.kind === "full"
      ? parseSessionStrategyConfigDoc(input.doc)
      : parseSessionStrategyConfigPartialDoc(input.doc);

  db.insert(schema.configPresets)
    .values({
      id: input.id,
      name: input.name,
      kind: input.kind,
      doc: validated,
      builtin: input.builtin,
      updatedAt: input.updatedAt,
    })
    .run();
}

/** Idempotent seed of built-in rows into config_presets (post–legacy-table drop). */
export function seedBuiltinConfigPresets(
  db: BetterSQLite3Database<typeof schema>,
): void {
  const now = new Date().toISOString();

  for (const preset of builtInRiskPresets()) {
    insertIfAbsent(db, {
      id: presetId("risk", preset.id),
      name: preset.label,
      kind: "risk",
      doc: {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        risk: mergeRisk({ riskPresetId: preset.id, ...preset.values }),
      },
      builtin: true,
      updatedAt: now,
    });
  }

  for (const preset of builtInTimeframePresets()) {
    insertIfAbsent(db, {
      id: presetId("timeframe", preset.id),
      name: preset.label,
      kind: "timeframe",
      doc: {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        timeframe: mergeTimeframe({
          timeframePresetId: preset.id,
          ...preset.values,
        }),
      },
      builtin: true,
      updatedAt: now,
    });
  }

  for (const preset of builtInResearchPosturePresets()) {
    insertIfAbsent(db, {
      id: presetId("research", preset.id),
      name: preset.label,
      kind: "research",
      doc: {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        researchPosture: mergeResearchPosture({
          ...preset.posture,
          postureNotes: "",
        }),
      },
      builtin: true,
      updatedAt: now,
    });
  }

  for (const preset of builtInTradeRulePresets()) {
    insertIfAbsent(db, {
      id: presetId("rules", preset.id),
      name: preset.label,
      kind: "rules",
      doc: {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        tradeRules: mergeTradeRules({
          ...preset.rules,
          tradeRulesMarkdown: "",
          ruleNotes: "",
        }),
      },
      builtin: true,
      updatedAt: now,
    });
  }

  for (const preset of builtInGlobalStrategyPresets() as readonly GlobalStrategyPreset[]) {
    insertIfAbsent(db, {
      id: presetId("full", preset.id),
      name: preset.label,
      kind: "full",
      doc: assembleFullDocFromComponentPresets({
        posturePresetId: preset.posturePresetId,
        rulesPresetId: preset.rulesPresetId,
        riskPresetId: preset.riskPresetId,
        timeframePresetId: preset.timeframePresetId,
      }),
      builtin: true,
      updatedAt: now,
    });
  }
}

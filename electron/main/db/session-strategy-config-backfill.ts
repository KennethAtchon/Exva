import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { GlobalStrategyPreset } from "@electron/shared/presets";
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
  DEFAULT_TIMEFRAME_SECTION,
  DEFAULT_TRADE_RULES_SECTION,
  defaultAiSection,
  defaultSessionStrategyConfigDoc,
} from "@electron/shared/domain/session-strategy-config-defaults";
import { sessionTemplatePayloadSchema } from "@electron/shared/validation/schemas";
import { assembleFullDocFromComponentPresets } from "./builtin-config-presets";
import * as schema from "./schema";
import {
  requireJsonParse,
  safeJsonParse,
} from "../services/infra/safe-json-parse";

export type BackfillResult = {
  sessionsBackfilled: number;
  presetsBackfilled: number;
};

function presetId(kind: ConfigPresetKind, legacyId: string): string {
  return `${kind}/${legacyId}`;
}

function legacyTableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
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

type LegacyStrategyRow = {
  strategy_profile: string;
  max_position_usd: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  max_concurrent_trades: number;
  research_depth: string;
  daily_loss_limit_usd: number;
  profit_target_usd: number;
  max_ai_spend_usd: number;
  human_approval_required: number;
  primary_trading_timeframe: string;
  holding_style: string;
  target_hold_days: number | null;
  max_hold_days: number | null;
  timeframe_notes: string;
};

type LegacyRiskRow = {
  risk_preset_id: string;
  off_hours_trading: string;
  max_position_usd: number;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  stop_loss_type: string;
  atr_stop_multiplier: number | null;
  kelly_fraction: number;
  prediction_edge_threshold: number;
  max_exposure_usd: number | null;
  wait_for_open_threshold: number;
  max_concurrent_trades: number;
  max_consecutive_losers: number;
  volatility_halt_max_spread_pct: number | null;
  daily_loss_limit_usd: number;
  profit_target_usd: number;
  max_ai_spend_usd: number;
  max_data_spend_usd: number;
  human_approval_required: number;
};

type LegacyTimeframeRow = {
  timeframe_preset_id: string;
  primary_trading_timeframe: string;
  holding_style: string;
  target_hold_days: number | null;
  max_hold_days: number | null;
  timeframe_notes: string;
};

type LegacyTradeRulesRow = {
  rules_preset_id: string;
  setup_type: string;
  side_bias: string;
  entry_style: string;
  exit_style: string;
  scaling_mode: string;
  trade_rules_markdown: string;
  rule_notes: string;
};

type LegacyResearchRow = {
  posture_preset_id: string;
  processing_mode: string;
  evidence_mode: string;
  catalyst_mode: string;
  fundamental_strictness: string;
  posture_notes: string;
};

type LegacyAiSettingsRow = {
  worker_guidance_markdown: string;
};

type LegacyPhaseRow = {
  phase: string;
  provider_key: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
  reasoning_level: string;
  prompt_source: string;
  prompt_markdown: string;
};

type LegacyWorkerRow = {
  phase: string;
  worker_id: string;
  provider_key: string | null;
  model_id: string | null;
  max_steps: number | null;
  spend_limit_usd: number | null;
  prompt_markdown: string | null;
};

type LegacySelectorRow = {
  ai_picker_enabled: number;
  no_instrument_retry_minutes: number | null;
};

const REQUIRED_LEGACY_SESSION_TABLES = [
  "session_strategies",
  "session_risk_config",
  "session_timeframe_config",
  "session_trade_rules",
  "session_research_posture",
  "session_ai_settings",
  "session_selector_settings",
] as const;

function requireLegacySessionRow<T>(
  sqlite: Database.Database,
  table: string,
  sessionId: string,
): T {
  if (!legacyTableExists(sqlite, table)) {
    throw new Error(
      `0009: session '${sessionId}' missing legacy table '${table}' during config backfill`,
    );
  }
  const row = sqlite
    .prepare(`SELECT * FROM "${table}" WHERE session_id = ?`)
    .get(sessionId) as T | undefined;
  if (!row) {
    throw new Error(
      `0009: session '${sessionId}' missing required row in legacy table '${table}'`,
    );
  }
  return row;
}

function assembleSessionDocFromLegacy(
  sqlite: Database.Database,
  sessionId: string,
): SessionStrategyConfigDoc {
  const strategyRow = requireLegacySessionRow<LegacyStrategyRow>(
    sqlite,
    "session_strategies",
    sessionId,
  );
  const riskRow = requireLegacySessionRow<LegacyRiskRow>(
    sqlite,
    "session_risk_config",
    sessionId,
  );
  const timeframeRow = requireLegacySessionRow<LegacyTimeframeRow>(
    sqlite,
    "session_timeframe_config",
    sessionId,
  );
  const tradeRulesRow = requireLegacySessionRow<LegacyTradeRulesRow>(
    sqlite,
    "session_trade_rules",
    sessionId,
  );
  const researchRow = requireLegacySessionRow<LegacyResearchRow>(
    sqlite,
    "session_research_posture",
    sessionId,
  );
  const aiSettingsRow = requireLegacySessionRow<LegacyAiSettingsRow>(
    sqlite,
    "session_ai_settings",
    sessionId,
  );
  const selectorRow = requireLegacySessionRow<LegacySelectorRow>(
    sqlite,
    "session_selector_settings",
    sessionId,
  );
  const phaseRows = legacyTableExists(sqlite, "session_ai_phases")
    ? (sqlite
        .prepare(`SELECT * FROM session_ai_phases WHERE session_id = ?`)
        .all(sessionId) as LegacyPhaseRow[])
    : [];
  const workerRows = legacyTableExists(sqlite, "session_ai_phase_workers")
    ? (sqlite
        .prepare(`SELECT * FROM session_ai_phase_workers WHERE session_id = ?`)
        .all(sessionId) as LegacyWorkerRow[])
    : [];

  type BaseDoc = ReturnType<typeof defaultSessionStrategyConfigDoc>;

  const strategy = {
    strategyProfile:
      strategyRow.strategy_profile as BaseDoc["strategy"]["strategyProfile"],
    maxPositionUsd: strategyRow.max_position_usd,
    stopLossPct: strategyRow.stop_loss_pct,
    takeProfitPct: strategyRow.take_profit_pct,
    maxConcurrentTrades: strategyRow.max_concurrent_trades,
    researchDepth:
      strategyRow.research_depth as BaseDoc["strategy"]["researchDepth"],
    dailyLossLimitUsd: strategyRow.daily_loss_limit_usd,
    profitTargetUsd: strategyRow.profit_target_usd,
    maxAiSpendUsd: strategyRow.max_ai_spend_usd,
    humanApprovalRequired: Boolean(strategyRow.human_approval_required),
    primaryTradingTimeframe:
      strategyRow.primary_trading_timeframe as BaseDoc["strategy"]["primaryTradingTimeframe"],
    holdingStyle:
      strategyRow.holding_style as BaseDoc["strategy"]["holdingStyle"],
    targetHoldDays: strategyRow.target_hold_days,
    maxHoldDays: strategyRow.max_hold_days,
    timeframeNotes: strategyRow.timeframe_notes,
  };

  const risk = {
    riskPresetId: riskRow.risk_preset_id as BaseDoc["risk"]["riskPresetId"],
    offHoursTrading:
      riskRow.off_hours_trading as BaseDoc["risk"]["offHoursTrading"],
    maxPositionUsd: riskRow.max_position_usd,
    stopLossPct: riskRow.stop_loss_pct,
    takeProfitPct: riskRow.take_profit_pct,
    stopLossType: riskRow.stop_loss_type as BaseDoc["risk"]["stopLossType"],
    atrStopMultiplier: riskRow.atr_stop_multiplier,
    kellyFraction: riskRow.kelly_fraction,
    predictionEdgeThreshold: riskRow.prediction_edge_threshold,
    maxExposureUsd: riskRow.max_exposure_usd,
    waitForOpenThreshold: riskRow.wait_for_open_threshold,
    maxConcurrentTrades: riskRow.max_concurrent_trades,
    maxConsecutiveLosers: riskRow.max_consecutive_losers,
    volatilityHaltMaxSpreadPct: riskRow.volatility_halt_max_spread_pct,
    dailyLossLimitUsd: riskRow.daily_loss_limit_usd,
    profitTargetUsd: riskRow.profit_target_usd,
    maxAiSpendUsd: riskRow.max_ai_spend_usd,
    maxDataSpendUsd: riskRow.max_data_spend_usd,
    humanApprovalRequired: Boolean(riskRow.human_approval_required),
    calendarBlackoutHours: 24,
    eventTypedExperience: false,
  };

  const timeframe = {
    timeframePresetId:
      timeframeRow.timeframe_preset_id as BaseDoc["timeframe"]["timeframePresetId"],
    primaryTradingTimeframe:
      timeframeRow.primary_trading_timeframe as BaseDoc["timeframe"]["primaryTradingTimeframe"],
    holdingStyle:
      timeframeRow.holding_style as BaseDoc["timeframe"]["holdingStyle"],
    targetHoldDays: timeframeRow.target_hold_days,
    maxHoldDays: timeframeRow.max_hold_days,
    timeframeNotes: timeframeRow.timeframe_notes,
  };

  const tradeRules = {
    rulesPresetId:
      tradeRulesRow.rules_preset_id as BaseDoc["tradeRules"]["rulesPresetId"],
    setupType: tradeRulesRow.setup_type as BaseDoc["tradeRules"]["setupType"],
    sideBias: tradeRulesRow.side_bias as BaseDoc["tradeRules"]["sideBias"],
    entryStyle:
      tradeRulesRow.entry_style as BaseDoc["tradeRules"]["entryStyle"],
    exitStyle: tradeRulesRow.exit_style as BaseDoc["tradeRules"]["exitStyle"],
    scalingMode:
      tradeRulesRow.scaling_mode as BaseDoc["tradeRules"]["scalingMode"],
    tradeRulesMarkdown: tradeRulesRow.trade_rules_markdown,
    ruleNotes: tradeRulesRow.rule_notes,
  };

  const researchPosture = {
    posturePresetId:
      researchRow.posture_preset_id as BaseDoc["researchPosture"]["posturePresetId"],
    processingMode:
      researchRow.processing_mode as BaseDoc["researchPosture"]["processingMode"],
    evidenceMode:
      researchRow.evidence_mode as BaseDoc["researchPosture"]["evidenceMode"],
    catalystMode:
      researchRow.catalyst_mode as BaseDoc["researchPosture"]["catalystMode"],
    fundamentalStrictness:
      researchRow.fundamental_strictness as BaseDoc["researchPosture"]["fundamentalStrictness"],
    postureNotes: researchRow.posture_notes,
  };

  const workersByPhase = new Map<string, LegacyWorkerRow[]>();
  for (const w of workerRows) {
    const list = workersByPhase.get(w.phase) ?? [];
    list.push(w);
    workersByPhase.set(w.phase, list);
  }

  const ai = {
    settings: {
      workerGuidanceMarkdown: aiSettingsRow.worker_guidance_markdown ?? "",
    },
    phases:
      phaseRows.length > 0
        ? phaseRows.map((p) => ({
            phase: p.phase as BaseDoc["ai"]["phases"][number]["phase"],
            providerKey: p.provider_key,
            modelId: p.model_id,
            temperature: p.temperature,
            maxTokens: p.max_tokens,
            reasoningLevel:
              p.reasoning_level as BaseDoc["ai"]["phases"][number]["reasoningLevel"],
            promptSource:
              p.prompt_source as BaseDoc["ai"]["phases"][number]["promptSource"],
            promptMarkdown: p.prompt_markdown,
            workers: (workersByPhase.get(p.phase) ?? []).map((w) => ({
              workerId: w.worker_id,
              providerKey: w.provider_key ?? null,
              modelId: w.model_id ?? null,
              maxSteps: w.max_steps ?? null,
              spendLimitUsd: w.spend_limit_usd ?? null,
              promptMarkdown: w.prompt_markdown ?? null,
            })),
          }))
        : defaultAiSection().phases,
  };

  const selector = {
    aiPickerEnabled: Boolean(selectorRow.ai_picker_enabled),
    noInstrumentRetryMinutes: selectorRow.no_instrument_retry_minutes,
  };

  const raw: SessionStrategyConfigDoc = {
    schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
    strategy,
    risk,
    timeframe,
    tradeRules,
    researchPosture,
    ai,
    selector,
  };

  try {
    return parseSessionStrategyConfigDoc(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `0009: session_strategy_config backfill failed Zod validation for session '${sessionId}': ${detail}`,
    );
  }
}

function insertConfigPreset(
  db: ReturnType<typeof drizzle<typeof schema>>,
  input: {
    id: string;
    name: string;
    kind: ConfigPresetKind;
    doc: SessionStrategyConfigPartialDoc | SessionStrategyConfigDoc;
    builtin: boolean;
    updatedAt: string;
  },
): boolean {
  const existing = db
    .select()
    .from(schema.configPresets)
    .where(eq(schema.configPresets.id, input.id))
    .get();
  if (existing) {
    try {
      if (existing.kind === "full") {
        parseSessionStrategyConfigDoc(existing.doc);
      } else {
        parseSessionStrategyConfigPartialDoc(existing.doc);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `0009: existing config_presets row '${existing.id}' failed Zod validation: ${detail}`,
      );
    }
    return false;
  }

  let validated: SessionStrategyConfigPartialDoc | SessionStrategyConfigDoc;
  try {
    if (input.kind === "full") {
      validated = parseSessionStrategyConfigDoc(input.doc);
    } else {
      validated = parseSessionStrategyConfigPartialDoc(input.doc);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `0009: config_presets backfill failed Zod validation for '${input.id}' (kind=${input.kind}): ${detail}`,
    );
  }

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
  return true;
}

type LegacyPresetRow = {
  id: string;
  label?: string;
  name?: string;
  is_built_in: number;
  preset_json: string;
};

function backfillPresetsFromLegacy(
  sqlite: Database.Database,
  db: ReturnType<typeof drizzle<typeof schema>>,
  now: string,
): number {
  let count = 0;

  if (legacyTableExists(sqlite, "risk_presets")) {
    const rows = sqlite
      .prepare(`SELECT id, label, is_built_in, preset_json FROM risk_presets`)
      .all() as LegacyPresetRow[];
    for (const row of rows) {
      const preset = requireJsonParse<RiskPreset>(
        row.preset_json,
        undefined,
        `Invalid risk_presets.preset_json for ${row.id}`,
      );
      const doc: SessionStrategyConfigPartialDoc = {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        risk: mergeRisk({ riskPresetId: preset.id, ...preset.values }),
      };
      if (
        insertConfigPreset(db, {
          id: presetId("risk", row.id),
          name: row.label ?? preset.label,
          kind: "risk",
          doc,
          builtin: Boolean(row.is_built_in),
          updatedAt: now,
        })
      ) {
        count += 1;
      }
    }
  }

  if (legacyTableExists(sqlite, "timeframe_presets")) {
    const rows = sqlite
      .prepare(
        `SELECT id, label, is_built_in, preset_json FROM timeframe_presets`,
      )
      .all() as LegacyPresetRow[];
    for (const row of rows) {
      const preset = requireJsonParse<TimeframePreset>(
        row.preset_json,
        undefined,
        `Invalid timeframe_presets.preset_json for ${row.id}`,
      );
      const doc: SessionStrategyConfigPartialDoc = {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        timeframe: mergeTimeframe({
          timeframePresetId: preset.id,
          ...preset.values,
        }),
      };
      if (
        insertConfigPreset(db, {
          id: presetId("timeframe", row.id),
          name: row.label ?? preset.label,
          kind: "timeframe",
          doc,
          builtin: Boolean(row.is_built_in),
          updatedAt: now,
        })
      ) {
        count += 1;
      }
    }
  }

  if (legacyTableExists(sqlite, "research_posture_presets")) {
    const rows = sqlite
      .prepare(
        `SELECT id, label, is_built_in, preset_json FROM research_posture_presets`,
      )
      .all() as LegacyPresetRow[];
    for (const row of rows) {
      const preset = requireJsonParse<ResearchPosturePreset>(
        row.preset_json,
        undefined,
        `Invalid research_posture_presets.preset_json for ${row.id}`,
      );
      const doc: SessionStrategyConfigPartialDoc = {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        researchPosture: mergeResearchPosture({
          ...preset.posture,
          postureNotes: "",
        }),
      };
      if (
        insertConfigPreset(db, {
          id: presetId("research", row.id),
          name: row.label ?? preset.label,
          kind: "research",
          doc,
          builtin: Boolean(row.is_built_in),
          updatedAt: now,
        })
      ) {
        count += 1;
      }
    }
  }

  if (legacyTableExists(sqlite, "trade_rule_presets")) {
    const rows = sqlite
      .prepare(
        `SELECT id, label, is_built_in, preset_json FROM trade_rule_presets`,
      )
      .all() as LegacyPresetRow[];
    for (const row of rows) {
      const preset = requireJsonParse<TradeRulesPreset>(
        row.preset_json,
        undefined,
        `Invalid trade_rules_presets.preset_json for ${row.id}`,
      );
      const doc: SessionStrategyConfigPartialDoc = {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        tradeRules: mergeTradeRules({
          ...preset.rules,
          tradeRulesMarkdown: "",
          ruleNotes: "",
        }),
      };
      if (
        insertConfigPreset(db, {
          id: presetId("rules", row.id),
          name: row.label ?? preset.label,
          kind: "rules",
          doc,
          builtin: Boolean(row.is_built_in),
          updatedAt: now,
        })
      ) {
        count += 1;
      }
    }
  }

  if (legacyTableExists(sqlite, "global_presets")) {
    const rows = sqlite
      .prepare(`SELECT id, name, is_built_in, preset_json FROM global_presets`)
      .all() as LegacyPresetRow[];
    for (const row of rows) {
      const preset = requireJsonParse<GlobalStrategyPreset>(
        row.preset_json,
        undefined,
        `Invalid global_strategy_presets.preset_json for ${row.id}`,
      );
      const doc = assembleFullDocFromComponentPresets({
        posturePresetId: preset.posturePresetId,
        rulesPresetId: preset.rulesPresetId,
        riskPresetId: preset.riskPresetId,
        timeframePresetId: preset.timeframePresetId,
      });
      if (
        insertConfigPreset(db, {
          id: presetId("full", row.id),
          name: row.name ?? preset.label,
          kind: "full",
          doc,
          builtin: Boolean(row.is_built_in),
          updatedAt: now,
        })
      ) {
        count += 1;
      }
    }
  }

  // session_templates remain a distinct feature; still map copies into
  // config_presets kind:full for strategy preset reuse when present.
  for (const row of db.select().from(schema.sessionTemplates).all()) {
    const parsed = safeJsonParse(
      row.templatePayloadJson,
      undefined,
      "session-strategy-config-backfill.templatePayload",
    );
    const payload = sessionTemplatePayloadSchema.safeParse(parsed);
    if (!payload.success) {
      throw new Error(
        `0009: session_templates '${row.id}' payload failed validation: ${payload.error.message}`,
      );
    }

    const p = payload.data;
    let doc: SessionStrategyConfigDoc;

    if (p.strategyContext) {
      const ctx = p.strategyContext;
      doc = parseSessionStrategyConfigDoc({
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        strategy: {
          strategyProfile: p.strategy.strategyProfile,
          maxPositionUsd: p.strategy.maxPositionUsd,
          stopLossPct: p.strategy.stopLossPct,
          takeProfitPct: p.strategy.takeProfitPct,
          maxConcurrentTrades: p.strategy.maxConcurrentTrades,
          researchDepth: p.strategy.researchDepth,
          dailyLossLimitUsd: p.strategy.dailyLossLimitUsd,
          profitTargetUsd: p.strategy.profitTargetUsd,
          maxAiSpendUsd: p.strategy.maxAiSpendUsd,
          humanApprovalRequired: p.strategy.humanApprovalRequired,
          primaryTradingTimeframe: p.strategy.primaryTradingTimeframe,
          holdingStyle: p.strategy.holdingStyle,
          targetHoldDays: p.strategy.targetHoldDays ?? null,
          maxHoldDays: p.strategy.maxHoldDays ?? null,
          timeframeNotes: p.strategy.timeframeNotes ?? "",
        },
        risk: {
          riskPresetId: ctx.riskConfig.riskPresetId,
          offHoursTrading: ctx.riskConfig.offHoursTrading,
          maxPositionUsd: ctx.riskConfig.maxPositionUsd,
          stopLossPct: ctx.riskConfig.stopLossPct,
          takeProfitPct: ctx.riskConfig.takeProfitPct,
          stopLossType: ctx.riskConfig.stopLossType,
          atrStopMultiplier: ctx.riskConfig.atrStopMultiplier,
          kellyFraction: ctx.riskConfig.kellyFraction,
          predictionEdgeThreshold: ctx.riskConfig.predictionEdgeThreshold,
          maxExposureUsd: ctx.riskConfig.maxExposureUsd,
          waitForOpenThreshold: ctx.riskConfig.waitForOpenThreshold,
          maxConcurrentTrades: ctx.riskConfig.maxConcurrentTrades,
          maxConsecutiveLosers: ctx.riskConfig.maxConsecutiveLosers,
          volatilityHaltMaxSpreadPct: ctx.riskConfig.volatilityHaltMaxSpreadPct,
          dailyLossLimitUsd: ctx.riskConfig.dailyLossLimitUsd,
          profitTargetUsd: ctx.riskConfig.profitTargetUsd,
          maxAiSpendUsd: ctx.riskConfig.maxAiSpendUsd,
          maxDataSpendUsd: ctx.riskConfig.maxDataSpendUsd,
          humanApprovalRequired: ctx.riskConfig.humanApprovalRequired,
        },
        timeframe: {
          timeframePresetId: ctx.timeframe.timeframePresetId,
          primaryTradingTimeframe: ctx.timeframe.primaryTradingTimeframe,
          holdingStyle: ctx.timeframe.holdingStyle,
          targetHoldDays: ctx.timeframe.targetHoldDays,
          maxHoldDays: ctx.timeframe.maxHoldDays,
          timeframeNotes: ctx.timeframe.timeframeNotes,
        },
        tradeRules: {
          rulesPresetId: ctx.rules.rulesPresetId,
          setupType: ctx.rules.setupType,
          sideBias: ctx.rules.sideBias,
          entryStyle: ctx.rules.entryStyle,
          exitStyle: ctx.rules.exitStyle,
          scalingMode: ctx.rules.scalingMode,
          tradeRulesMarkdown: ctx.rules.tradeRulesMarkdown,
          ruleNotes: ctx.rules.ruleNotes,
        },
        researchPosture: {
          posturePresetId: ctx.researchPosture.posturePresetId,
          processingMode: ctx.researchPosture.processingMode,
          evidenceMode: ctx.researchPosture.evidenceMode,
          catalystMode: ctx.researchPosture.catalystMode,
          fundamentalStrictness: ctx.researchPosture.fundamentalStrictness,
          postureNotes: ctx.researchPosture.postureNotes,
        },
        ai: {
          settings: {
            workerGuidanceMarkdown: ctx.aiSettings.workerGuidanceMarkdown,
          },
          phases: defaultAiSection().phases,
        },
        selector: {
          aiPickerEnabled: p.selectorSettings.aiPickerEnabled,
          noInstrumentRetryMinutes: null,
        },
      });
    } else {
      doc = parseSessionStrategyConfigDoc({
        ...defaultSessionStrategyConfigDoc(),
        strategy: {
          strategyProfile: p.strategy.strategyProfile,
          maxPositionUsd: p.strategy.maxPositionUsd,
          stopLossPct: p.strategy.stopLossPct,
          takeProfitPct: p.strategy.takeProfitPct,
          maxConcurrentTrades: p.strategy.maxConcurrentTrades,
          researchDepth: p.strategy.researchDepth,
          dailyLossLimitUsd: p.strategy.dailyLossLimitUsd,
          profitTargetUsd: p.strategy.profitTargetUsd,
          maxAiSpendUsd: p.strategy.maxAiSpendUsd,
          humanApprovalRequired: p.strategy.humanApprovalRequired,
          primaryTradingTimeframe: p.strategy.primaryTradingTimeframe,
          holdingStyle: p.strategy.holdingStyle,
          targetHoldDays: p.strategy.targetHoldDays ?? null,
          maxHoldDays: p.strategy.maxHoldDays ?? null,
          timeframeNotes: p.strategy.timeframeNotes ?? "",
        },
        selector: {
          aiPickerEnabled: p.selectorSettings.aiPickerEnabled,
          noInstrumentRetryMinutes: null,
        },
      });
    }

    if (
      insertConfigPreset(db, {
        id: presetId("full", `template:${row.id}`),
        name: row.name,
        kind: "full",
        doc,
        builtin: false,
        updatedAt: row.updatedAt || now,
      })
    ) {
      count += 1;
    }
  }

  return count;
}

/**
 * Idempotent backfill: for every session missing a session_strategy_configs row,
 * assemble the doc from the nine legacy tables (when still present), Zod-validate,
 * insert version=1. Same for legacy preset tables → config_presets.
 * Aborts loudly on any validation failure.
 * No-ops cleanly after T5 drop when legacy tables are gone and seed already
 * wrote config_presets.
 */
export function backfillSessionStrategyConfigs(
  sqlite: Database.Database,
): BackfillResult {
  const db = drizzle(sqlite, { schema });
  const now = new Date().toISOString();

  const sessions = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .all();
  let sessionsBackfilled = 0;

  const hasLegacySessionTables = REQUIRED_LEGACY_SESSION_TABLES.every((name) =>
    legacyTableExists(sqlite, name),
  );

  for (const { id: sessionId } of sessions) {
    const existing = db
      .select()
      .from(schema.sessionStrategyConfigs)
      .where(eq(schema.sessionStrategyConfigs.sessionId, sessionId))
      .get();
    if (existing) {
      try {
        parseSessionStrategyConfigDoc(existing.doc);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `0009: existing session_strategy_configs for '${sessionId}' failed Zod validation: ${detail}`,
        );
      }
      continue;
    }

    if (!hasLegacySessionTables) {
      throw new Error(
        `0009: session '${sessionId}' has no session_strategy_configs row and legacy tables are gone — cannot backfill`,
      );
    }

    const doc = assembleSessionDocFromLegacy(sqlite, sessionId);
    db.insert(schema.sessionStrategyConfigs)
      .values({
        sessionId,
        version: 1,
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        doc,
        updatedAt: now,
      })
      .run();
    sessionsBackfilled += 1;
  }

  const presetsBackfilled = backfillPresetsFromLegacy(sqlite, db, now);

  return { sessionsBackfilled, presetsBackfilled };
}

/**
 * Assert every session has exactly one valid config document and every preset
 * Zod-parses before legacy recovery tables are dropped.
 */
export function assertSessionStrategyConfigPreservation(
  sqlite: Database.Database,
): void {
  const db = drizzle(sqlite, { schema });
  const sessionRows = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .all();

  for (const { id: sessionId } of sessionRows) {
    const configs = db
      .select()
      .from(schema.sessionStrategyConfigs)
      .where(eq(schema.sessionStrategyConfigs.sessionId, sessionId))
      .all();
    if (configs.length !== 1) {
      throw new Error(
        `0010: expected exactly one session_strategy_configs row for session '${sessionId}', found ${configs.length}`,
      );
    }
    const config = configs[0];
    if (!config) {
      throw new Error(
        `0010: missing session_strategy_configs row for session '${sessionId}'`,
      );
    }
    try {
      parseSessionStrategyConfigDoc(config.doc);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `0010: session_strategy_configs for '${sessionId}' failed Zod validation before drop: ${detail}`,
      );
    }
  }

  const presets = db.select().from(schema.configPresets).all();
  for (const preset of presets) {
    try {
      if (preset.kind === "full") {
        parseSessionStrategyConfigDoc(preset.doc);
      } else {
        parseSessionStrategyConfigPartialDoc(preset.doc);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `0010: config_presets '${preset.id}' failed Zod validation before drop: ${detail}`,
      );
    }
  }

  const fkViolations = sqlite.prepare("PRAGMA foreign_key_check").all();
  if (fkViolations.length > 0) {
    throw new Error(
      `0010: foreign_key_check failed before legacy drop (${fkViolations.length} violation(s))`,
    );
  }
}

/**
 * Assemble a validated initial doc for SessionRepo.create / experience bootstrap
 * from the same defaults + preset bundle values used for legacy table seeds.
 */
export function assembleInitialSessionStrategyConfigDoc(input: {
  strategy?: Partial<SessionStrategyConfigDoc["strategy"]>;
  risk: SessionStrategyConfigDoc["risk"];
  timeframe: SessionStrategyConfigDoc["timeframe"];
  tradeRules: SessionStrategyConfigDoc["tradeRules"];
  researchPosture: SessionStrategyConfigDoc["researchPosture"];
  ai: SessionStrategyConfigDoc["ai"];
  selector?: Partial<SessionStrategyConfigDoc["selector"]>;
}): SessionStrategyConfigDoc {
  const base = defaultSessionStrategyConfigDoc();
  return parseSessionStrategyConfigDoc({
    schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
    strategy: { ...base.strategy, ...input.strategy },
    risk: input.risk,
    timeframe: input.timeframe,
    tradeRules: input.tradeRules,
    researchPosture: input.researchPosture,
    ai: input.ai,
    selector: { ...base.selector, ...input.selector },
  });
}

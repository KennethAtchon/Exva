import { z } from "zod";
import {
  RISK_PRESET_IDS,
  TIMEFRAME_PRESET_IDS,
  type RiskPresetId,
  type TimeframePresetId,
} from "../domain";

export const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "prediction_market",
]);
export const selectionModeSchema = z.enum([
  "manual_shortlist",
  "ai_selected_universe",
]);
export const executionModeSchema = z.enum(["paper_only", "live_allowed"]);
export const sessionStatusSchema = z.enum([
  "draft",
  "idle",
  "active",
  "attention_required",
  "paused",
  "stopped",
  "archived",
]);
export const researchDepthSchema = z.enum(["light", "balanced", "deep"]);
export const strategyProfileSchema = z.enum([
  "passive_income",
  "growth",
  "conservative",
  "custom",
]);
export const researchPosturePresetIdSchema = z.enum([
  "trend_hunt",
  "catalyst_momentum",
  "institutional_quality",
  "mean_reversion_dislocation",
  "prediction_event_edge",
  "custom",
]);
export const researchDiscoveryModeSchema = z.enum([
  "trend_scan",
  "catalyst_scan",
  "quality_watchlist",
  "mean_reversion_scan",
  "event_contract_scan",
  "custom",
]);
export const researchEvidenceModeSchema = z.enum([
  "narrative_first",
  "price_action_first",
  "confirmation_first",
  "probability_edge",
  "balanced",
]);
export const researchCatalystModeSchema = z.enum([
  "required",
  "preferred",
  "not_required",
]);
export const researchFundamentalStrictnessSchema = z.enum([
  "sanity_check",
  "balanced",
  "deep_confirmation",
  "not_applicable",
]);
export const tradeRulesPresetIdSchema = z.enum([
  "breakout_long",
  "pullback_trend",
  "event_entry",
  "reversal_fade",
  "probability_edge",
  "custom",
]);
export const setupTypeSchema = z.enum([
  "breakout",
  "pullback_trend",
  "event_entry",
  "reversal_fade",
  "probability_edge",
  "custom",
]);
export const strategySideBiasSchema = z.enum([
  "long_only",
  "short_only",
  "both",
  "market_neutral",
  "n_a",
]);
export const strategyEntryStyleSchema = z.enum([
  "breakout",
  "pullback",
  "reversal",
  "range_fade",
  "event",
  "probability_edge",
]);
export const strategyExitStyleSchema = z.enum([
  "fixed_pct",
  "trailing_atr",
  "partial_exits",
  "time_based",
  "thesis_based",
  "market_resolution",
]);
export const strategyScalingModeSchema = z.enum([
  "single_entry",
  "scale_in_2",
  "scale_in_3",
  "scale_out_partial",
]);
export const stopLossTypeSchema = z.enum([
  "fixed_pct",
  "trailing_atr",
  "broker_native_trailing",
  "none",
]);
export const tradingTimeframeSchema = z.enum([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
]);
export const holdingStyleSchema = z.enum([
  "intraday_flat",
  "multi_day_swing",
  "weeks_position",
  "custom",
]);
export const executionStageSchema = z.enum([
  "selector",
  "candidate_validation",
  "technical",
  "fundamental",
  "review",
  "decision",
  "risk_gate",
  "broker_order",
  "monitoring",
]);
export const brokerAssignmentSchema = z.object({
  brokerAccountId: z.string().min(1),
  allocatedUsd: z.number().nonnegative(),
});

export const sessionCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  objective: z.string().min(1).max(500),
  selectionMode: selectionModeSchema,
  instrumentClasses: z.array(instrumentClassSchema).min(1),
  instrumentScope: z.string().min(1),
  defaultSearchProviderId: z.string().nullish(),
  selectorSettings: z.object({ aiPickerEnabled: z.boolean() }),
  executionMode: executionModeSchema,
  brokerAssignments: z.array(brokerAssignmentSchema).min(1),
  brokerOverridesByInstrumentClass: z
    .record(instrumentClassSchema, z.string().nullable())
    .optional(),
});

export const sessionStrategyPayloadSchema = z.object({
  strategyProfile: strategyProfileSchema,
  maxPositionUsd: z.number().nonnegative(),
  stopLossPct: z.number().nonnegative(),
  takeProfitPct: z.number().nonnegative(),
  maxConcurrentTrades: z.number().int().nonnegative(),
  researchDepth: researchDepthSchema,
  dailyLossLimitUsd: z.number().nonnegative(),
  profitTargetUsd: z.number().nonnegative(),
  maxAiSpendUsd: z.number().nonnegative(),
  humanApprovalRequired: z.boolean(),
  primaryTradingTimeframe: tradingTimeframeSchema.default("1d"),
  holdingStyle: holdingStyleSchema.default("multi_day_swing"),
  targetHoldDays: z
    .union([z.number().nonnegative(), z.null()])
    .optional()
    .default(null),
  maxHoldDays: z
    .union([z.number().nonnegative(), z.null()])
    .optional()
    .default(null),
  timeframeNotes: z.string().optional().default(""),
});

export const sessionResearchPosturePayloadSchema = z.object({
  posturePresetId: researchPosturePresetIdSchema,
  discoveryMode: researchDiscoveryModeSchema,
  evidenceMode: researchEvidenceModeSchema,
  catalystMode: researchCatalystModeSchema,
  fundamentalStrictness: researchFundamentalStrictnessSchema,
  postureNotes: z.string(),
});

export const sessionTradeRulesPayloadSchema = z.object({
  rulesPresetId: tradeRulesPresetIdSchema,
  setupType: setupTypeSchema,
  sideBias: strategySideBiasSchema,
  entryStyle: strategyEntryStyleSchema,
  exitStyle: strategyExitStyleSchema,
  scalingMode: strategyScalingModeSchema,
  tradeRulesMarkdown: z.string().max(1200),
  ruleNotes: z.string(),
});

export const sessionRiskConfigPayloadSchema = z.object({
  riskPresetId: z
    .enum(RISK_PRESET_IDS as [RiskPresetId, ...RiskPresetId[]])
    .optional()
    .default("custom"),
  maxPositionUsd: z.number().nonnegative(),
  stopLossPct: z.union([z.number().nonnegative(), z.null()]),
  takeProfitPct: z.union([z.number().nonnegative(), z.null()]),
  stopLossType: stopLossTypeSchema,
  atrStopMultiplier: z.union([z.number().nonnegative(), z.null()]),
  kellyFraction: z.number().nonnegative(),
  predictionEdgeThreshold: z.number().nonnegative(),
  maxExposureUsd: z.union([z.number().nonnegative(), z.null()]),
  waitForOpenThreshold: z.number().nonnegative(),
  maxConcurrentTrades: z.number().int().nonnegative(),
  dailyLossLimitUsd: z.number().nonnegative(),
  profitTargetUsd: z.number().nonnegative(),
  maxAiSpendUsd: z.number().nonnegative(),
  maxDataSpendUsd: z.number().nonnegative(),
  humanApprovalRequired: z.boolean(),
});

export const sessionTimeframeConfigPayloadSchema = z.object({
  timeframePresetId: z
    .enum(TIMEFRAME_PRESET_IDS as [TimeframePresetId, ...TimeframePresetId[]])
    .optional()
    .default("custom"),
  primaryTradingTimeframe: tradingTimeframeSchema,
  holdingStyle: holdingStyleSchema,
  targetHoldDays: z.union([z.number().nonnegative(), z.null()]),
  maxHoldDays: z.union([z.number().nonnegative(), z.null()]),
  timeframeNotes: z.string(),
});

export const strategyResearchPostureSaveSchema = z.object({
  sessionId: z.string().min(1),
  researchPosture: sessionResearchPosturePayloadSchema.partial(),
});

export const strategyRulesSaveSchema = z.object({
  sessionId: z.string().min(1),
  rules: sessionTradeRulesPayloadSchema.partial(),
});

export const strategyRiskConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  riskConfig: sessionRiskConfigPayloadSchema.partial(),
});

export const strategyTimeframeConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  timeframe: sessionTimeframeConfigPayloadSchema.partial(),
});

export const pipelinePhaseSchema = z.enum([
  "selector",
  "technical",
  "fundamental",
  "review",
  "decision",
]);

const REASONING_LEVELS = [
  "off",
  "auto",
  "low",
  "medium",
  "high",
  "max",
] as const;

export const reasoningLevelSchema = z.enum(REASONING_LEVELS);

export const strategyAiPhaseSaveSchema = z.object({
  sessionId: z.string().min(1),
  phase: pipelinePhaseSchema,
  providerKey: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  promptSource: z.enum(["default", "session_override"]).optional(),
  promptMarkdown: z.string().optional(),
});

export const strategyAiPhaseWorkerSaveSchema = z.object({
  sessionId: z.string().min(1),
  phase: pipelinePhaseSchema,
  workerId: z.string().min(1),
  providerKey: z.string().min(1).nullable().optional(),
  modelId: z.string().min(1).nullable().optional(),
  maxSteps: z.number().int().positive().nullable().optional(),
  spendLimitUsd: z.number().nonnegative().nullable().optional(),
  promptMarkdown: z.string().nullable().optional(),
});

export const sessionTemplatePayloadSchema = z.object({
  version: z.literal(1),
  identity: z.object({
    objective: z.string().min(1),
    selectionMode: selectionModeSchema,
    instrumentClasses: z.array(instrumentClassSchema).min(1),
    instrumentScope: z.string().min(1),
    executionMode: executionModeSchema,
    defaultSearchProviderId: z.string().nullable(),
  }),
  selectorSettings: z.object({ aiPickerEnabled: z.boolean() }),
  strategyContext: z
    .object({
      researchPosture: sessionResearchPosturePayloadSchema.extend({
        sessionId: z.string().min(1),
        updatedAt: z.string().min(1),
      }),
      rules: sessionTradeRulesPayloadSchema.extend({
        sessionId: z.string().min(1),
        updatedAt: z.string().min(1),
      }),
      riskConfig: sessionRiskConfigPayloadSchema.extend({
        sessionId: z.string().min(1),
        updatedAt: z.string().min(1),
      }),
      timeframe: sessionTimeframeConfigPayloadSchema.extend({
        sessionId: z.string().min(1),
        updatedAt: z.string().min(1),
      }),
    })
    .optional(),
  strategy: sessionStrategyPayloadSchema,
  brokerAssignments: z.array(brokerAssignmentSchema),
  brokerOverridesByInstrumentClass: z
    .record(instrumentClassSchema, z.string())
    .default({}),
});

export const templateCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  sourceSessionId: z.string().optional(),
  payload: sessionTemplatePayloadSchema,
});

export const templateListFiltersSchema = z
  .object({
    search: z.string().optional(),
    instrumentClass: instrumentClassSchema.optional(),
  })
  .optional();

export const sessionListFiltersSchema = z
  .object({
    status: sessionStatusSchema.optional(),
    instrumentClass: instrumentClassSchema.optional(),
    search: z.string().optional(),
    includeArchived: z.boolean().optional(),
    executionMode: executionModeSchema.optional(),
    includeAllEnvironments: z.boolean().optional(),
  })
  .optional();

export const sessionUpdateInputSchema = z.object({
  id: z.string().min(1),
  input: sessionCreateInputSchema,
});

export const sessionDuplicateInputSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1).max(80),
});

export const sessionIdParamSchema = z.object({ sessionId: z.string().min(1) });
export const sessionExecutionProgressSchema = z.object({
  sessionId: z.string().min(1),
});
export const sessionExecutionStepActionSchema = z.object({
  sessionId: z.string().min(1),
  cycleId: z.string().min(1),
  stage: executionStageSchema,
});

export const sessionFocusSchema = z.object({ id: z.string().min(1) });
export const sessionArchiveSchema = z.object({ id: z.string().min(1) });

export const workspacePrefsPatchSchema = z
  .object({
    globalIncludeArchived: z.boolean().optional(),
    globalEnvironmentMode: z.enum(["paper", "live"]).optional(),
    defaultSearchProviderId: z.string().nullable().optional(),
    allocationEnforcementOverride: z
      .enum(["hard", "warn"])
      .nullable()
      .optional(),
  })
  .strict();

export const strategyGetProviderModelsSchema = z.object({
  providerKey: z.string().min(1),
});

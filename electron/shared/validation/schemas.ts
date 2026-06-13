import { z } from "zod";
import {
  RISK_PRESET_IDS,
  TIMEFRAME_PRESET_IDS,
  type RiskPresetId,
  type TimeframePresetId,
} from "../domain";

const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "prediction_market",
]);
const selectionModeSchema = z.enum([
  "manual_shortlist",
  "ai_selected_universe",
  "signal_driven",
]);
const executionModeSchema = z.enum(["paper_only", "live_allowed"]);
const sessionStatusSchema = z.enum([
  "draft",
  "idle",
  "active",
  "attention_required",
  "paused",
  "monitoring_only",
  "stopped",
  "archived",
]);
const researchDepthSchema = z.enum(["light", "balanced", "deep"]);
const strategyProfileSchema = z.enum([
  "passive_income",
  "growth",
  "conservative",
  "custom",
]);
const researchPosturePresetIdSchema = z.enum([
  "edgar_catalyst",
  "earnings_event",
  "manual_watchlist",
  "prediction_event_edge",
  "custom",
]);
const processingModeSchema = z.enum(["catalyst", "contract", "manual"]);
const researchEvidenceModeSchema = z.enum([
  "document_first",
  "probability_edge",
  "balanced",
]);
const researchCatalystModeSchema = z.enum([
  "required",
  "preferred",
  "not_required",
]);
const researchFundamentalStrictnessSchema = z.enum([
  "sanity_check",
  "balanced",
  "deep_confirmation",
  "not_applicable",
]);
const tradeRulesPresetIdSchema = z.enum([
  "catalyst_entry",
  "event_entry",
  "probability_edge",
  "custom",
]);
const setupTypeSchema = z.enum([
  "catalyst_entry",
  "event_entry",
  "probability_edge",
  "custom",
]);
const strategySideBiasSchema = z.enum([
  "long_only",
  "short_only",
  "both",
  "market_neutral",
  "n_a",
]);
const strategyEntryStyleSchema = z.enum([
  "catalyst",
  "event",
  "probability_edge",
]);
const strategyExitStyleSchema = z.enum([
  "fixed_pct",
  "trailing_atr",
  "partial_exits",
  "time_based",
  "thesis_based",
  "market_resolution",
]);
const strategyScalingModeSchema = z.enum([
  "single_entry",
  "scale_in_2",
  "scale_in_3",
  "scale_out_partial",
]);
const stopLossTypeSchema = z.enum([
  "fixed_pct",
  "trailing_atr",
  "broker_native_trailing",
  "none",
]);
const tradingTimeframeSchema = z.enum(["15m", "30m", "1h", "4h", "1d", "1w"]);
const holdingStyleSchema = z.enum([
  "multi_day_swing",
  "weeks_position",
  "custom",
]);
const executionStageSchema = z.enum([
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
const brokerAssignmentSchema = z.object({
  brokerAccountId: z.string().min(1),
  allocatedUsd: z.number().nonnegative(),
});

export const sessionCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  objective: z.string().min(1).max(500),
  selectionMode: selectionModeSchema,
  instrumentClasses: z.array(instrumentClassSchema).min(1).optional(),
  instrumentScope: z.string(),
  defaultSearchProviderId: z.string().nullish(),
  selectorSettings: z.object({ aiPickerEnabled: z.boolean() }),
  executionMode: executionModeSchema,
  brokerAssignments: z.array(brokerAssignmentSchema).min(1),
  brokerOverridesByInstrumentClass: z
    .record(instrumentClassSchema, z.string().nullable())
    .optional(),
  // A session is driven by at most one signal source (one active signal per
  // broker, enforced one-per-session). See SessionWriteService.validate.
  subscribedSourceIds: z
    .array(z.string().min(1))
    .max(1, "A session can subscribe to only one signal source.")
    .optional(),
  experienceId: z.string().min(1).default("edgar-catalyst"),
});

const sessionStrategyPayloadSchema = z.object({
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

const sessionResearchPosturePayloadSchema = z.object({
  posturePresetId: researchPosturePresetIdSchema,
  processingMode: processingModeSchema,
  evidenceMode: researchEvidenceModeSchema,
  catalystMode: researchCatalystModeSchema,
  fundamentalStrictness: researchFundamentalStrictnessSchema,
  postureNotes: z.string(),
});

const sessionTradeRulesPayloadSchema = z.object({
  rulesPresetId: tradeRulesPresetIdSchema,
  setupType: setupTypeSchema,
  sideBias: strategySideBiasSchema,
  entryStyle: strategyEntryStyleSchema,
  exitStyle: strategyExitStyleSchema,
  scalingMode: strategyScalingModeSchema,
  tradeRulesMarkdown: z.string().max(1200),
  ruleNotes: z.string(),
});

const sessionRiskConfigPayloadSchema = z.object({
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

const sessionTimeframeConfigPayloadSchema = z.object({
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

const sessionAiSettingsPayloadSchema = z.object({
  workerGuidanceMarkdown: z.string().max(1200),
});

export const strategyAiSettingsSaveSchema = z.object({
  sessionId: z.string().min(1),
  aiSettings: sessionAiSettingsPayloadSchema.partial(),
});

export const strategyTimeframeConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  timeframe: sessionTimeframeConfigPayloadSchema.partial(),
});

const pipelinePhaseSchema = z.enum([
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

const reasoningLevelSchema = z.enum(REASONING_LEVELS);

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
    instrumentScope: z.string(),
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
      aiSettings: sessionAiSettingsPayloadSchema.extend({
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

export const listSignalDeadLettersInputSchema = z.object({
  sessionId: z.string().min(1),
  reason: z
    .enum([
      "unsupported_by_experience",
      "unsupported_by_signal_source",
      "unsupported_by_assigned_broker",
      "no_compatible_broker_route",
    ])
    .optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const replaySignalDeadLetterInputSchema = z.object({
  deadLetterId: z.string().min(1),
});

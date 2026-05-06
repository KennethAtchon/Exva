import { z } from "zod";

export const instrumentClassSchema = z.enum(["stock", "crypto", "futures", "prediction_market"]);
export const selectionModeSchema = z.enum(["manual_shortlist", "ai_selected_universe"]);
export const executionModeSchema = z.enum(["paper_only", "live_allowed"]);
export const sessionStatusSchema = z.enum(["draft", "idle", "active", "paused", "stopped", "archived"]);
export const researchDepthSchema = z.enum(["light", "balanced", "deep"]);
export const strategyProfileSchema = z.enum(["passive_income", "growth", "conservative", "custom"]);
export const strategyTypeSchema = z.enum([
  "momentum",
  "mean_reversion",
  "trend_following",
  "short_bias",
  "pairs",
  "fundamental",
  "event_driven",
  "prediction_market",
  "custom",
]);
export const strategySideBiasSchema = z.enum(["long_only", "short_only", "both", "market_neutral", "n_a"]);
export const strategyEntryStyleSchema = z.enum(["breakout", "pullback", "reversal", "range_fade", "event", "probability_edge"]);
export const strategyExitStyleSchema = z.enum([
  "fixed_pct",
  "trailing_atr",
  "partial_exits",
  "time_based",
  "thesis_based",
  "market_resolution",
]);
export const strategyScalingModeSchema = z.enum(["single_entry", "scale_in_2", "scale_in_3", "scale_out_partial"]);
export const stopLossTypeSchema = z.enum(["fixed_pct", "trailing_atr", "broker_native_trailing", "none"]);
export const tradingTimeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
export const holdingStyleSchema = z.enum(["intraday_flat", "multi_day_swing", "weeks_position", "custom"]);
export const agentRoleSchema = z.enum([
  "analyst_technical",
  "analyst_fundamental",
  "reviewer",
  "decision_maker",
  "instrument_selector",
]);
export const promptSourceSchema = z.enum(["default", "session_override"]);

export const sessionCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  objective: z.string().min(1).max(500),
  selectionMode: selectionModeSchema,
  instrumentClasses: z.array(instrumentClassSchema).min(1),
  instrumentScope: z.string().min(1),
  defaultSearchProviderId: z.string().nullish(),
  selectorSettings: z.object({ aiPickerEnabled: z.boolean() }),
  capitalLimitUsd: z.number().nonnegative(),
  executionMode: executionModeSchema,
  brokerAccountIds: z.array(z.string().min(1)),
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
  targetHoldDays: z.union([z.number().nonnegative(), z.null()]).optional().default(null),
  maxHoldDays: z.union([z.number().nonnegative(), z.null()]).optional().default(null),
  timeframeNotes: z.string().optional().default(""),
});

export const sessionAiRolePayloadSchema = z.object({
  role: agentRoleSchema,
  providerKey: z.string(),
  modelId: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  webSearchEnabled: z.boolean(),
  promptSource: promptSourceSchema,
  promptMarkdown: z.string(),
  promptAssetPath: z.string().nullable(),
});

export const sessionStrategyProfilePayloadSchema = z.object({
  strategyType: strategyTypeSchema,
  sideBias: strategySideBiasSchema,
  entryStyle: strategyEntryStyleSchema,
  exitStyle: strategyExitStyleSchema,
  scalingMode: strategyScalingModeSchema,
  strategyBriefMarkdown: z.string().max(1200),
  customInstructions: z.string(),
});

export const sessionRiskConfigPayloadSchema = z.object({
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
  primaryTradingTimeframe: tradingTimeframeSchema,
  holdingStyle: holdingStyleSchema,
  targetHoldDays: z.union([z.number().nonnegative(), z.null()]),
  maxHoldDays: z.union([z.number().nonnegative(), z.null()]),
  timeframeNotes: z.string(),
});

export const strategyProfileSaveSchema = z.object({
  sessionId: z.string().min(1),
  profile: sessionStrategyProfilePayloadSchema.partial(),
});

export const strategyRiskConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  riskConfig: sessionRiskConfigPayloadSchema.partial(),
});

export const strategyTimeframeConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  timeframe: sessionTimeframeConfigPayloadSchema.partial(),
});

export const strategyAiRolesSaveSchema = z.object({
  sessionId: z.string().min(1),
  aiRoles: z.array(sessionAiRolePayloadSchema),
});

export const sessionTemplatePayloadSchema = z.object({
  version: z.literal(1),
  identity: z.object({
    objective: z.string().min(1),
    selectionMode: selectionModeSchema,
    instrumentClasses: z.array(instrumentClassSchema).min(1),
    instrumentScope: z.string().min(1),
    executionMode: executionModeSchema,
    capitalLimitUsd: z.number().nonnegative(),
    defaultSearchProviderId: z.string().nullable(),
  }),
  selectorSettings: z.object({ aiPickerEnabled: z.boolean() }),
  strategyContext: z
    .object({
      profile: sessionStrategyProfilePayloadSchema.extend({
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
  aiRoles: z.array(sessionAiRolePayloadSchema),
  brokerAssignments: z.array(z.object({ brokerAccountId: z.string() })),
  brokerOverridesByInstrumentClass: z.record(instrumentClassSchema, z.string()).default({}),
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

export const sessionFocusSchema = z.object({ id: z.string().min(1) });
export const sessionArchiveSchema = z.object({ id: z.string().min(1) });

export const workspacePrefsPatchSchema = z
  .object({
    globalIncludeArchived: z.boolean().optional(),
    defaultSearchProviderId: z.string().nullable().optional(),
    capitalAllocationMode: z.enum(["per_session_only", "shared_global_pool"]).optional(),
    globalCapitalPoolUsd: z.number().nullable().optional(),
  })
  .strict();

export const strategyGetProviderModelsSchema = z.object({ providerKey: z.string().min(1) });
export const strategyResetPromptSchema = z.object({ role: agentRoleSchema });

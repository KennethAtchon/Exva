import { z } from "zod";

export const instrumentClassSchema = z.enum(["stock", "crypto", "futures"]);
export const selectionModeSchema = z.enum(["manual_shortlist", "ai_selected_universe"]);
export const executionModeSchema = z.enum(["paper_only", "live_allowed"]);
export const sessionStatusSchema = z.enum(["draft", "idle", "active", "paused", "stopped", "archived"]);
export const researchDepthSchema = z.enum(["light", "balanced", "deep"]);
export const strategyProfileSchema = z.enum(["passive_income", "growth", "conservative", "custom"]);
export const tradingTimeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
export const holdingStyleSchema = z.enum(["intraday_flat", "multi_day_swing", "weeks_position", "custom"]);
export const agentRoleSchema = z.enum([
  "researcher_bull",
  "researcher_bear",
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

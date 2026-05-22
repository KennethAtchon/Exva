import { z } from "zod";
import {
  RISK_PRESET_IDS,
  TIMEFRAME_PRESET_IDS,
  type RiskPresetId,
  type TimeframePresetId,
} from "../../electron/shared/domain";
import { selectorEvidenceSchema } from "../../electron/shared/ai/selector-pipeline-candidate";
import { selectorDiagnosticsSchema } from "../../electron/shared/ai/selector-diagnostics";

export const sessionStatusSchema = z.enum([
  "draft",
  "idle",
  "active",
  "paused",
  "stopped",
  "archived",
]);
export const tradeSideSchema = z.enum(["BUY", "SELL"]);
export const tradeStatusSchema = z.enum([
  "pending",
  "open",
  "closed",
  "cancelled",
  "failed",
  "rejected",
]);
export const agentTypeSchema = z.enum([
  "technical",
  "fundamental",
  "review",
  "decision",
  "selector",
  "session",
  "preflight",
  "approval",
  "orchestrator",
  "broker",
  "capital",
]);
export const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);
export const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "prediction_market",
]);

export const sessionConfigSchema = z.object({
  strategy: z.string().min(1),
  max_position_usd: z.number().positive(),
  stop_loss_pct: z.number().positive(),
  take_profit_pct: z.number().positive(),
  max_concurrent_trades: z.number().int().positive(),
  research_depth: z.enum(["light", "balanced", "deep"]),
  daily_loss_limit_usd: z.number().positive(),
  profit_target_usd: z.number().positive(),
  max_api_spend_usd: z.number().positive(),
  human_approval_required: z.boolean(),
});

export const brokerCredentialsSchema = z.object({
  provider: z.literal("alpaca"),
  api_key: z.string().min(1),
  secret_key: z.string().min(1),
  mode: z.enum(["paper", "live"]),
});

export const eventFiltersSchema = z
  .object({
    minLevel: logLevelSchema.optional(),
    min_level: logLevelSchema.optional(),
    agentType: agentTypeSchema.optional(),
    agent_type: agentTypeSchema.optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    sessionId: z.string().optional(),
  })
  .optional();

export const listTradesFiltersSchema = z.object({
  sessionId: z.string().optional(),
  brokerAccountId: z.string().optional(),
  symbolContains: z.string().optional(),
  instrumentType: instrumentClassSchema.optional(),
  executionMode: z.enum(["paper_only", "live_allowed"]).optional(),
  includeAllEnvironments: z.boolean().optional(),
});

const instrumentSelectionCandidateInputSchema = z.object({
  symbol: z.string().min(1).max(160),
  instrumentClass: instrumentClassSchema,
  instrumentDisplayName: z.string().optional(),
  predictionOutcome: z.enum(["YES", "NO"]).nullable().optional(),
  instrumentMetadataJson: z.string().optional(),
  rationale: z.string().optional(),
  selectorEvidence: selectorEvidenceSchema.optional(),
});

export const instrumentSelectionSchema = z.object({
  instruments: z
    .array(
      instrumentSelectionCandidateInputSchema.extend({
        symbol: z
          .string()
          .min(1)
          .max(160)
          .transform((s) => {
            const trimmed = s.trim();
            return trimmed.startsWith("pm:") ? trimmed : trimmed.toUpperCase();
          }),
      }),
    )
    .max(50),
  diagnostics: z.lazy(() => selectorDiagnosticsSchema).optional(),
});

export type InstrumentSelection = z.infer<typeof instrumentSelectionSchema>;

/**
 * Provider-safe schema for tool input (no transforms/effects in JSON schema export).
 * Runtime normalization is applied after tool execution.
 */
export const instrumentSelectionToolInputSchema = z.object({
  instruments: z.array(instrumentSelectionCandidateInputSchema).max(50),
});

export const tradeDecisionSchema = z.object({
  action: z.enum(["trade", "no_trade"]),
  side: tradeSideSchema.optional(),
  instrumentSymbol: z.string().min(1),
  instrumentDisplayName: z.string().optional(),
  outcome: z.enum(["YES", "NO"]).optional(),
  estimatedProb: z.number().min(0).max(1).optional(),
  impliedProb: z.number().min(0).max(1).optional(),
  edgePctPts: z.number().optional(),
  instrumentMetadataJson: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

export const tradeIdSchema = z.object({ tradeId: z.string().min(1) });
export const cycleIdSchema = z.object({ cycleId: z.string().min(1) });
export const apiCallLogFiltersSchema = z.object({
  sessionId: z.string().min(1),
  cycleId: z.string().min(1).nullable().optional(),
  tradeId: z.string().min(1).nullable().optional(),
});
export const approveTradeSchema = z.object({
  tradeId: z.string().min(1),
  approved: z.boolean(),
});

export const approvalListFiltersSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  })
  .optional();

export const approvalDecideSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().max(2000).optional(),
});

export const apiKeySchema = z.object({
  keyType: z.enum(["anthropic", "brave", "tavily"]),
  value: z.string().min(1),
});

export const providerAccountSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  category: z.enum(["ai", "search"]),
  providerType: z.enum([
    "anthropic",
    "openai",
    "openrouter",
    "brave",
    "tavily",
    "duckduckgo",
    "mcp",
  ]),
  apiKey: z.string().min(1),
  metadata: z
    .object({
      baseUrl: z.string().url().optional(),
    })
    .optional(),
});

export const providerAccountTestSchema = z.object({
  id: z.string().min(1),
});

export const providerAccountDeleteSchema = z.object({
  id: z.string().min(1),
});

export const brokerTypeSchema = z.enum([
  "alpaca",
  "coinbase_advanced_trade",
  "tradovate",
  "polymarket",
  "mock",
]);

export const brokerAccountAddSchema = z.object({
  id: z.string().min(1).optional(),
  brokerType: brokerTypeSchema,
  name: z.string().min(1),
  mode: z.enum(["paper", "live"]),
  credentials: z.record(z.string()),
  mockScenarioKind: z
    .enum([
      "clean_breakout",
      "failed_breakout",
      "sideways_chop",
      "gap_down_after_entry",
      "news_reversal",
      "stale_quote",
      "wide_spread",
      "partial_fill",
      "broker_reject",
      "rate_limit",
    ])
    .optional(),
});

export const brokerAccountIdSchema = z.object({
  id: z.string().min(1),
});

export const brokerTestEphemeralSchema = z.object({
  brokerType: brokerTypeSchema,
  mode: z.enum(["paper", "live"]),
  credentials: z.record(z.string()),
});

export const brokerRoutingUpdateSchema = z.object({
  routing: z.array(
    z.object({
      instrumentClass: instrumentClassSchema,
      defaultBrokerAccountId: z.string().min(1),
    }),
  ),
});

const researchPosturePresetIdSchema = z.enum([
  "trend_hunt",
  "catalyst_momentum",
  "institutional_quality",
  "mean_reversion_dislocation",
  "prediction_event_edge",
  "custom",
]);
const researchDiscoveryModeSchema = z.enum([
  "trend_scan",
  "catalyst_scan",
  "quality_watchlist",
  "mean_reversion_scan",
  "event_contract_scan",
  "custom",
]);
const researchEvidenceModeSchema = z.enum([
  "narrative_first",
  "price_action_first",
  "confirmation_first",
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
  "breakout_long",
  "pullback_trend",
  "event_entry",
  "reversal_fade",
  "probability_edge",
  "custom",
]);
const setupTypeSchema = z.enum([
  "breakout",
  "pullback_trend",
  "event_entry",
  "reversal_fade",
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
  "breakout",
  "pullback",
  "reversal",
  "range_fade",
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
const tradingTimeframeSchema = z.enum([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
]);
const holdingStyleSchema = z.enum([
  "intraday_flat",
  "multi_day_swing",
  "weeks_position",
  "custom",
]);

export const strategyResearchPostureSaveSchema = z.object({
  sessionId: z.string().min(1),
  researchPosture: z.object({
    posturePresetId: researchPosturePresetIdSchema.optional(),
    discoveryMode: researchDiscoveryModeSchema.optional(),
    evidenceMode: researchEvidenceModeSchema.optional(),
    catalystMode: researchCatalystModeSchema.optional(),
    fundamentalStrictness: researchFundamentalStrictnessSchema.optional(),
    postureNotes: z.string().optional(),
  }),
});

export const strategyRulesSaveSchema = z.object({
  sessionId: z.string().min(1),
  rules: z.object({
    rulesPresetId: tradeRulesPresetIdSchema.optional(),
    setupType: setupTypeSchema.optional(),
    sideBias: strategySideBiasSchema.optional(),
    entryStyle: strategyEntryStyleSchema.optional(),
    exitStyle: strategyExitStyleSchema.optional(),
    scalingMode: strategyScalingModeSchema.optional(),
    tradeRulesMarkdown: z.string().max(1200).optional(),
    ruleNotes: z.string().optional(),
  }),
});

export const strategyRiskConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  riskConfig: z.object({
    riskPresetId: z
      .enum(RISK_PRESET_IDS as [RiskPresetId, ...RiskPresetId[]])
      .optional(),
    maxPositionUsd: z.number().nonnegative().optional(),
    stopLossPct: z.union([z.number().nonnegative(), z.null()]).optional(),
    takeProfitPct: z.union([z.number().nonnegative(), z.null()]).optional(),
    stopLossType: stopLossTypeSchema.optional(),
    atrStopMultiplier: z.union([z.number().nonnegative(), z.null()]).optional(),
    kellyFraction: z.number().nonnegative().optional(),
    predictionEdgeThreshold: z.number().nonnegative().optional(),
    maxExposureUsd: z.union([z.number().nonnegative(), z.null()]).optional(),
    waitForOpenThreshold: z.number().nonnegative().optional(),
    maxConcurrentTrades: z.number().int().nonnegative().optional(),
    dailyLossLimitUsd: z.number().nonnegative().optional(),
    profitTargetUsd: z.number().nonnegative().optional(),
    maxAiSpendUsd: z.number().nonnegative().optional(),
    humanApprovalRequired: z.boolean().optional(),
  }),
});

export const strategyTimeframeConfigSaveSchema = z.object({
  sessionId: z.string().min(1),
  timeframe: z.object({
    timeframePresetId: z
      .enum(TIMEFRAME_PRESET_IDS as [TimeframePresetId, ...TimeframePresetId[]])
      .optional(),
    primaryTradingTimeframe: tradingTimeframeSchema.optional(),
    holdingStyle: holdingStyleSchema.optional(),
    targetHoldDays: z.union([z.number().nonnegative(), z.null()]).optional(),
    maxHoldDays: z.union([z.number().nonnegative(), z.null()]).optional(),
    timeframeNotes: z.string().optional(),
  }),
});

export const pipelinePhaseSchema = z.enum([
  "selector",
  "technical",
  "fundamental",
  "review",
  "decision",
]);

export const strategyAiPhaseSaveSchema = z.object({
  sessionId: z.string().min(1),
  phase: pipelinePhaseSchema,
  providerKey: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoningLevel: z
    .enum(["off", "auto", "low", "medium", "high", "max"])
    .optional(),
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

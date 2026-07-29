import { z } from "zod";
import { PIPELINE_PHASES, REASONING_LEVELS } from "../ai/ai-phase";
import {
  HOLDING_STYLES,
  RISK_PRESET_IDS,
  STOP_LOSS_TYPES,
  STRATEGY_ENTRY_STYLES,
  STRATEGY_EXIT_STYLES,
  STRATEGY_SCALING_MODES,
  STRATEGY_SIDE_BIASES,
  TIMEFRAME_PRESET_IDS,
  TRADING_TIMEFRAMES,
  type HoldingStyle,
  type ResearchCatalystMode,
  type ResearchDepth,
  type ResearchEvidenceMode,
  type ResearchFundamentalStrictness,
  type ResearchPosturePresetId,
  type RiskPresetId,
  type SetupType,
  type StopLossType,
  type StrategyEntryStyle,
  type StrategyExitStyle,
  type StrategyProfile,
  type StrategyScalingMode,
  type StrategySideBias,
  type TimeframePresetId,
  type TradeRulesPresetId,
  type TradingTimeframe,
} from "./enums";
import type { OffHoursTrading } from "./session";
import type { PipelinePhase, ReasoningLevel } from "../ai/ai-phase";

/** Document shape version for SessionStrategyConfigDoc. Starts at 1. */
export const SESSION_STRATEGY_CONFIG_SCHEMA_VERSION = 1 as const;

export type ConfigPresetKind =
  | "full"
  | "risk"
  | "timeframe"
  | "research"
  | "rules"
  | "ai";

const strategyProfileSchema = z.enum([
  "passive_income",
  "growth",
  "conservative",
  "custom",
]);
const researchDepthSchema = z.enum(["light", "balanced", "deep"]);
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
const strategySideBiasSchema = z.enum(
  STRATEGY_SIDE_BIASES as [StrategySideBias, ...StrategySideBias[]],
);
const strategyEntryStyleSchema = z.enum(
  STRATEGY_ENTRY_STYLES as [StrategyEntryStyle, ...StrategyEntryStyle[]],
);
const strategyExitStyleSchema = z.enum(
  STRATEGY_EXIT_STYLES as [StrategyExitStyle, ...StrategyExitStyle[]],
);
const strategyScalingModeSchema = z.enum(
  STRATEGY_SCALING_MODES as [StrategyScalingMode, ...StrategyScalingMode[]],
);
const stopLossTypeSchema = z.enum(
  STOP_LOSS_TYPES as [StopLossType, ...StopLossType[]],
);
const tradingTimeframeSchema = z.enum(
  TRADING_TIMEFRAMES as [TradingTimeframe, ...TradingTimeframe[]],
);
const holdingStyleSchema = z.enum(
  HOLDING_STYLES as [HoldingStyle, ...HoldingStyle[]],
);
const riskPresetIdSchema = z.enum(
  RISK_PRESET_IDS as [RiskPresetId, ...RiskPresetId[]],
);
const timeframePresetIdSchema = z.enum(
  TIMEFRAME_PRESET_IDS as [TimeframePresetId, ...TimeframePresetId[]],
);
const offHoursTradingSchema = z.enum(["disabled", "extended_hours"]);
const pipelinePhaseSchema = z.enum(
  PIPELINE_PHASES as [PipelinePhase, ...PipelinePhase[]],
);
const reasoningLevelSchema = z.enum(REASONING_LEVELS);
const promptSourceSchema = z.enum(["default", "session_override"]);

/**
 * Strategy section: posture only. Money and limits live in `risk`; horizon
 * lives in `timeframe`. A field belongs to exactly one section — the executor
 * and the UI must never be able to read different homes for the same value.
 */
export const strategySectionSchema = z
  .object({
    strategyProfile: strategyProfileSchema,
    researchDepth: researchDepthSchema,
  })
  .strict();

/** Risk section fields (camelCase; was the old per-session risk row). */
export const riskSectionSchema = z
  .object({
    riskPresetId: riskPresetIdSchema,
    offHoursTrading: offHoursTradingSchema,
    maxPositionUsd: z.number().nonnegative(),
    stopLossPct: z.number().nonnegative().nullable(),
    takeProfitPct: z.number().nonnegative().nullable(),
    stopLossType: stopLossTypeSchema,
    atrStopMultiplier: z.number().nonnegative().nullable(),
    kellyFraction: z.number().nonnegative(),
    predictionEdgeThreshold: z.number().nonnegative(),
    maxExposureUsd: z.number().nonnegative().nullable(),
    waitForOpenThreshold: z.number().nonnegative(),
    maxConcurrentTrades: z.number().int().nonnegative(),
    maxConsecutiveLosers: z.number().int().nonnegative(),
    volatilityHaltMaxSpreadPct: z.number().nonnegative().nullable(),
    dailyLossLimitUsd: z.number().nonnegative(),
    profitTargetUsd: z.number().nonnegative(),
    maxAiSpendUsd: z.number().nonnegative(),
    maxDataSpendUsd: z.number().nonnegative(),
    humanApprovalRequired: z.boolean(),
    /**
     * Hours before/after a binary calendar event during which entries
     * (and optionally holds) are blocked unless eventTypedExperience.
     */
    calendarBlackoutHours: z.number().nonnegative().default(24),
    /**
     * When true, calendar blackout does not apply — experience is event-typed
     * (earnings breakout, FOMC fade, etc.).
     */
    eventTypedExperience: z.boolean().default(false),
  })
  .strict();

/** Timeframe section fields (camelCase; was the old per-session timeframe row). */
export const timeframeSectionSchema = z
  .object({
    timeframePresetId: timeframePresetIdSchema,
    primaryTradingTimeframe: tradingTimeframeSchema,
    holdingStyle: holdingStyleSchema,
    targetHoldDays: z.number().nonnegative().nullable(),
    maxHoldDays: z.number().nonnegative().nullable(),
    timeframeNotes: z.string(),
  })
  .strict();

/** Trade-rules section fields (camelCase; was the old per-session rules row). */
export const tradeRulesSectionSchema = z
  .object({
    rulesPresetId: tradeRulesPresetIdSchema,
    setupType: setupTypeSchema,
    sideBias: strategySideBiasSchema,
    entryStyle: strategyEntryStyleSchema,
    exitStyle: strategyExitStyleSchema,
    scalingMode: strategyScalingModeSchema,
    tradeRulesMarkdown: z.string().max(1200),
    ruleNotes: z.string(),
  })
  .strict();

/** Research-posture section fields (camelCase; was the old per-session posture row). */
export const researchPostureSectionSchema = z
  .object({
    posturePresetId: researchPosturePresetIdSchema,
    processingMode: processingModeSchema,
    evidenceMode: researchEvidenceModeSchema,
    catalystMode: researchCatalystModeSchema,
    fundamentalStrictness: researchFundamentalStrictnessSchema,
    postureNotes: z.string(),
  })
  .strict();

/** AI settings fields (camelCase; was the old per-session AI settings row). */
export const aiSettingsSectionSchema = z
  .object({
    workerGuidanceMarkdown: z.string().max(1200),
  })
  .strict();

/** AI phase worker fields (camelCase; was the old per-phase worker row). */
export const aiPhaseWorkerSectionSchema = z
  .object({
    workerId: z.string().min(1),
    providerKey: z.string().nullable(),
    modelId: z.string().nullable(),
    maxSteps: z.number().int().positive().nullable(),
    spendLimitUsd: z.number().nonnegative().nullable(),
    promptMarkdown: z.string().nullable(),
  })
  .strict();

/** AI phase fields (camelCase; was the old per-phase row) + nested workers. */
export const aiPhaseSectionSchema = z
  .object({
    phase: pipelinePhaseSchema,
    providerKey: z.string(),
    modelId: z.string(),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    reasoningLevel: reasoningLevelSchema,
    promptSource: promptSourceSchema,
    promptMarkdown: z.string(),
    workers: z.array(aiPhaseWorkerSectionSchema),
  })
  .strict();

export const aiSectionSchema = z
  .object({
    settings: aiSettingsSectionSchema,
    phases: z.array(aiPhaseSectionSchema),
  })
  .strict();

/** Selector section fields (camelCase; was the old per-session selector row). */
export const selectorSectionSchema = z
  .object({
    aiPickerEnabled: z.boolean(),
    noInstrumentRetryMinutes: z.number().int().positive().nullable(),
  })
  .strict();

export const sessionStrategyConfigDocSchema = z
  .object({
    schemaVersion: z.literal(SESSION_STRATEGY_CONFIG_SCHEMA_VERSION),
    strategy: strategySectionSchema,
    risk: riskSectionSchema,
    timeframe: timeframeSectionSchema,
    tradeRules: tradeRulesSectionSchema,
    researchPosture: researchPostureSectionSchema,
    ai: aiSectionSchema,
    selector: selectorSectionSchema,
  })
  .strict();

/**
 * Partial document for config_presets — only sections matching `kind` are present.
 * Each present section must still be fully shaped (defaults filled at write time).
 */
export const sessionStrategyConfigPartialDocSchema = z
  .object({
    schemaVersion: z.literal(SESSION_STRATEGY_CONFIG_SCHEMA_VERSION),
    strategy: strategySectionSchema.optional(),
    risk: riskSectionSchema.optional(),
    timeframe: timeframeSectionSchema.optional(),
    tradeRules: tradeRulesSectionSchema.optional(),
    researchPosture: researchPostureSectionSchema.optional(),
    ai: aiSectionSchema.optional(),
    selector: selectorSectionSchema.optional(),
  })
  .strict()
  .refine(
    (doc) =>
      doc.strategy != null ||
      doc.risk != null ||
      doc.timeframe != null ||
      doc.tradeRules != null ||
      doc.researchPosture != null ||
      doc.ai != null ||
      doc.selector != null,
    { message: "partial config doc must include at least one section" },
  );

export type StrategySection = z.infer<typeof strategySectionSchema>;
export type RiskSection = z.infer<typeof riskSectionSchema>;
export type TimeframeSection = z.infer<typeof timeframeSectionSchema>;
export type TradeRulesSection = z.infer<typeof tradeRulesSectionSchema>;
export type ResearchPostureSection = z.infer<
  typeof researchPostureSectionSchema
>;
export type AiPhaseSection = z.infer<typeof aiPhaseSectionSchema>;
export type AiSection = z.infer<typeof aiSectionSchema>;
export type SelectorSection = z.infer<typeof selectorSectionSchema>;

export interface SessionStrategyConfigDoc {
  schemaVersion: typeof SESSION_STRATEGY_CONFIG_SCHEMA_VERSION;
  strategy: {
    strategyProfile: StrategyProfile;
    researchDepth: ResearchDepth;
  };
  risk: {
    riskPresetId: RiskPresetId;
    offHoursTrading: OffHoursTrading;
    maxPositionUsd: number;
    stopLossPct: number | null;
    takeProfitPct: number | null;
    stopLossType: StopLossType;
    atrStopMultiplier: number | null;
    kellyFraction: number;
    predictionEdgeThreshold: number;
    maxExposureUsd: number | null;
    waitForOpenThreshold: number;
    maxConcurrentTrades: number;
    maxConsecutiveLosers: number;
    volatilityHaltMaxSpreadPct: number | null;
    dailyLossLimitUsd: number;
    profitTargetUsd: number;
    maxAiSpendUsd: number;
    maxDataSpendUsd: number;
    humanApprovalRequired: boolean;
    calendarBlackoutHours: number;
    eventTypedExperience: boolean;
  };
  timeframe: {
    timeframePresetId: TimeframePresetId;
    primaryTradingTimeframe: TradingTimeframe;
    holdingStyle: HoldingStyle;
    targetHoldDays: number | null;
    maxHoldDays: number | null;
    timeframeNotes: string;
  };
  tradeRules: {
    rulesPresetId: TradeRulesPresetId;
    setupType: SetupType;
    sideBias: StrategySideBias;
    entryStyle: StrategyEntryStyle;
    exitStyle: StrategyExitStyle;
    scalingMode: StrategyScalingMode;
    tradeRulesMarkdown: string;
    ruleNotes: string;
  };
  researchPosture: {
    posturePresetId: ResearchPosturePresetId;
    processingMode: "catalyst" | "contract" | "manual";
    evidenceMode: ResearchEvidenceMode;
    catalystMode: ResearchCatalystMode;
    fundamentalStrictness: ResearchFundamentalStrictness;
    postureNotes: string;
  };
  ai: {
    settings: { workerGuidanceMarkdown: string };
    phases: Array<{
      phase: PipelinePhase;
      providerKey: string;
      modelId: string;
      temperature: number;
      maxTokens: number;
      reasoningLevel: ReasoningLevel;
      promptSource: "default" | "session_override";
      promptMarkdown: string;
      workers: Array<{
        workerId: string;
        providerKey: string | null;
        modelId: string | null;
        maxSteps: number | null;
        spendLimitUsd: number | null;
        promptMarkdown: string | null;
      }>;
    }>;
  };
  selector: {
    aiPickerEnabled: boolean;
    noInstrumentRetryMinutes: number | null;
  };
}

export type SessionStrategyConfigPartialDoc = z.infer<
  typeof sessionStrategyConfigPartialDocSchema
>;

export function parseSessionStrategyConfigDoc(
  raw: unknown,
): SessionStrategyConfigDoc {
  return sessionStrategyConfigDocSchema.parse(raw) as SessionStrategyConfigDoc;
}

export function parseSessionStrategyConfigPartialDoc(
  raw: unknown,
): SessionStrategyConfigPartialDoc {
  return sessionStrategyConfigPartialDocSchema.parse(raw);
}

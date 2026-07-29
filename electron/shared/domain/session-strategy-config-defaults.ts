import { DEFAULT_REASONING_LEVEL, PIPELINE_PHASES } from "../ai/ai-phase";
import type {
  AiSection,
  ResearchPostureSection,
  RiskSection,
  SelectorSection,
  SessionStrategyConfigDoc,
  StrategySection,
  TimeframeSection,
  TradeRulesSection,
} from "./session-strategy-config";
import {
  SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
  parseSessionStrategyConfigDoc,
} from "./session-strategy-config";

export const DEFAULT_STRATEGY_SECTION: StrategySection = {
  strategyProfile: "passive_income",
  researchDepth: "balanced",
};

/** Defaults mirroring legacy risk row defaults. */
export const DEFAULT_RISK_SECTION: RiskSection = {
  riskPresetId: "custom",
  offHoursTrading: "disabled",
  maxPositionUsd: 500,
  stopLossPct: null,
  takeProfitPct: null,
  stopLossType: "fixed_pct",
  atrStopMultiplier: null,
  kellyFraction: 0.25,
  predictionEdgeThreshold: 0.08,
  maxExposureUsd: null,
  waitForOpenThreshold: 0.8,
  maxConcurrentTrades: 3,
  maxConsecutiveLosers: 5,
  volatilityHaltMaxSpreadPct: null,
  dailyLossLimitUsd: 200,
  profitTargetUsd: 1000,
  maxAiSpendUsd: 5,
  maxDataSpendUsd: 5,
  humanApprovalRequired: false,
  calendarBlackoutHours: 24,
  eventTypedExperience: false,
};

/** Defaults mirroring legacy timeframe row defaults. */
export const DEFAULT_TIMEFRAME_SECTION: TimeframeSection = {
  timeframePresetId: "custom",
  primaryTradingTimeframe: "1d",
  holdingStyle: "multi_day_swing",
  targetHoldDays: null,
  maxHoldDays: null,
  timeframeNotes: "",
};

/**
 * Defaults mirroring legacy trade-rules row defaults, with entryStyle
 * corrected to a domain-valid value (`catalyst`) — schema column default
 * historically said `breakout`, which is not a StrategyEntryStyle.
 */
export const DEFAULT_TRADE_RULES_SECTION: TradeRulesSection = {
  rulesPresetId: "custom",
  setupType: "custom",
  sideBias: "both",
  entryStyle: "catalyst",
  exitStyle: "fixed_pct",
  scalingMode: "single_entry",
  tradeRulesMarkdown: "",
  ruleNotes: "",
};

/** Defaults mirroring legacy research-posture row defaults. */
export const DEFAULT_RESEARCH_POSTURE_SECTION: ResearchPostureSection = {
  posturePresetId: "custom",
  processingMode: "manual",
  evidenceMode: "balanced",
  catalystMode: "preferred",
  fundamentalStrictness: "balanced",
  postureNotes: "",
};

/** Defaults mirroring legacy AI settings/phases defaults. */
export function defaultAiSection(opts?: {
  providerKey?: string;
  modelId?: string;
  reasoningLevel?: typeof DEFAULT_REASONING_LEVEL;
}): AiSection {
  const providerKey = opts?.providerKey ?? "";
  const modelId = opts?.modelId ?? "";
  const reasoningLevel = opts?.reasoningLevel ?? DEFAULT_REASONING_LEVEL;
  return {
    settings: { workerGuidanceMarkdown: "" },
    phases: PIPELINE_PHASES.map((phase) => ({
      phase,
      providerKey,
      modelId,
      temperature: 0.7,
      maxTokens: 8192,
      reasoningLevel,
      promptSource: "default" as const,
      promptMarkdown: "",
      workers: [],
    })),
  };
}

/** Defaults mirroring legacy selector row defaults. */
export const DEFAULT_SELECTOR_SECTION: SelectorSection = {
  aiPickerEnabled: true,
  noInstrumentRetryMinutes: null,
};

export function defaultSessionStrategyConfigDoc(opts?: {
  providerKey?: string;
  modelId?: string;
  reasoningLevel?: typeof DEFAULT_REASONING_LEVEL;
}): SessionStrategyConfigDoc {
  return {
    schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
    strategy: { ...DEFAULT_STRATEGY_SECTION },
    risk: { ...DEFAULT_RISK_SECTION },
    timeframe: { ...DEFAULT_TIMEFRAME_SECTION },
    tradeRules: { ...DEFAULT_TRADE_RULES_SECTION },
    researchPosture: { ...DEFAULT_RESEARCH_POSTURE_SECTION },
    ai: defaultAiSection(opts),
    selector: { ...DEFAULT_SELECTOR_SECTION },
  };
}

/** Build a validated initial doc for SessionRepo.create / experience bootstrap. */
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

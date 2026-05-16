import type { AiRoleProfileDocument } from "../ai/ai-role-profile";
import { isHoldingStyle, isTradingTimeframe } from "./enums";
import type {
  AgentRole,
  HoldingStyle,
  PromptSource,
  ResearchCatalystMode,
  ResearchDepth,
  ResearchDiscoveryMode,
  ResearchEvidenceMode,
  ResearchFundamentalStrictness,
  ResearchPosturePresetId,
  RiskPresetId,
  SetupType,
  StopLossType,
  StrategyEntryStyle,
  StrategyExitStyle,
  StrategyProfile,
  StrategyScalingMode,
  StrategySideBias,
  TimeframePresetId,
  TradeRulesPresetId,
  TradingTimeframe,
} from "./enums";

const TRADE_RULES_MARKDOWN_MAX_CHARS = 1_200;

export interface SessionAiRoleProfile {
  sessionId: string;
  role: AgentRole;
  profileJson: AiRoleProfileDocument;
  updatedAt: string;
}

export interface SessionStrategy {
  sessionId: string;
  strategyProfile: StrategyProfile;
  maxPositionUsd: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxConcurrentTrades: number;
  researchDepth: ResearchDepth;
  dailyLossLimitUsd: number;
  profitTargetUsd: number;
  maxAiSpendUsd: number;
  humanApprovalRequired: boolean;
  primaryTradingTimeframe: TradingTimeframe;
  holdingStyle: HoldingStyle;
  targetHoldDays: number | null;
  maxHoldDays: number | null;
  timeframeNotes: string;
}

export interface SessionResearchPosture {
  sessionId: string;
  posturePresetId: ResearchPosturePresetId;
  discoveryMode: ResearchDiscoveryMode;
  evidenceMode: ResearchEvidenceMode;
  catalystMode: ResearchCatalystMode;
  fundamentalStrictness: ResearchFundamentalStrictness;
  postureNotes: string;
  updatedAt: string;
}

export interface SessionTradeRules {
  sessionId: string;
  rulesPresetId: TradeRulesPresetId;
  setupType: SetupType;
  sideBias: StrategySideBias;
  entryStyle: StrategyEntryStyle;
  exitStyle: StrategyExitStyle;
  scalingMode: StrategyScalingMode;
  tradeRulesMarkdown: string;
  ruleNotes: string;
  updatedAt: string;
}

export interface SessionRiskConfig {
  sessionId: string;
  riskPresetId: RiskPresetId;
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
  dailyLossLimitUsd: number;
  profitTargetUsd: number;
  maxAiSpendUsd: number;
  maxDataSpendUsd: number;
  humanApprovalRequired: boolean;
  updatedAt: string;
}

export interface SessionTimeframeConfig {
  sessionId: string;
  timeframePresetId: TimeframePresetId;
  primaryTradingTimeframe: TradingTimeframe;
  holdingStyle: HoldingStyle;
  targetHoldDays: number | null;
  maxHoldDays: number | null;
  timeframeNotes: string;
  updatedAt: string;
}

export interface SessionStrategyContext {
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiRoleProfiles: SessionAiRoleProfile[];
}

export interface StrategySnapshot {
  version: 5;
  researchPosture: {
    posturePresetId: ResearchPosturePresetId;
    discoveryMode: ResearchDiscoveryMode;
    evidenceMode: ResearchEvidenceMode;
    catalystMode: ResearchCatalystMode;
    fundamentalStrictness: ResearchFundamentalStrictness;
    postureNotes: string;
  };
  rules: {
    rulesPresetId: TradeRulesPresetId;
    setupType: SetupType;
    sideBias: StrategySideBias;
    entryStyle: StrategyEntryStyle;
    exitStyle: StrategyExitStyle;
    scalingMode: StrategyScalingMode;
    tradeRulesMarkdown: string;
    ruleNotes: string;
  };
  riskConfig: {
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
    dailyLossLimitUsd: number;
    profitTargetUsd: number;
    maxAiSpendUsd: number;
    maxDataSpendUsd: number;
    humanApprovalRequired: boolean;
  };
  timeframe: {
    primaryTradingTimeframe: TradingTimeframe;
    holdingStyle: HoldingStyle;
    targetHoldDays: number | null;
    maxHoldDays: number | null;
    timeframeNotes: string;
  };
  aiRoleProfiles: Array<{
    role: AgentRole;
    profileJson: AiRoleProfileDocument;
  }>;
}

export interface SessionAiRole {
  sessionId: string;
  role: AgentRole;
  providerKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  promptSource: PromptSource;
  promptMarkdown: string;
  promptAssetPath: string | null;
}

export interface SessionSelectorSettings {
  sessionId: string;
  aiPickerEnabled: boolean;
  updatedAt: string;
}

/** Preset shape used by RISK_PRESETS in presets/. */
export interface RiskPreset {
  id: RiskPresetId;
  label: string;
  description: string;
  summaryBullets: string[];
  values: Partial<Omit<SessionRiskConfig, "sessionId" | "updatedAt">>;
}

/** Preset shape used by TIMEFRAME_PRESETS in presets/. */
export interface TimeframePreset {
  id: TimeframePresetId;
  label: string;
  description: string;
  summaryBullets: string[];
  values: Partial<Omit<SessionTimeframeConfig, "sessionId" | "updatedAt">>;
}

/** Preset shape used by RESEARCH_POSTURE_PRESETS in presets/. */
export interface ResearchPosturePreset {
  id: ResearchPosturePresetId;
  label: string;
  thesis: string;
  summaryBullets: string[];
  posture: {
    posturePresetId: ResearchPosturePresetId;
    discoveryMode: ResearchDiscoveryMode;
    evidenceMode: ResearchEvidenceMode;
    catalystMode: ResearchCatalystMode;
    fundamentalStrictness: ResearchFundamentalStrictness;
  };
}

/** Preset shape used by TRADE_RULE_PRESETS in presets/. */
export interface TradeRulesPreset {
  id: TradeRulesPresetId;
  label: string;
  thesis: string;
  summaryBullets: string[];
  rules: {
    rulesPresetId: TradeRulesPresetId;
    setupType: SetupType;
    sideBias: StrategySideBias;
    entryStyle: StrategyEntryStyle;
    exitStyle: StrategyExitStyle;
    scalingMode: StrategyScalingMode;
  };
}

export interface SessionConfig {
  // TODO(phase-05/phase-07): Remove this compatibility bridge once renderer/main callers
  // switch to the canonical SessionStrategy + per-role AI config model.
  strategy: string;
  max_position_usd: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  max_concurrent_trades: number;
  research_depth: ResearchDepth;
  daily_loss_limit_usd: number;
  profit_target_usd: number;
  max_api_spend_usd: number;
  human_approval_required: boolean;
}

/** Injected ahead of task-specific user prompts (Phase 7 orchestration). */
export function buildStrategyTimeframeContext(s: SessionStrategy): string {
  const lines = [
    "## Session trading horizon (authoritative)",
    `- Primary timeframe: ${s.primaryTradingTimeframe}`,
    `- Holding style: ${s.holdingStyle}`,
    s.targetHoldDays != null ? `- Target hold: ~${s.targetHoldDays} calendar days` : null,
    s.maxHoldDays != null ? `- Max hold: ${s.maxHoldDays} calendar days` : null,
    s.timeframeNotes.trim() ? `- Notes: ${s.timeframeNotes.trim()}` : null,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

export function validateSessionStrategyTimeframeFields(s: SessionStrategy): void {
  if (!isTradingTimeframe(s.primaryTradingTimeframe)) {
    throw new Error("Select a primary trading timeframe.");
  }
  if (!isHoldingStyle(s.holdingStyle)) {
    throw new Error("Select a holding style.");
  }
  if (s.targetHoldDays != null && s.targetHoldDays < 0) {
    throw new Error("Hold days cannot be negative.");
  }
  if (s.maxHoldDays != null && s.maxHoldDays < 0) {
    throw new Error("Hold days cannot be negative.");
  }
  if (s.targetHoldDays != null && s.maxHoldDays != null && s.maxHoldDays < s.targetHoldDays) {
    throw new Error("Max hold must be greater than or equal to target hold.");
  }
}

function validateSessionTimeframeConfigFields(timeframe: SessionTimeframeConfig): void {
  if (!isTradingTimeframe(timeframe.primaryTradingTimeframe)) {
    throw new Error("Select a primary trading timeframe.");
  }
  if (!isHoldingStyle(timeframe.holdingStyle)) {
    throw new Error("Select a holding style.");
  }
  if (timeframe.targetHoldDays != null && timeframe.targetHoldDays < 0) {
    throw new Error("Hold days cannot be negative.");
  }
  if (timeframe.maxHoldDays != null && timeframe.maxHoldDays < 0) {
    throw new Error("Hold days cannot be negative.");
  }
  if (
    timeframe.targetHoldDays != null &&
    timeframe.maxHoldDays != null &&
    timeframe.maxHoldDays < timeframe.targetHoldDays
  ) {
    throw new Error("Max hold must be greater than or equal to target hold.");
  }
}

/** Non-blocking UX hint: intraday intent with very slow primary bar. */
export function timeframeHoldMismatchWarning(s: SessionStrategy): string | null {
  if (s.holdingStyle !== "intraday_flat") return null;
  if (s.primaryTradingTimeframe !== "1d" && s.primaryTradingTimeframe !== "1w") return null;
  return "Intraday style usually uses intraday timeframes; consider 5m–1h.";
}

export function timeframeConfigHoldMismatchWarning(timeframe: SessionTimeframeConfig): string | null {
  if (timeframe.holdingStyle !== "intraday_flat") return null;
  if (timeframe.primaryTradingTimeframe !== "1d" && timeframe.primaryTradingTimeframe !== "1w") return null;
  return "Intraday style usually uses intraday timeframes; consider 5m-1h.";
}

export function buildResearchPostureMarkdown(posture: SessionResearchPosture): string {
  const lines = [
    "# Research posture",
    "",
    "## Edge posture",
    `- Posture preset: ${labelizeToken(posture.posturePresetId)}`,
    `- Discovery mode: ${labelizeToken(posture.discoveryMode)}`,
    `- Evidence mode: ${labelizeToken(posture.evidenceMode)}`,
    `- Catalyst posture: ${labelizeToken(posture.catalystMode)}`,
    `- Fundamental strictness: ${labelizeToken(posture.fundamentalStrictness)}`,
    posture.postureNotes.trim() ? "" : null,
    posture.postureNotes.trim() ? "## Posture notes" : null,
    posture.postureNotes.trim() ? posture.postureNotes.trim() : null,
  ].filter((line): line is string => line != null);

  const markdown = lines.join("\n").trim();
  return markdown.length > TRADE_RULES_MARKDOWN_MAX_CHARS
    ? `${markdown.slice(0, TRADE_RULES_MARKDOWN_MAX_CHARS).trimEnd()}...`
    : markdown;
}

export function buildTradeRulesMarkdown(rules: SessionTradeRules): string {
  const lines = [
    "# Trade Rules",
    "",
    "## Setup Mechanics",
    `- Rules preset: ${labelizeToken(rules.rulesPresetId)}`,
    `- Setup type: ${labelizeToken(rules.setupType)}`,
    `- Side bias: ${labelizeToken(rules.sideBias)}`,
    `- Entry style: ${labelizeToken(rules.entryStyle)}`,
    `- Exit style: ${labelizeToken(rules.exitStyle)}`,
    `- Scaling mode: ${labelizeToken(rules.scalingMode)}`,
    rules.ruleNotes.trim() ? "" : null,
    rules.ruleNotes.trim() ? "## Rule Notes" : null,
    rules.ruleNotes.trim() ? rules.ruleNotes.trim() : null,
  ].filter((line): line is string => line != null);

  const markdown = lines.join("\n").trim();
  return markdown.length > TRADE_RULES_MARKDOWN_MAX_CHARS
    ? `${markdown.slice(0, TRADE_RULES_MARKDOWN_MAX_CHARS).trimEnd()}...`
    : markdown;
}

export function buildStrategySnapshot(context: SessionStrategyContext): StrategySnapshot {
  return {
    version: 5,
    researchPosture: {
      posturePresetId: context.researchPosture.posturePresetId,
      discoveryMode: context.researchPosture.discoveryMode,
      evidenceMode: context.researchPosture.evidenceMode,
      catalystMode: context.researchPosture.catalystMode,
      fundamentalStrictness: context.researchPosture.fundamentalStrictness,
      postureNotes: context.researchPosture.postureNotes,
    },
    rules: {
      rulesPresetId: context.rules.rulesPresetId,
      setupType: context.rules.setupType,
      sideBias: context.rules.sideBias,
      entryStyle: context.rules.entryStyle,
      exitStyle: context.rules.exitStyle,
      scalingMode: context.rules.scalingMode,
      tradeRulesMarkdown: context.rules.tradeRulesMarkdown,
      ruleNotes: context.rules.ruleNotes,
    },
    riskConfig: {
      maxPositionUsd: context.riskConfig.maxPositionUsd,
      stopLossPct: context.riskConfig.stopLossPct,
      takeProfitPct: context.riskConfig.takeProfitPct,
      stopLossType: context.riskConfig.stopLossType,
      atrStopMultiplier: context.riskConfig.atrStopMultiplier,
      kellyFraction: context.riskConfig.kellyFraction,
      predictionEdgeThreshold: context.riskConfig.predictionEdgeThreshold,
      maxExposureUsd: context.riskConfig.maxExposureUsd,
      waitForOpenThreshold: context.riskConfig.waitForOpenThreshold,
      maxConcurrentTrades: context.riskConfig.maxConcurrentTrades,
      dailyLossLimitUsd: context.riskConfig.dailyLossLimitUsd,
      profitTargetUsd: context.riskConfig.profitTargetUsd,
      maxAiSpendUsd: context.riskConfig.maxAiSpendUsd,
      maxDataSpendUsd: context.riskConfig.maxDataSpendUsd,
      humanApprovalRequired: context.riskConfig.humanApprovalRequired,
    },
    timeframe: {
      primaryTradingTimeframe: context.timeframe.primaryTradingTimeframe,
      holdingStyle: context.timeframe.holdingStyle,
      targetHoldDays: context.timeframe.targetHoldDays,
      maxHoldDays: context.timeframe.maxHoldDays,
      timeframeNotes: context.timeframe.timeframeNotes,
    },
    aiRoleProfiles: context.aiRoleProfiles.map((p) => ({
      role: p.role,
      profileJson: p.profileJson,
    })),
  };
}

export function validateSessionStrategyContext(
  context: SessionStrategyContext,
  options: { hasSearchProvider: boolean },
): void {
  validateSessionTimeframeConfigFields(context.timeframe);

  if (context.riskConfig.maxPositionUsd < 0) throw new Error("Max position must be zero or greater.");
  if (context.riskConfig.maxConcurrentTrades < 0) throw new Error("Max concurrent trades must be zero or greater.");
  if (context.riskConfig.dailyLossLimitUsd < 0) throw new Error("Daily loss limit must be zero or greater.");
  if (context.riskConfig.profitTargetUsd < 0) throw new Error("Profit target must be zero or greater.");
  if (context.riskConfig.maxAiSpendUsd < 0) throw new Error("Max AI spend must be zero or greater.");
  if (context.riskConfig.maxDataSpendUsd < 0) throw new Error("Max data spend must be zero or greater.");
  if (context.riskConfig.stopLossPct != null && context.riskConfig.stopLossPct < 0) {
    throw new Error("Stop loss percent must be zero or greater.");
  }
  if (context.riskConfig.takeProfitPct != null && context.riskConfig.takeProfitPct < 0) {
    throw new Error("Take profit percent must be zero or greater.");
  }
  if (researchPostureNeedsSearchProvider(context.researchPosture) && !options.hasSearchProvider) {
    throw new Error("Catalyst-driven and event-contract styles require a configured search provider.");
  }
  if (isPredictionEventResearchPosture(context.researchPosture) || context.rules.setupType === "probability_edge") {
    if (context.riskConfig.kellyFraction <= 0) {
      throw new Error("Probability-edge rules require kelly fraction greater than zero.");
    }
    if (context.riskConfig.maxExposureUsd == null || context.riskConfig.maxExposureUsd <= 0) {
      throw new Error("Probability-edge rules require max exposure USD.");
    }
  }
  if (context.rules.tradeRulesMarkdown.length > TRADE_RULES_MARKDOWN_MAX_CHARS) {
    throw new Error(`Trade rules markdown must stay under ${TRADE_RULES_MARKDOWN_MAX_CHARS} characters.`);
  }
}

export function toLegacySessionConfig(context: SessionStrategyContext): SessionConfig {
  return {
    strategy: context.rules.setupType,
    max_position_usd: context.riskConfig.maxPositionUsd,
    stop_loss_pct: context.riskConfig.stopLossPct ?? 0,
    take_profit_pct: context.riskConfig.takeProfitPct ?? 0,
    max_concurrent_trades: context.riskConfig.maxConcurrentTrades,
    research_depth: "balanced",
    daily_loss_limit_usd: context.riskConfig.dailyLossLimitUsd,
    profit_target_usd: context.riskConfig.profitTargetUsd,
    max_api_spend_usd: context.riskConfig.maxAiSpendUsd,
    human_approval_required: context.riskConfig.humanApprovalRequired,
  };
}

function labelizeToken(token: string): string {
  return token
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function researchPostureNeedsSearchProvider(posture: SessionResearchPosture): boolean {
  return posture.catalystMode === "required" || posture.discoveryMode === "catalyst_scan" || posture.discoveryMode === "event_contract_scan";
}

function isPredictionEventResearchPosture(posture: SessionResearchPosture): boolean {
  return posture.discoveryMode === "event_contract_scan" || posture.evidenceMode === "probability_edge";
}

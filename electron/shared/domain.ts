export type InstrumentClass = "stock" | "crypto" | "futures" | "prediction_market";

export type SessionStatus = "draft" | "idle" | "active" | "paused" | "stopped" | "archived";
export type SessionRuntimeStatus = "starting" | "active" | "paused" | "stopping";

export type SelectionMode = "manual_shortlist" | "ai_selected_universe";
export type ExecutionMode = "paper_only" | "live_allowed";
export type ResearchDepth = "light" | "balanced" | "deep";
export type StrategyProfile = "passive_income" | "growth" | "conservative" | "custom";
export type ResearchPosturePresetId =
  | "trend_hunt"
  | "catalyst_momentum"
  | "institutional_quality"
  | "mean_reversion_dislocation"
  | "prediction_event_edge"
  | "custom";
export type ResearchDiscoveryMode =
  | "trend_scan"
  | "catalyst_scan"
  | "quality_watchlist"
  | "mean_reversion_scan"
  | "event_contract_scan"
  | "custom";
export type ResearchEvidenceMode =
  | "narrative_first"
  | "price_action_first"
  | "confirmation_first"
  | "probability_edge"
  | "balanced";
export type ResearchCatalystMode = "required" | "preferred" | "not_required";
export type ResearchFundamentalStrictness =
  | "sanity_check"
  | "balanced"
  | "deep_confirmation"
  | "not_applicable";
export type TradeRulesPresetId =
  | "breakout_long"
  | "pullback_trend"
  | "event_entry"
  | "reversal_fade"
  | "probability_edge"
  | "custom";
export type SetupType =
  | "breakout"
  | "pullback_trend"
  | "event_entry"
  | "reversal_fade"
  | "probability_edge"
  | "custom";
export type StrategySideBias = "long_only" | "short_only" | "both" | "market_neutral" | "n_a";
export type StrategyEntryStyle = "breakout" | "pullback" | "reversal" | "range_fade" | "event" | "probability_edge";
export type StrategyExitStyle =
  | "fixed_pct"
  | "trailing_atr"
  | "partial_exits"
  | "time_based"
  | "thesis_based"
  | "market_resolution";
export type StrategyScalingMode = "single_entry" | "scale_in_2" | "scale_in_3" | "scale_out_partial";
export type StopLossType = "fixed_pct" | "trailing_atr" | "broker_native_trailing" | "none";

export const RESEARCH_POSTURE_PRESET_IDS: readonly ResearchPosturePresetId[] = [
  "trend_hunt",
  "catalyst_momentum",
  "institutional_quality",
  "mean_reversion_dislocation",
  "prediction_event_edge",
  "custom",
];

export const RESEARCH_DISCOVERY_MODES: readonly ResearchDiscoveryMode[] = [
  "trend_scan",
  "catalyst_scan",
  "quality_watchlist",
  "mean_reversion_scan",
  "event_contract_scan",
  "custom",
];

export const RESEARCH_EVIDENCE_MODES: readonly ResearchEvidenceMode[] = [
  "narrative_first",
  "price_action_first",
  "confirmation_first",
  "probability_edge",
  "balanced",
];

export const RESEARCH_CATALYST_MODES: readonly ResearchCatalystMode[] = [
  "required",
  "preferred",
  "not_required",
];

export const RESEARCH_FUNDAMENTAL_STRICTNESS: readonly ResearchFundamentalStrictness[] = [
  "sanity_check",
  "balanced",
  "deep_confirmation",
  "not_applicable",
];

export const SETUP_TYPES: readonly SetupType[] = [
  "breakout",
  "pullback_trend",
  "event_entry",
  "reversal_fade",
  "probability_edge",
  "custom",
];

export const STRATEGY_SIDE_BIASES: readonly StrategySideBias[] = [
  "long_only",
  "short_only",
  "both",
  "market_neutral",
  "n_a",
];

export const STRATEGY_ENTRY_STYLES: readonly StrategyEntryStyle[] = [
  "breakout",
  "pullback",
  "reversal",
  "range_fade",
  "event",
  "probability_edge",
];

export const STRATEGY_EXIT_STYLES: readonly StrategyExitStyle[] = [
  "fixed_pct",
  "trailing_atr",
  "partial_exits",
  "time_based",
  "thesis_based",
  "market_resolution",
];

export const STRATEGY_SCALING_MODES: readonly StrategyScalingMode[] = [
  "single_entry",
  "scale_in_2",
  "scale_in_3",
  "scale_out_partial",
];

export const STOP_LOSS_TYPES: readonly StopLossType[] = [
  "fixed_pct",
  "trailing_atr",
  "broker_native_trailing",
  "none",
];

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

export const RESEARCH_POSTURE_PRESETS: readonly ResearchPosturePreset[] = [
  {
    id: "trend_hunt",
    label: "Trend Hunt",
    thesis: "Find persistent trends early and lean on price action to stay in motion.",
    summaryBullets: [
      "Discovery favors trend scans and relative-strength leaders.",
      "Evidence leans price-action first with confirmation.",
      "Catalysts help but are not mandatory.",
      "Fundamentals only need a sanity check.",
    ],
    posture: {
      posturePresetId: "trend_hunt",
      discoveryMode: "trend_scan",
      evidenceMode: "price_action_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
    },
  },
  {
    id: "catalyst_momentum",
    label: "Catalyst Momentum",
    thesis: "Chase clean momentum only when fresh catalysts can keep attention and volume alive.",
    summaryBullets: [
      "Discovery starts from catalyst and news scans.",
      "Evidence balances narrative with tape confirmation.",
      "Catalysts are required, not optional.",
      "Fundamentals only need a quick sanity check.",
    ],
    posture: {
      posturePresetId: "catalyst_momentum",
      discoveryMode: "catalyst_scan",
      evidenceMode: "balanced",
      catalystMode: "required",
      fundamentalStrictness: "sanity_check",
    },
  },
  {
    id: "institutional_quality",
    label: "Institutional Quality",
    thesis: "Wait for durable, high-quality names and demand stronger confirmation before committing.",
    summaryBullets: [
      "Discovery starts from curated quality watchlists.",
      "Evidence favors confirmation before action.",
      "Catalysts are optional unless they strengthen the case.",
      "Fundamental review is deep, not cursory.",
    ],
    posture: {
      posturePresetId: "institutional_quality",
      discoveryMode: "quality_watchlist",
      evidenceMode: "confirmation_first",
      catalystMode: "preferred",
      fundamentalStrictness: "deep_confirmation",
    },
  },
  {
    id: "mean_reversion_dislocation",
    label: "Mean Reversion Dislocation",
    thesis: "Hunt overstretched moves where odds favor a snap-back once panic or euphoria cools.",
    summaryBullets: [
      "Discovery looks for dislocations and exhaustion.",
      "Evidence waits for reversal confirmation.",
      "Catalysts are usually not required.",
      "Fundamentals are a light sanity filter.",
    ],
    posture: {
      posturePresetId: "mean_reversion_dislocation",
      discoveryMode: "mean_reversion_scan",
      evidenceMode: "confirmation_first",
      catalystMode: "not_required",
      fundamentalStrictness: "sanity_check",
    },
  },
  {
    id: "prediction_event_edge",
    label: "Prediction Event Edge",
    thesis: "Trade event contracts where evidence can shift implied probabilities before resolution.",
    summaryBullets: [
      "Discovery focuses on event contracts and resolution timelines.",
      "Evidence is probability-edge first.",
      "Catalysts are required because event flow drives repricing.",
      "Fundamentals are usually not applicable.",
    ],
    posture: {
      posturePresetId: "prediction_event_edge",
      discoveryMode: "event_contract_scan",
      evidenceMode: "probability_edge",
      catalystMode: "required",
      fundamentalStrictness: "not_applicable",
    },
  },
  {
    id: "custom",
    label: "Custom Style",
    thesis: "Blend your own discovery and evidence posture.",
    summaryBullets: [
      "No preset assumptions beyond what you set below.",
      "Use style notes to define the edge clearly.",
    ],
    posture: {
      posturePresetId: "custom",
      discoveryMode: "custom",
      evidenceMode: "balanced",
      catalystMode: "preferred",
      fundamentalStrictness: "balanced",
    },
  },
];

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

export const TRADE_RULE_PRESETS: readonly TradeRulesPreset[] = [
  {
    id: "breakout_long",
    label: "Breakout Long",
    thesis: "Enter strength only after price clears a meaningful level with follow-through.",
    summaryBullets: [
      "Long-biased breakout structure.",
      "Trailing exits let winners expand.",
      "Best when momentum and liquidity are clean.",
    ],
    rules: {
      rulesPresetId: "breakout_long",
      setupType: "breakout",
      sideBias: "long_only",
      entryStyle: "breakout",
      exitStyle: "trailing_atr",
      scalingMode: "single_entry",
    },
  },
  {
    id: "pullback_trend",
    label: "Pullback Trend",
    thesis: "Wait for established trends to retrace, then rejoin once continuation confirms.",
    summaryBullets: [
      "Bi-directional if the broader trend supports it.",
      "Pullback entries reduce chasing.",
      "Scaling allows layered participation.",
    ],
    rules: {
      rulesPresetId: "pullback_trend",
      setupType: "pullback_trend",
      sideBias: "both",
      entryStyle: "pullback",
      exitStyle: "trailing_atr",
      scalingMode: "scale_in_2",
    },
  },
  {
    id: "event_entry",
    label: "Event Entry",
    thesis: "Trade defined event reactions with time-sensitive entries and thesis-based exits.",
    summaryBullets: [
      "Event-driven trigger logic.",
      "Single-shot execution keeps exposure tight.",
      "Best when catalysts and timing are explicit.",
    ],
    rules: {
      rulesPresetId: "event_entry",
      setupType: "event_entry",
      sideBias: "both",
      entryStyle: "event",
      exitStyle: "time_based",
      scalingMode: "single_entry",
    },
  },
  {
    id: "reversal_fade",
    label: "Reversal Fade",
    thesis: "Fade exhaustion once price shows a credible reversal signal back toward fair value.",
    summaryBullets: [
      "Mean-reversion posture.",
      "Reversal entries demand confirmation.",
      "Scaling helps stage into volatile fades.",
    ],
    rules: {
      rulesPresetId: "reversal_fade",
      setupType: "reversal_fade",
      sideBias: "both",
      entryStyle: "reversal",
      exitStyle: "fixed_pct",
      scalingMode: "scale_in_2",
    },
  },
  {
    id: "probability_edge",
    label: "Probability Edge",
    thesis: "Only take trades where market odds appear materially mispriced versus evidence.",
    summaryBullets: [
      "Probability-first framing.",
      "Entry waits for quantified edge.",
      "Exits often resolve on thesis or contract outcome.",
    ],
    rules: {
      rulesPresetId: "probability_edge",
      setupType: "probability_edge",
      sideBias: "both",
      entryStyle: "probability_edge",
      exitStyle: "market_resolution",
      scalingMode: "single_entry",
    },
  },
  {
    id: "custom",
    label: "Custom Rules",
    thesis: "Define your own mechanics for entries, exits, and scaling.",
    summaryBullets: [
      "No preset assumptions beyond the current field values.",
      "Use rule notes for setup-specific filters and invalidation.",
    ],
    rules: {
      rulesPresetId: "custom",
      setupType: "custom",
      sideBias: "both",
      entryStyle: "breakout",
      exitStyle: "fixed_pct",
      scalingMode: "single_entry",
    },
  },
];

const TRADE_RULES_MARKDOWN_MAX_CHARS = 1_200;

/** Bar size the session uses for analysis and agent context. */
export type TradingTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

/** Coarse intended hold length — steers prompts and approval copy. */
export type HoldingStyle = "intraday_flat" | "multi_day_swing" | "weeks_position" | "custom";

export const TRADING_TIMEFRAMES: readonly TradingTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
];

export const HOLDING_STYLES: readonly HoldingStyle[] = [
  "intraday_flat",
  "multi_day_swing",
  "weeks_position",
  "custom",
];

export function isTradingTimeframe(value: unknown): value is TradingTimeframe {
  return typeof value === "string" && (TRADING_TIMEFRAMES as readonly string[]).includes(value);
}

export function isHoldingStyle(value: unknown): value is HoldingStyle {
  return typeof value === "string" && (HOLDING_STYLES as readonly string[]).includes(value);
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
export type WorkspaceViewMode = "session" | "global";
export type CapitalAllocationMode = "per_session_only" | "shared_global_pool";

export type AgentRole =
  | "analyst_technical"
  | "analyst_fundamental"
  | "reviewer"
  | "decision_maker"
  | "instrument_selector";

/** Parsed `session_ai_role_profile.operating_spec_json` — tools/method/output hints for prompts. */
export type AgentOperatingSpec = Record<string, unknown>;

export interface SessionAiRoleProfile {
  sessionId: string;
  role: AgentRole;
  operatingPresetId: string;
  operatingSpec: AgentOperatingSpec;
  notes: string;
  updatedAt: string;
}

export type PromptSource = "default" | "session_override";
export type ProviderType = "anthropic" | "openai" | "openrouter";
export type SearchProviderType = "brave" | "tavily" | "duckduckgo";
export type BrokerMode = "paper" | "live";

export type EventSourceType =
  | AgentRole
  | "session"
  | "preflight"
  | "approval"
  | "orchestrator"
  | "broker"
  | "capital";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
/** Matches `trades.status` CHECK in migrations (Phase 2). */
export type TradeStatus = "pending" | "open" | "closed" | "cancelled" | "failed" | "rejected";
export type TradeSide = "BUY" | "SELL";
export type PredictionOutcome = "YES" | "NO";

const LEGAL_TRANSITIONS: Partial<Record<SessionStatus, SessionStatus[]>> = {
  draft: ["idle", "active", "archived"],
  idle: ["active", "archived"],
  active: ["paused", "stopped"],
  paused: ["active", "stopped"],
  stopped: ["idle", "archived"],
};

export function isSessionEditable(status: SessionStatus): boolean {
  return status === "draft" || status === "idle" || status === "stopped";
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface WorkspaceSession {
  id: string;
  name: string;
  objective: string;
  status: SessionStatus;
  isFocused: boolean;
  selectionMode: SelectionMode;
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId: string | null;
  capitalLimitUsd: number;
  executionMode: ExecutionMode;
  startedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSelectorSettings {
  sessionId: string;
  aiPickerEnabled: boolean;
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
  version: 3;
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

export interface ProviderAccount {
  id: string;
  name: string;
  category: "ai" | "search";
  providerType: ProviderType | SearchProviderType;
  secretRef: string;
  metadataJson: string | null;
  isConfigured: boolean;
  lastTestStatus: "unknown" | "ok" | "error";
  updatedAt: string;
}

export interface BrokerAccount {
  id: string;
  name: string;
  brokerType: string;
  supportedInstrumentClasses: InstrumentClass[];
  mode: BrokerMode;
  secretRef: string;
  updatedAt: string;
}

export interface BrokerRoutingDefault {
  instrumentClass: InstrumentClass;
  defaultBrokerAccountId: string;
}

export interface SessionBrokerRoutingOverride {
  sessionId: string;
  instrumentClass: InstrumentClass;
  brokerAccountId: string;
}

export interface WorkspacePreferences {
  id: 1;
  globalIncludeArchived: boolean;
  defaultSearchProviderId: string | null;
  capitalAllocationMode: CapitalAllocationMode;
  globalCapitalPoolUsd: number | null;
  updatedAt: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string | null;
  sourceSessionId: string | null;
  templatePayloadJson: string;
  instrumentClasses: InstrumentClass[];
  updatedAt: string;
}

export interface SessionTemplatePayload {
  version: 1;
  identity: {
    objective: string;
    selectionMode: SelectionMode;
    instrumentClasses: InstrumentClass[];
    instrumentScope: string;
    executionMode: ExecutionMode;
    capitalLimitUsd: number;
    defaultSearchProviderId: string | null;
  };
  selectorSettings: {
    aiPickerEnabled: boolean;
  };
  strategyContext?: SessionStrategyContext;
  strategy: Omit<SessionStrategy, "sessionId">;
  aiRoles: Array<Omit<SessionAiRole, "sessionId">>;
  brokerAssignments: Array<{ brokerAccountId: string }>;
  brokerOverridesByInstrumentClass: Partial<Record<InstrumentClass, string>>;
}

export interface TradeApproval {
  id: string;
  sessionId: string;
  tradeId: string;
  brokerAccountId: string;
  instrumentSymbol: string;
  instrumentDisplayName: string | null;
  predictionOutcome: PredictionOutcome | null;
  instrumentMetadataJson: string | null;
  instrumentClass: InstrumentClass;
  proposedSide: TradeSide;
  proposedSizeUsd: number;
  decisionSummaryJson: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt: string | null;
  decisionNote: string | null;
}

export interface CapitalReservation {
  id: string;
  sessionId: string;
  approvalId: string | null;
  tradeId: string | null;
  amountUsd: number;
  reason: "approval" | "open_order" | "open_position";
  status: "reserved" | "consumed" | "released";
  createdAt: string;
  releasedAt: string | null;
}

export interface Trade {
  id: string;
  sessionId?: string;
  /** Populated when listing trades for display (global workspace). */
  sessionName?: string;
  brokerAccountId?: string | null;
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  instrumentType: InstrumentClass;
  side: TradeSide;
  entry_price: number | null;
  position_size_usd: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  strategy: string;
  status: TradeStatus;
  opened_at: string | null;
  closed_at: string | null;
  final_pnl_usd: number | null;
  ai_cost_usd: number;
  confidence_score: number | null;
  broker_order_id: string | null;
  created_at: string;
  current_price?: number | null;
  unrealized_pnl?: number | null;
}

/** Persisted on `agent_runs.finish_reason` — aligns with harness telemetry (§5 plan). */
export type AgentRunFinishReason = "stop" | "length" | "tool_budget" | "timeout" | "error";

export interface AgentRun {
  id: string;
  session_id?: string;
  /** Null for runs not tied to a trade (e.g. instrument selector). */
  trade_id: string | null;
  cycle_id?: string | null;
  agent_type: AgentRole;
  model: string;
  provider_key: string;
  finish_reason: AgentRunFinishReason;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  output_text: string;
  duration_ms: number;
  created_at: string;
}

/** External API observability row (`api_call_log`). */
export interface ApiCallLogEntry {
  id: string;
  session_id: string | null;
  trade_id: string | null;
  cycle_id: string | null;
  provider: string;
  endpoint: string;
  call_type: string;
  credits_used: number | null;
  cost_usd: number | null;
  latency_ms: number;
  status: string;
  from_cache: boolean;
  created_at: string;
}

export interface TradeAutopsy {
  id: string;
  trade_id: string;
  session_id: string;
  model_id: string;
  summary: string;
  created_at: string;
  created_by: string;
}

export interface AgentMessage {
  id: string;
  agent_run_id: string;
  session_id: string;
  trade_id: string | null;
  /** Research burst correlation id; null when not part of a burst. */
  cycle_id: string | null;
  role: AgentRole;
  provider_key: string;
  model_id: string;
  messages_json: string;
  thinking_json: string | null;
  tool_calls_json: string | null;
  output_json: string | null;
  output_schema_name: string | null;
  parse_fallback: boolean;
  strategy_snapshot_json: string;
  market_snapshot_json: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  session_id?: string | null;
  trade_id: string | null;
  cycle_id?: string | null;
  level: LogLevel;
  agent_type: EventSourceType | null;
  message: string;
  created_at: string;
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
    version: 3,
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

export interface DashboardStats {
  session_status: SessionStatus;
  daily_pnl_usd: number;
  daily_pnl_pct: number;
  total_trades_today: number;
  closed_trades_today: number;
  win_rate_today: number;
  open_trades: number;
  daily_api_spend: number;
  api_budget: number;
  portfolio_value: number;
  unrealized_pnl: number;
  session_uptime_min: number;
}

export interface CostBreakdown {
  total: number;
  by_agent: Array<{ name: AgentRole; tokens: number; cost: number }>;
  by_trade: Array<{ instrumentSymbol: string; cost: number }>;
  cache_savings_usd: number;
  daily_history: Array<{ date: string; cost: number }>;
}

export interface TradeDetail {
  trade: Trade;
  runs: AgentRun[];
  messages: AgentMessage[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  account_balance?: number;
}

export interface BrokerCredentials {
  provider: "alpaca";
  api_key: string;
  secret_key: string;
  mode: BrokerMode;
}

export interface TradeDecisionPayload {
  trade_id: string;
  approval_id?: string;
  session_id?: string;
  instrumentSymbol: string;
  instrumentDisplayName?: string;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  side: TradeSide;
  size_usd: number;
  confidence: number;
  reasoning: string;
}

/** Enriched row for approval:list (dashboard). */
export interface ApprovalSummary extends TradeApproval {
  sessionName: string;
  brokerName: string;
  /** Parsed from decisionSummaryJson when present. */
  confidenceScore?: number;
}

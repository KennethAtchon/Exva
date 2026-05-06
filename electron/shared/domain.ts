export type InstrumentClass = "stock" | "crypto" | "futures" | "prediction_market";

export type SessionStatus = "draft" | "idle" | "active" | "paused" | "stopped" | "archived";
export type SessionRuntimeStatus = "starting" | "active" | "paused" | "stopping";

export type SelectionMode = "manual_shortlist" | "ai_selected_universe";
export type ExecutionMode = "paper_only" | "live_allowed";
export type ResearchDepth = "light" | "balanced" | "deep";
export type StrategyProfile = "passive_income" | "growth" | "conservative" | "custom";
export type StrategyType =
  | "momentum"
  | "mean_reversion"
  | "trend_following"
  | "short_bias"
  | "pairs"
  | "fundamental"
  | "event_driven"
  | "prediction_market"
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

export const STRATEGY_TYPES: readonly StrategyType[] = [
  "momentum",
  "mean_reversion",
  "trend_following",
  "short_bias",
  "pairs",
  "fundamental",
  "event_driven",
  "prediction_market",
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

export const STRATEGY_BRIEF_MARKDOWN_MAX_CHARS = 1_200;

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

export function validateSessionTimeframeConfigFields(timeframe: SessionTimeframeConfig): void {
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

export type PromptSource = "default" | "session_override";
export type ProviderType = "anthropic" | "openai" | "openrouter";
export type SearchProviderType = "brave" | "tavily";
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

export interface SessionStrategyProfile {
  sessionId: string;
  strategyType: StrategyType;
  sideBias: StrategySideBias;
  entryStyle: StrategyEntryStyle;
  exitStyle: StrategyExitStyle;
  scalingMode: StrategyScalingMode;
  strategyBriefMarkdown: string;
  customInstructions: string;
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
  profile: SessionStrategyProfile;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
}

export interface StrategySnapshot {
  version: 1;
  profile: {
    strategyType: StrategyType;
    sideBias: StrategySideBias;
    entryStyle: StrategyEntryStyle;
    exitStyle: StrategyExitStyle;
    scalingMode: StrategyScalingMode;
    strategyBriefMarkdown: string;
    customInstructions: string;
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
  webSearchEnabled: boolean;
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

export function buildStrategyBriefMarkdown(context: SessionStrategyContext): string {
  const { profile, riskConfig, timeframe } = context;
  const lines = [
    `# ${labelizeToken(profile.strategyType)} Strategy Brief`,
    "",
    "## Strategy Intent",
    `- Strategy type: ${labelizeToken(profile.strategyType)}`,
    `- Side bias: ${labelizeToken(profile.sideBias)}`,
    `- Entry style: ${labelizeToken(profile.entryStyle)}`,
    `- Exit style: ${labelizeToken(profile.exitStyle)}`,
    `- Scaling mode: ${labelizeToken(profile.scalingMode)}`,
    "",
    "## Risk Controls",
    `- Max position: $${riskConfig.maxPositionUsd}`,
    `- Stop loss type: ${labelizeToken(riskConfig.stopLossType)}`,
    riskConfig.stopLossPct != null ? `- Stop loss: ${riskConfig.stopLossPct}%` : null,
    riskConfig.takeProfitPct != null ? `- Take profit: ${riskConfig.takeProfitPct}%` : null,
    riskConfig.atrStopMultiplier != null ? `- ATR stop multiplier: ${riskConfig.atrStopMultiplier}` : null,
    `- Max concurrent trades: ${riskConfig.maxConcurrentTrades}`,
    riskConfig.maxExposureUsd != null ? `- Max exposure: $${riskConfig.maxExposureUsd}` : null,
    `- Max data spend: $${riskConfig.maxDataSpendUsd}`,
    `- Human approval required: ${riskConfig.humanApprovalRequired ? "yes" : "no"}`,
    "",
    "## Timeframe",
    `- Primary timeframe: ${timeframe.primaryTradingTimeframe}`,
    `- Holding style: ${labelizeToken(timeframe.holdingStyle)}`,
    timeframe.targetHoldDays != null ? `- Target hold: ${timeframe.targetHoldDays} days` : null,
    timeframe.maxHoldDays != null ? `- Max hold: ${timeframe.maxHoldDays} days` : null,
    timeframe.timeframeNotes.trim() ? `- Notes: ${timeframe.timeframeNotes.trim()}` : null,
    profile.customInstructions.trim() ? "" : null,
    profile.customInstructions.trim() ? "## Special Instructions" : null,
    profile.customInstructions.trim() ? profile.customInstructions.trim() : null,
  ].filter((line): line is string => line != null);

  const markdown = lines.join("\n").trim();
  return markdown.length > STRATEGY_BRIEF_MARKDOWN_MAX_CHARS
    ? `${markdown.slice(0, STRATEGY_BRIEF_MARKDOWN_MAX_CHARS).trimEnd()}...`
    : markdown;
}

export function buildStrategySnapshot(context: SessionStrategyContext): StrategySnapshot {
  return {
    version: 1,
    profile: {
      strategyType: context.profile.strategyType,
      sideBias: context.profile.sideBias,
      entryStyle: context.profile.entryStyle,
      exitStyle: context.profile.exitStyle,
      scalingMode: context.profile.scalingMode,
      strategyBriefMarkdown: context.profile.strategyBriefMarkdown,
      customInstructions: context.profile.customInstructions,
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
  if (context.profile.strategyType === "event_driven" && !options.hasSearchProvider) {
    throw new Error("Event-driven strategies require a configured search provider.");
  }
  if (context.profile.strategyType === "prediction_market") {
    if (context.riskConfig.kellyFraction <= 0) {
      throw new Error("Prediction-market strategies require kelly fraction greater than zero.");
    }
    if (context.riskConfig.maxExposureUsd == null || context.riskConfig.maxExposureUsd <= 0) {
      throw new Error("Prediction-market strategies require max exposure USD.");
    }
  }
  if (context.profile.strategyBriefMarkdown.length > STRATEGY_BRIEF_MARKDOWN_MAX_CHARS) {
    throw new Error(`Strategy brief must stay under ${STRATEGY_BRIEF_MARKDOWN_MAX_CHARS} characters.`);
  }
}

export function toLegacySessionConfig(context: SessionStrategyContext): SessionConfig {
  return {
    strategy: context.profile.strategyType,
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

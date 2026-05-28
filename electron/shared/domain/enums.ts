export type InstrumentClass =
  | "stock"
  | "crypto"
  | "futures"
  | "prediction_market";

export type SessionStatus =
  | "draft"
  | "idle"
  | "active"
  | "attention_required"
  | "paused"
  | "monitoring_only"
  | "stopped"
  | "archived";
/**
 * Runtime lifecycle modes.
 * - `starting`: bootstrapping; not yet accepting work.
 * - `active`: orchestrator opens new trade cycles AND monitor watches open positions.
 * - `paused`: orchestrator paused (no NEW cycles) BUT monitor stays alive watching open positions.
 *   Use this for "stop new entries" while still managing in-flight trades safely.
 * - `stopping`: terminal; monitor stops only once no open positions remain or operator forces it.
 */
export type SessionRuntimeStatus =
  | "starting"
  | "active"
  | "paused"
  | "stopping";

export type ExecutionStage =
  | "selector"
  | "candidate_validation"
  | "technical"
  | "fundamental"
  | "review"
  | "decision"
  | "risk_gate"
  | "broker_order"
  | "monitoring";

export type ExecutionStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "skipped";

export interface ExecutionStepState {
  id: string;
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
  status: ExecutionStepStatus;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  outcome: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SelectionMode = "manual_shortlist" | "ai_selected_universe";
export type ExecutionMode = "paper_only" | "live_allowed";
export type ResearchDepth = "light" | "balanced" | "deep";
export type StrategyProfile =
  | "passive_income"
  | "growth"
  | "conservative"
  | "custom";
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
export type StrategySideBias =
  | "long_only"
  | "short_only"
  | "both"
  | "market_neutral"
  | "n_a";
export type StrategyEntryStyle =
  | "breakout"
  | "pullback"
  | "reversal"
  | "range_fade"
  | "event"
  | "probability_edge";
export type StrategyExitStyle =
  | "fixed_pct"
  | "trailing_atr"
  | "partial_exits"
  | "time_based"
  | "thesis_based"
  | "market_resolution";
export type StrategyScalingMode =
  | "single_entry"
  | "scale_in_2"
  | "scale_in_3"
  | "scale_out_partial";
export type StopLossType =
  | "fixed_pct"
  | "trailing_atr"
  | "broker_native_trailing"
  | "none";

export type RiskPresetId =
  | "conservative"
  | "moderate"
  | "aggressive"
  | "prediction_market"
  | "custom";

export type TimeframePresetId =
  | "intraday"
  | "swing"
  | "position"
  | "prediction"
  | "custom";

/** Bar size the session uses for analysis and agent context. */
export type TradingTimeframe =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w";

/** Coarse intended hold length — steers prompts and approval copy. */
export type HoldingStyle =
  | "intraday_flat"
  | "multi_day_swing"
  | "weeks_position"
  | "custom";

export type WorkspaceViewMode = "session" | "global";
export type AllocationEnforcement = "hard" | "warn";

export type AgentRole =
  | "selector"
  | "technical"
  | "fundamental"
  | "review"
  | "decision";

export type PromptSource = "default" | "session_override";
export type ProviderType = "anthropic" | "openai" | "openrouter";
export type SearchProviderType = "brave" | "tavily" | "duckduckgo" | "mcp";
export type BrokerMode = "paper" | "live";

export type EventSourceType =
  | AgentRole
  | "session"
  | "preflight"
  | "approval"
  | "orchestrator"
  | "broker"
  | "capital"
  | "period_autopsy";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";
/** Matches `trades.status` CHECK in migrations (Phase 2). */
export type TradeStatus =
  | "pending"
  | "open"
  | "closed"
  | "cancelled"
  | "failed"
  | "rejected";
export type TradeSide = "BUY" | "SELL";
export type PredictionOutcome = "YES" | "NO";

/** Persisted on `agent_runs.finish_reason` — aligns with harness telemetry (§5 plan). */
export type AgentRunFinishReason =
  | "stop"
  | "length"
  | "tool_budget"
  | "timeout"
  | "error";

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

export const RESEARCH_FUNDAMENTAL_STRICTNESS: readonly ResearchFundamentalStrictness[] =
  ["sanity_check", "balanced", "deep_confirmation", "not_applicable"];

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

export const RISK_PRESET_IDS: readonly RiskPresetId[] = [
  "conservative",
  "moderate",
  "aggressive",
  "prediction_market",
  "custom",
];

export const TIMEFRAME_PRESET_IDS: readonly TimeframePresetId[] = [
  "intraday",
  "swing",
  "position",
  "prediction",
  "custom",
];

export const STOP_LOSS_TYPES: readonly StopLossType[] = [
  "fixed_pct",
  "trailing_atr",
  "broker_native_trailing",
  "none",
];

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
  return (
    typeof value === "string" &&
    (TRADING_TIMEFRAMES as readonly string[]).includes(value)
  );
}

export function isHoldingStyle(value: unknown): value is HoldingStyle {
  return (
    typeof value === "string" &&
    (HOLDING_STYLES as readonly string[]).includes(value)
  );
}

const LEGAL_TRANSITIONS: Partial<Record<SessionStatus, SessionStatus[]>> = {
  draft: ["idle", "active", "archived"],
  idle: ["active", "archived"],
  active: ["attention_required", "paused", "monitoring_only", "stopped"],
  attention_required: ["active", "paused", "monitoring_only", "stopped"],
  paused: ["active", "monitoring_only", "stopped"],
  monitoring_only: ["stopped"],
  stopped: ["idle", "active", "archived"],
};

export function isSessionEditable(status: SessionStatus): boolean {
  return status === "draft" || status === "idle" || status === "stopped";
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export type InstrumentClass = "stock" | "crypto" | "futures";

export type SessionStatus = "draft" | "idle" | "active" | "paused" | "stopped" | "archived";
export type SessionRuntimeStatus = "starting" | "active" | "paused" | "stopping";

export type SelectionMode = "manual_shortlist" | "ai_selected_universe";
export type ExecutionMode = "paper_only" | "live_allowed";
export type ResearchDepth = "light" | "balanced" | "deep";
export type StrategyProfile = "passive_income" | "growth" | "conservative" | "custom";
export type WorkspaceViewMode = "session" | "global";
export type CapitalAllocationMode = "per_session_only" | "shared_global_pool";

export type AgentRole =
  | "researcher_bull"
  | "researcher_bear"
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

const LEGAL_TRANSITIONS: Partial<Record<SessionStatus, SessionStatus[]>> = {
  draft: ["idle", "archived"],
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

export interface AgentRun {
  id: string;
  session_id?: string;
  trade_id: string;
  agent_type: AgentRole;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  output_text: string;
  duration_ms: number;
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

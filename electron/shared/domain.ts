export type SessionStatus = "draft" | "idle" | "active" | "paused" | "stopped" | "archived";

export type SessionRuntimeStatus = "starting" | "active" | "paused" | "stopping";

export type TradeStatus = "pending" | "open" | "closed" | "rejected";
export type TradeSide = "BUY" | "SELL";

export type InstrumentClass = "stock" | "crypto" | "future";
export type SelectionMode = "manual_shortlist" | "ai_selected_universe";
export type ExecutionMode = "paper_only" | "live_allowed";

export type AgentType =
  | "researcher_bull"
  | "researcher_bear"
  | "reviewer"
  | "decision_maker"
  | "instrument_selector";

export type EventAgentType =
  | AgentType
  | "session"
  | "preflight"
  | "approval"
  | "orchestrator"
  | "broker"
  | "capital";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

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
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Trade {
  id: string;
  session_id?: string;
  asset: string;
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
  agent_type: AgentType;
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
  agent_type: EventAgentType | null;
  message: string;
  created_at: string;
}

export interface SessionConfig {
  strategy: string;
  max_position_usd: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  max_concurrent_trades: number;
  research_depth: "light" | "balanced" | "deep";
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
  by_agent: Array<{ name: AgentType; tokens: number; cost: number }>;
  by_trade: Array<{ asset: string; cost: number }>;
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
  mode: "paper" | "live";
}

export interface TradeDecisionPayload {
  trade_id: string;
  asset: string;
  side: TradeSide;
  size_usd: number;
  confidence: number;
  reasoning: string;
}

export function isSessionEditable(status: SessionStatus): boolean {
  return status !== "active" && status !== "paused";
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) return true;

  const transitions: Record<SessionStatus, SessionStatus[]> = {
    draft: ["idle", "archived"],
    idle: ["active", "archived"],
    active: ["paused", "stopped"],
    paused: ["active", "stopped"],
    stopped: ["active", "archived"],
    archived: [],
  };

  return transitions[from].includes(to);
}

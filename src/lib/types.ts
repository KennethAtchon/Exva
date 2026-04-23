// Shared types — mirror Rust structs in src-tauri/src/types.rs

export type SessionStatus = "idle" | "active" | "paused" | "stopped";

export type TradeStatus = "pending" | "open" | "closed" | "rejected";
export type TradeSide = "BUY" | "SELL";

export type AgentType =
  | "researcher_bull"
  | "researcher_bear"
  | "reviewer"
  | "decision_maker";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface Trade {
  id: string;
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
  // Derived on backend for open trades
  current_price?: number | null;
  unrealized_pnl?: number | null;
}

export interface AgentRun {
  id: string;
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
  trade_id: string | null;
  level: LogLevel;
  agent_type: AgentType | null;
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

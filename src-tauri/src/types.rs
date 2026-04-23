// Shared serde types mirrored on the frontend (src/lib/types.ts).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Active,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum TradeSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TradeStatus {
    Pending,
    Open,
    Closed,
    Rejected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ResearcherBull,
    ResearcherBear,
    Reviewer,
    DecisionMaker,
}

impl AgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::ResearcherBull => "researcher_bull",
            AgentType::ResearcherBear => "researcher_bear",
            AgentType::Reviewer => "reviewer",
            AgentType::DecisionMaker => "decision_maker",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub asset: String,
    pub side: TradeSide,
    pub entry_price: Option<f64>,
    pub position_size_usd: f64,
    pub stop_loss_price: Option<f64>,
    pub take_profit_price: Option<f64>,
    pub strategy: String,
    pub status: TradeStatus,
    pub opened_at: Option<String>,
    pub closed_at: Option<String>,
    pub final_pnl_usd: Option<f64>,
    pub ai_cost_usd: f64,
    pub confidence_score: Option<f64>,
    pub broker_order_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unrealized_pnl: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRun {
    pub id: String,
    pub trade_id: String,
    pub agent_type: AgentType,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub output_text: String,
    pub duration_ms: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRow {
    pub id: String,
    pub trade_id: Option<String>,
    pub level: LogLevel,
    pub agent_type: Option<AgentType>,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchDepth {
    Light,
    Balanced,
    Deep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub strategy: String,
    pub max_position_usd: f64,
    pub stop_loss_pct: f64,
    pub take_profit_pct: f64,
    pub max_concurrent_trades: i64,
    pub research_depth: ResearchDepth,
    pub daily_loss_limit_usd: f64,
    pub profit_target_usd: f64,
    pub max_api_spend_usd: f64,
    pub human_approval_required: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            strategy: "passive_income".into(),
            max_position_usd: 500.0,
            stop_loss_pct: 2.0,
            take_profit_pct: 4.0,
            max_concurrent_trades: 3,
            research_depth: ResearchDepth::Balanced,
            daily_loss_limit_usd: 200.0,
            profit_target_usd: 1000.0,
            max_api_spend_usd: 5.0,
            human_approval_required: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub session_status: SessionStatus,
    pub daily_pnl_usd: f64,
    pub daily_pnl_pct: f64,
    pub total_trades_today: i64,
    pub closed_trades_today: i64,
    pub win_rate_today: f64,
    pub open_trades: i64,
    pub daily_api_spend: f64,
    pub api_budget: f64,
    pub portfolio_value: f64,
    pub unrealized_pnl: f64,
    pub session_uptime_min: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostByAgent {
    pub name: AgentType,
    pub tokens: i64,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostByTrade {
    pub asset: String,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyHistory {
    pub date: String,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostBreakdown {
    pub total: f64,
    pub by_agent: Vec<CostByAgent>,
    pub by_trade: Vec<CostByTrade>,
    pub cache_savings_usd: f64,
    pub daily_history: Vec<DailyHistory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeDetail {
    pub trade: Trade,
    pub runs: Vec<AgentRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "lowercase")]
pub enum BrokerCredentials {
    Alpaca {
        api_key: String,
        secret_key: String,
        mode: BrokerMode,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BrokerMode {
    Paper,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub message: String,
    pub account_balance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFilters {
    pub min_level: Option<LogLevel>,
    pub agent_type: Option<AgentType>,
    pub search: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeDecisionPayload {
    pub trade_id: String,
    pub asset: String,
    pub side: TradeSide,
    pub size_usd: f64,
    pub confidence: f64,
    pub reasoning: String,
}

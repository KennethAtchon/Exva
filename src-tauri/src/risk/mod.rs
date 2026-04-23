//! Risk engine: session-level guardrails checked after every trade close and
//! every monitor tick. See System_Design.md §7.

use serde::{Deserialize, Serialize};

use crate::types::{DashboardStats, SessionConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StopReason {
    DailyLossLimit,
    ProfitTarget,
    ApiBudget,
}

pub fn check_limits(stats: &DashboardStats, cfg: &SessionConfig) -> Option<StopReason> {
    if stats.daily_pnl_usd <= -cfg.daily_loss_limit_usd {
        return Some(StopReason::DailyLossLimit);
    }
    if stats.daily_pnl_usd >= cfg.profit_target_usd {
        return Some(StopReason::ProfitTarget);
    }
    if stats.daily_api_spend >= cfg.max_api_spend_usd {
        return Some(StopReason::ApiBudget);
    }
    None
}

/// v1 self-adaptation: tighten stop-loss and shrink position size when the last
/// 10 closed trades have a win rate below 40%. See System_Design.md §7.
pub fn adapt_if_poor_performance(
    recent_win_rate: f64,
    recent_trade_count: i64,
    cfg: &mut SessionConfig,
) -> bool {
    if recent_trade_count < 10 {
        return false;
    }
    if recent_win_rate >= 0.40 {
        return false;
    }
    cfg.stop_loss_pct = (cfg.stop_loss_pct - 0.5).max(0.5);
    cfg.max_position_usd = (cfg.max_position_usd * 0.9).max(100.0);
    true
}

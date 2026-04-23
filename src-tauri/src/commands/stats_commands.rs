use tauri::State;

use crate::db::stats;
use crate::error::AppResult;
use crate::types::{CostBreakdown, DashboardStats};
use crate::AppState;

const DEFAULT_API_BUDGET: f64 = 5.0;

#[tauri::command]
pub async fn get_dashboard_stats(state: State<'_, AppState>) -> AppResult<DashboardStats> {
    let conn = state.db.conn()?;
    stats::dashboard_stats(
        &conn,
        state.session.status(),
        state.session.portfolio_value(),
        state.session.uptime_min(),
        DEFAULT_API_BUDGET,
    )
}

#[tauri::command]
pub async fn get_cost_breakdown(
    state: State<'_, AppState>,
    date_range: Option<String>,
) -> AppResult<CostBreakdown> {
    let _ = date_range; // room to filter later
    let conn = state.db.conn()?;
    let by_agent = stats::cost_by_agent(&conn)?;
    let by_trade = stats::cost_by_trade(&conn)?;
    let daily = stats::daily_history(&conn, 7)?;
    let total: f64 = by_agent.iter().map(|a| a.cost).sum();
    Ok(CostBreakdown {
        total,
        by_agent,
        by_trade,
        cache_savings_usd: 0.0,
        daily_history: daily,
    })
}

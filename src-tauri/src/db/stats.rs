use chrono::Utc;
use rusqlite::params;

use super::PooledConn;
use crate::error::AppResult;
use crate::types::{CostByAgent, CostByTrade, DailyHistory, DashboardStats, SessionStatus};

fn today_iso() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Roll up DB state into the dashboard snapshot. Portfolio value / uptime are
/// currently not persisted — supplied via the session manager.
pub fn dashboard_stats(
    conn: &PooledConn,
    session_status: SessionStatus,
    portfolio_value: f64,
    session_uptime_min: i64,
    api_budget: f64,
) -> AppResult<DashboardStats> {
    let today = today_iso();
    let like_today = format!("{today}%");

    let open_trades: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trades WHERE status = 'open'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let total_trades_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trades WHERE created_at LIKE ?1",
            params![like_today],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let closed_trades_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trades WHERE status = 'closed' AND closed_at LIKE ?1",
            params![like_today],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let wins_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trades WHERE status = 'closed' AND closed_at LIKE ?1 AND final_pnl_usd > 0",
            params![like_today],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let daily_pnl_usd: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(final_pnl_usd), 0) FROM trades WHERE status = 'closed' AND closed_at LIKE ?1",
            params![like_today],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let daily_api_spend: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM agent_runs WHERE created_at LIKE ?1",
            params![like_today],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let win_rate_today = if closed_trades_today > 0 {
        wins_today as f64 / closed_trades_today as f64
    } else {
        0.0
    };

    let daily_pnl_pct = if portfolio_value > 0.0 {
        daily_pnl_usd / portfolio_value
    } else {
        0.0
    };

    Ok(DashboardStats {
        session_status,
        daily_pnl_usd,
        daily_pnl_pct,
        total_trades_today,
        closed_trades_today,
        win_rate_today,
        open_trades,
        daily_api_spend,
        api_budget,
        portfolio_value,
        unrealized_pnl: 0.0,
        session_uptime_min,
    })
}

pub fn cost_by_agent(conn: &PooledConn) -> AppResult<Vec<CostByAgent>> {
    let today = today_iso();
    let like_today = format!("{today}%");
    let mut stmt = conn.prepare(
        "SELECT agent_type, SUM(input_tokens + output_tokens), SUM(cost_usd) \
         FROM agent_runs WHERE created_at LIKE ?1 GROUP BY agent_type",
    )?;
    let rows = stmt.query_map([like_today], |r| {
        let agent: String = r.get(0)?;
        let name = match agent.as_str() {
            "researcher_bull" => crate::types::AgentType::ResearcherBull,
            "researcher_bear" => crate::types::AgentType::ResearcherBear,
            "reviewer" => crate::types::AgentType::Reviewer,
            _ => crate::types::AgentType::DecisionMaker,
        };
        Ok(CostByAgent {
            name,
            tokens: r.get::<_, i64>(1).unwrap_or(0),
            cost: r.get::<_, f64>(2).unwrap_or(0.0),
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn cost_by_trade(conn: &PooledConn) -> AppResult<Vec<CostByTrade>> {
    let today = today_iso();
    let like_today = format!("{today}%");
    let mut stmt = conn.prepare(
        "SELECT t.asset, SUM(a.cost_usd) FROM agent_runs a \
         JOIN trades t ON t.id = a.trade_id \
         WHERE a.created_at LIKE ?1 GROUP BY t.asset ORDER BY SUM(a.cost_usd) DESC",
    )?;
    let rows = stmt.query_map([like_today], |r| {
        Ok(CostByTrade {
            asset: r.get(0)?,
            cost: r.get::<_, f64>(1).unwrap_or(0.0),
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn daily_history(conn: &PooledConn, days: i64) -> AppResult<Vec<DailyHistory>> {
    let mut stmt = conn.prepare(
        "SELECT substr(created_at, 1, 10) AS d, SUM(cost_usd) \
         FROM agent_runs \
         WHERE created_at >= date('now', ?1) \
         GROUP BY d ORDER BY d ASC",
    )?;
    let span = format!("-{} days", days);
    let rows = stmt.query_map([span], |r| {
        let d: String = r.get(0)?;
        Ok(DailyHistory {
            date: d.chars().skip(8).collect(),
            cost: r.get::<_, f64>(1).unwrap_or(0.0),
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

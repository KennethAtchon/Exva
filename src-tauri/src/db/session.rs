use chrono::Utc;
use rusqlite::params;

use super::PooledConn;
use crate::error::AppResult;
use crate::types::{ResearchDepth, SessionConfig};

fn depth_to_str(d: &ResearchDepth) -> &'static str {
    match d {
        ResearchDepth::Light => "light",
        ResearchDepth::Balanced => "balanced",
        ResearchDepth::Deep => "deep",
    }
}

fn depth_from_str(s: &str) -> ResearchDepth {
    match s {
        "light" => ResearchDepth::Light,
        "deep" => ResearchDepth::Deep,
        _ => ResearchDepth::Balanced,
    }
}

pub fn get(conn: &PooledConn) -> AppResult<SessionConfig> {
    let cfg: SessionConfig = conn.query_row(
        "SELECT strategy, max_position_usd, stop_loss_pct, take_profit_pct, max_concurrent_trades, \
         research_depth, daily_loss_limit_usd, profit_target_usd, max_api_spend_usd, human_approval_required \
         FROM session_config WHERE id = 1",
        [],
        |r| {
            Ok(SessionConfig {
                strategy: r.get(0)?,
                max_position_usd: r.get(1)?,
                stop_loss_pct: r.get(2)?,
                take_profit_pct: r.get(3)?,
                max_concurrent_trades: r.get(4)?,
                research_depth: depth_from_str(&r.get::<_, String>(5)?),
                daily_loss_limit_usd: r.get(6)?,
                profit_target_usd: r.get(7)?,
                max_api_spend_usd: r.get(8)?,
                human_approval_required: r.get::<_, i64>(9)? != 0,
            })
        },
    )?;
    Ok(cfg)
}

pub fn save(conn: &PooledConn, c: &SessionConfig) -> AppResult<()> {
    conn.execute(
        "UPDATE session_config SET strategy=?1, max_position_usd=?2, stop_loss_pct=?3, \
         take_profit_pct=?4, max_concurrent_trades=?5, research_depth=?6, \
         daily_loss_limit_usd=?7, profit_target_usd=?8, max_api_spend_usd=?9, \
         human_approval_required=?10, updated_at=?11 WHERE id = 1",
        params![
            c.strategy,
            c.max_position_usd,
            c.stop_loss_pct,
            c.take_profit_pct,
            c.max_concurrent_trades,
            depth_to_str(&c.research_depth),
            c.daily_loss_limit_usd,
            c.profit_target_usd,
            c.max_api_spend_usd,
            c.human_approval_required as i64,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

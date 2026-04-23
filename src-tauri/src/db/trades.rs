use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use super::PooledConn;
use crate::error::AppResult;
use crate::types::{Trade, TradeSide, TradeStatus};

fn side_to_str(s: TradeSide) -> &'static str {
    match s {
        TradeSide::Buy => "BUY",
        TradeSide::Sell => "SELL",
    }
}

fn str_to_side(s: &str) -> TradeSide {
    match s {
        "SELL" => TradeSide::Sell,
        _ => TradeSide::Buy,
    }
}

fn status_to_str(s: TradeStatus) -> &'static str {
    match s {
        TradeStatus::Pending => "pending",
        TradeStatus::Open => "open",
        TradeStatus::Closed => "closed",
        TradeStatus::Rejected => "rejected",
    }
}

fn str_to_status(s: &str) -> TradeStatus {
    match s {
        "open" => TradeStatus::Open,
        "closed" => TradeStatus::Closed,
        "rejected" => TradeStatus::Rejected,
        _ => TradeStatus::Pending,
    }
}

fn map_row(r: &Row) -> rusqlite::Result<Trade> {
    Ok(Trade {
        id: r.get(0)?,
        asset: r.get(1)?,
        side: str_to_side(&r.get::<_, String>(2)?),
        entry_price: r.get(3)?,
        position_size_usd: r.get(4)?,
        stop_loss_price: r.get(5)?,
        take_profit_price: r.get(6)?,
        strategy: r.get(7)?,
        status: str_to_status(&r.get::<_, String>(8)?),
        opened_at: r.get(9)?,
        closed_at: r.get(10)?,
        final_pnl_usd: r.get(11)?,
        ai_cost_usd: r.get(12)?,
        confidence_score: r.get(13)?,
        broker_order_id: r.get(14)?,
        created_at: r.get(15)?,
        current_price: None,
        unrealized_pnl: None,
    })
}

const SELECT_COLS: &str = "id, asset, side, entry_price, position_size_usd, \
    stop_loss_price, take_profit_price, strategy, status, opened_at, closed_at, \
    final_pnl_usd, ai_cost_usd, confidence_score, broker_order_id, created_at";

pub fn insert(conn: &PooledConn, trade: &Trade) -> AppResult<()> {
    conn.execute(
        "INSERT INTO trades (id, asset, side, entry_price, position_size_usd, \
         stop_loss_price, take_profit_price, strategy, status, opened_at, closed_at, \
         final_pnl_usd, ai_cost_usd, confidence_score, broker_order_id, created_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![
            trade.id,
            trade.asset,
            side_to_str(trade.side),
            trade.entry_price,
            trade.position_size_usd,
            trade.stop_loss_price,
            trade.take_profit_price,
            trade.strategy,
            status_to_str(trade.status),
            trade.opened_at,
            trade.closed_at,
            trade.final_pnl_usd,
            trade.ai_cost_usd,
            trade.confidence_score,
            trade.broker_order_id,
            trade.created_at,
        ],
    )?;
    Ok(())
}

pub fn new_pending(asset: &str, side: TradeSide, size_usd: f64, strategy: &str) -> Trade {
    Trade {
        id: Uuid::new_v4().to_string(),
        asset: asset.into(),
        side,
        entry_price: None,
        position_size_usd: size_usd,
        stop_loss_price: None,
        take_profit_price: None,
        strategy: strategy.into(),
        status: TradeStatus::Pending,
        opened_at: None,
        closed_at: None,
        final_pnl_usd: None,
        ai_cost_usd: 0.0,
        confidence_score: None,
        broker_order_id: None,
        created_at: Utc::now().to_rfc3339(),
        current_price: None,
        unrealized_pnl: None,
    }
}

pub fn list_all(conn: &PooledConn) -> AppResult<Vec<Trade>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM trades ORDER BY created_at DESC LIMIT 200"
    ))?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn list_by_status(conn: &PooledConn, status: TradeStatus) -> AppResult<Vec<Trade>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM trades WHERE status = ?1 ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map([status_to_str(status)], map_row)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn find(conn: &PooledConn, id: &str) -> AppResult<Option<Trade>> {
    let mut stmt =
        conn.prepare(&format!("SELECT {SELECT_COLS} FROM trades WHERE id = ?1"))?;
    Ok(stmt.query_row([id], map_row).optional()?)
}

pub fn update_status(
    conn: &PooledConn,
    id: &str,
    status: TradeStatus,
    final_pnl_usd: Option<f64>,
) -> AppResult<()> {
    let closed_at = matches!(status, TradeStatus::Closed).then(|| Utc::now().to_rfc3339());
    conn.execute(
        "UPDATE trades SET status = ?1, closed_at = COALESCE(?2, closed_at), \
         final_pnl_usd = COALESCE(?3, final_pnl_usd) WHERE id = ?4",
        params![status_to_str(status), closed_at, final_pnl_usd, id],
    )?;
    Ok(())
}

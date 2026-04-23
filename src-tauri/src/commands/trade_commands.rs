use tauri::State;

use crate::db::{agent_runs, trades};
use crate::error::{AppError, AppResult};
use crate::types::{SessionStatus, Trade, TradeDetail, TradeStatus};
use crate::AppState;

#[tauri::command]
pub async fn get_active_trades(state: State<'_, AppState>) -> AppResult<Vec<Trade>> {
    let conn = state.db.conn()?;
    trades::list_all(&conn)
}

#[tauri::command]
pub async fn get_trade_detail(
    state: State<'_, AppState>,
    trade_id: String,
) -> AppResult<TradeDetail> {
    let conn = state.db.conn()?;
    let trade = trades::find(&conn, &trade_id)?
        .ok_or_else(|| AppError::NotFound(format!("trade {trade_id}")))?;
    let runs = agent_runs::list_by_trade(&conn, &trade_id)?;
    Ok(TradeDetail { trade, runs })
}

#[tauri::command]
pub async fn force_close_trade(
    state: State<'_, AppState>,
    trade_id: String,
) -> AppResult<()> {
    let broker = state.broker();
    let conn = state.db.conn()?;
    let trade = trades::find(&conn, &trade_id)?
        .ok_or_else(|| AppError::NotFound(format!("trade {trade_id}")))?;
    if let Some(order_id) = &trade.broker_order_id {
        let r = broker.close_order(order_id).await?;
        trades::update_status(&conn, &trade_id, TradeStatus::Closed, Some(r.realized_pnl_usd))?;
    } else {
        trades::update_status(&conn, &trade_id, TradeStatus::Closed, Some(0.0))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn approve_trade(
    _state: State<'_, AppState>,
    _trade_id: String,
    _approved: bool,
) -> AppResult<()> {
    // TODO: route to the oneshot channel the orchestrator is parked on.
    Ok(())
}

#[tauri::command]
pub async fn start_session(state: State<'_, AppState>) -> AppResult<SessionStatus> {
    Ok(state.session.start())
}

#[tauri::command]
pub async fn pause_session(state: State<'_, AppState>) -> AppResult<SessionStatus> {
    Ok(state.session.pause())
}

#[tauri::command]
pub async fn stop_session(state: State<'_, AppState>) -> AppResult<SessionStatus> {
    Ok(state.session.stop())
}

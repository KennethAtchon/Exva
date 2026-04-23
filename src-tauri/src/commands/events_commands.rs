use tauri::State;

use crate::db::{agent_runs, events};
use crate::error::AppResult;
use crate::types::{AgentRun, EventFilters, EventRow};
use crate::AppState;

#[tauri::command]
pub async fn get_events(
    state: State<'_, AppState>,
    filters: Option<EventFilters>,
) -> AppResult<Vec<EventRow>> {
    let conn = state.db.conn()?;
    let f = filters.unwrap_or(EventFilters {
        min_level: None,
        agent_type: None,
        search: None,
        limit: Some(200),
    });
    events::query(&conn, &f)
}

#[tauri::command]
pub async fn get_agent_traces(
    state: State<'_, AppState>,
    trade_id: String,
) -> AppResult<Vec<AgentRun>> {
    let conn = state.db.conn()?;
    agent_runs::list_by_trade(&conn, &trade_id)
}

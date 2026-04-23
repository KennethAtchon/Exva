use tauri::State;

use crate::db::session as db_session;
use crate::error::AppResult;
use crate::types::SessionConfig;
use crate::AppState;

#[tauri::command]
pub async fn get_strategy_config(state: State<'_, AppState>) -> AppResult<SessionConfig> {
    let conn = state.db.conn()?;
    db_session::get(&conn)
}

#[tauri::command]
pub async fn save_strategy_config(
    state: State<'_, AppState>,
    cfg: SessionConfig,
) -> AppResult<()> {
    let conn = state.db.conn()?;
    db_session::save(&conn, &cfg)?;
    Ok(())
}

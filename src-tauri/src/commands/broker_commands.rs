use std::sync::Arc;

use tauri::State;

use crate::broker::{alpaca::AlpacaBroker, BrokerAdapter, MockBroker};
use crate::error::AppResult;
use crate::keychain::{self, keys};
use crate::types::{BrokerCredentials, BrokerMode, ConnectionTestResult};
use crate::AppState;

#[tauri::command]
pub async fn add_broker_account(
    state: State<'_, AppState>,
    creds: BrokerCredentials,
) -> AppResult<ConnectionTestResult> {
    let BrokerCredentials::Alpaca { api_key, secret_key, mode } = creds;

    keychain::set_secret(keys::ALPACA_API_KEY, &api_key)?;
    keychain::set_secret(keys::ALPACA_SECRET_KEY, &secret_key)?;
    keychain::set_secret(
        keys::ALPACA_MODE,
        match mode {
            BrokerMode::Paper => "paper",
            BrokerMode::Live => "live",
        },
    )?;

    let adapter: Arc<dyn BrokerAdapter> =
        Arc::new(AlpacaBroker::new(api_key, secret_key, mode));
    let result = adapter.test_connection().await.unwrap_or(ConnectionTestResult {
        ok: false,
        message: "Alpaca adapter not yet implemented".into(),
        account_balance: None,
    });

    // Only swap in the live adapter if the connection test succeeded.
    if result.ok {
        state.set_broker(adapter);
    }
    Ok(result)
}

#[tauri::command]
pub async fn test_broker_connection(state: State<'_, AppState>) -> AppResult<ConnectionTestResult> {
    state.broker().test_connection().await
}

#[tauri::command]
pub async fn remove_broker_account(state: State<'_, AppState>) -> AppResult<()> {
    keychain::delete_secret(keys::ALPACA_API_KEY)?;
    keychain::delete_secret(keys::ALPACA_SECRET_KEY)?;
    keychain::delete_secret(keys::ALPACA_MODE)?;
    state.set_broker(Arc::new(MockBroker::default()));
    Ok(())
}

#[tauri::command]
pub async fn save_api_key(
    _state: State<'_, AppState>,
    key_type: String,
    value: String,
) -> AppResult<()> {
    let slot = match key_type.as_str() {
        "anthropic" => keys::ANTHROPIC_API_KEY,
        "brave" => keys::BRAVE_API_KEY,
        "tavily" => keys::TAVILY_API_KEY,
        other => {
            return Err(crate::error::AppError::Invalid(format!(
                "unknown key_type: {other}"
            )))
        }
    };
    keychain::set_secret(slot, &value)?;
    Ok(())
}

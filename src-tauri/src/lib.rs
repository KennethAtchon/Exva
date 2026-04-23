use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::{fmt, EnvFilter};

pub mod agents;
pub mod broker;
pub mod commands;
pub mod db;
pub mod error;
pub mod keychain;
pub mod monitor;
pub mod notifications;
pub mod risk;
pub mod session;
pub mod types;

use broker::{BrokerAdapter, MockBroker};
use db::Database;
use session::SessionManager;

/// Shared handles injected into every Tauri command via `State<AppState>`.
pub struct AppState {
    pub db: Arc<Database>,
    pub session: Arc<SessionManager>,
    pub broker: parking_lot::RwLock<Arc<dyn BrokerAdapter>>,
}

impl AppState {
    pub fn broker(&self) -> Arc<dyn BrokerAdapter> {
        self.broker.read().clone()
    }

    pub fn set_broker(&self, b: Arc<dyn BrokerAdapter>) {
        *self.broker.write() = b;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,exva_lib=debug")))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // DB path under app data dir.
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("exva.db");

            let db = Arc::new(Database::open(&db_path).expect("open database"));
            db.run_migrations().expect("db migrations");

            let session = Arc::new(SessionManager::new(db.clone(), handle.clone()));
            let broker: Arc<dyn BrokerAdapter> = Arc::new(MockBroker::default());

            app.manage(AppState {
                db,
                session,
                broker: parking_lot::RwLock::new(broker),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // stats
            commands::stats_commands::get_dashboard_stats,
            commands::stats_commands::get_cost_breakdown,
            // trades
            commands::trade_commands::get_active_trades,
            commands::trade_commands::get_trade_detail,
            commands::trade_commands::force_close_trade,
            commands::trade_commands::approve_trade,
            // session
            commands::trade_commands::start_session,
            commands::trade_commands::pause_session,
            commands::trade_commands::stop_session,
            // config
            commands::config_commands::get_strategy_config,
            commands::config_commands::save_strategy_config,
            // broker/creds
            commands::broker_commands::add_broker_account,
            commands::broker_commands::test_broker_connection,
            commands::broker_commands::remove_broker_account,
            commands::broker_commands::save_api_key,
            // events / dev
            commands::events_commands::get_events,
            commands::events_commands::get_agent_traces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! Per-trade monitor task. Polls the broker every 5s, updates open trade
//! state in SQLite, and emits `stats_update` events to the frontend.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::time::interval;

use crate::broker::BrokerAdapter;
use crate::db::Database;
use crate::types::TradeStatus;

pub struct TradeMonitor {
    pub trade_id: String,
    pub broker_order_id: String,
    pub db: Arc<Database>,
    pub broker: Arc<dyn BrokerAdapter>,
    pub handle: AppHandle,
}

impl TradeMonitor {
    pub async fn run(self) {
        let mut ticker = interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;

            let status = match self.broker.get_order_status(&self.broker_order_id).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("broker poll failed for {}: {e}", self.trade_id);
                    continue;
                }
            };

            if status.closed {
                if let Ok(conn) = self.db.conn() {
                    let _ = crate::db::trades::update_status(
                        &conn,
                        &self.trade_id,
                        TradeStatus::Closed,
                        None,
                    );
                }
                let _ = self.handle.emit("trade_closed", &self.trade_id);
                break;
            }
        }
    }
}

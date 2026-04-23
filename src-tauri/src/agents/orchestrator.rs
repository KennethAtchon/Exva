//! End-to-end trade cycle. See System_Design.md §4.1.
//!
//! Currently a scaffold: the sequence is wired, but each step returns a
//! not-yet-implemented error so the caller can see where to fill in.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

use crate::broker::BrokerAdapter;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::types::SessionConfig;

use super::{decision_maker, researcher, reviewer, ClaudeClient};

pub async fn run_trade_cycle(
    handle: &AppHandle,
    _db: Arc<Database>,
    _broker: Arc<dyn BrokerAdapter>,
    client: &ClaudeClient,
    asset: &str,
    config: &SessionConfig,
) -> AppResult<()> {
    let _ = handle.emit("agent_event", format!("Cycle starting for {asset}"));

    // Bull/bear in parallel, 90s cap.
    let bull_fut = researcher::run_bull(client, asset, &config.research_depth);
    let bear_fut = researcher::run_bear(client, asset, &config.research_depth);
    let (bull, bear) = timeout(Duration::from_secs(90), async {
        tokio::try_join!(bull_fut, bear_fut)
    })
    .await
    .map_err(|_| AppError::Agent("researcher timeout".into()))??;

    let review = timeout(
        Duration::from_secs(60),
        reviewer::run(client, &bull.text, &bear.text),
    )
    .await
    .map_err(|_| AppError::Agent("reviewer timeout".into()))??;

    let (_dm_out, decision) = timeout(
        Duration::from_secs(30),
        decision_maker::run(client, &bull.text, &bear.text, &review.text, config),
    )
    .await
    .map_err(|_| AppError::Agent("decision timeout".into()))??;

    // TODO: persist agent_runs rows; if decision is Trade, call broker and
    // spawn TradeMonitor; if human_approval_required, emit approval_required
    // and wait on oneshot channel (10 min max).
    tracing::info!(?decision, "decision produced");

    Ok(())
}

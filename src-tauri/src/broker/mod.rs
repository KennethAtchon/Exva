use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::types::{ConnectionTestResult, TradeSide};

pub mod alpaca;
pub mod mock;

pub use mock::MockBroker;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRequest {
    pub asset: String,
    pub side: TradeSide,
    pub notional_usd: f64,
    pub stop_loss_price: Option<f64>,
    pub take_profit_price: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderResult {
    pub broker_order_id: String,
    pub filled_price: Option<f64>,
    pub accepted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseResult {
    pub closed_at: String,
    pub realized_pnl_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderStatus {
    pub broker_order_id: String,
    pub current_price: Option<f64>,
    pub filled: bool,
    pub closed: bool,
}

#[async_trait]
pub trait BrokerAdapter: Send + Sync {
    async fn test_connection(&self) -> AppResult<ConnectionTestResult>;
    async fn get_account_balance(&self) -> AppResult<f64>;
    async fn place_order(&self, order: OrderRequest) -> AppResult<OrderResult>;
    async fn close_order(&self, order_id: &str) -> AppResult<CloseResult>;
    async fn get_order_status(&self, order_id: &str) -> AppResult<OrderStatus>;
}

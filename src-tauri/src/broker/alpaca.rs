use async_trait::async_trait;

use super::{BrokerAdapter, CloseResult, OrderRequest, OrderResult, OrderStatus};
use crate::error::{AppError, AppResult};
use crate::types::{BrokerMode, ConnectionTestResult};

pub struct AlpacaBroker {
    pub api_key: String,
    pub secret_key: String,
    pub mode: BrokerMode,
    pub http: reqwest::Client,
}

impl AlpacaBroker {
    pub fn new(api_key: String, secret_key: String, mode: BrokerMode) -> Self {
        Self {
            api_key,
            secret_key,
            mode,
            http: reqwest::Client::new(),
        }
    }

    pub fn base_url(&self) -> &'static str {
        match self.mode {
            BrokerMode::Paper => "https://paper-api.alpaca.markets",
            BrokerMode::Live => "https://api.alpaca.markets",
        }
    }
}

// TODO: implement real Alpaca REST integration. The structure is in place so
// the orchestrator can swap this in via `AppState::set_broker`.
#[async_trait]
impl BrokerAdapter for AlpacaBroker {
    async fn test_connection(&self) -> AppResult<ConnectionTestResult> {
        Err(AppError::Broker("Alpaca adapter not yet implemented".into()))
    }

    async fn get_account_balance(&self) -> AppResult<f64> {
        Err(AppError::Broker("Alpaca adapter not yet implemented".into()))
    }

    async fn place_order(&self, _order: OrderRequest) -> AppResult<OrderResult> {
        Err(AppError::Broker("Alpaca adapter not yet implemented".into()))
    }

    async fn close_order(&self, _order_id: &str) -> AppResult<CloseResult> {
        Err(AppError::Broker("Alpaca adapter not yet implemented".into()))
    }

    async fn get_order_status(&self, _order_id: &str) -> AppResult<OrderStatus> {
        Err(AppError::Broker("Alpaca adapter not yet implemented".into()))
    }
}

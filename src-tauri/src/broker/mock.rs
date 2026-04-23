use async_trait::async_trait;
use chrono::Utc;
use uuid::Uuid;

use super::{BrokerAdapter, CloseResult, OrderRequest, OrderResult, OrderStatus};
use crate::error::AppResult;
use crate::types::ConnectionTestResult;

/// Stand-in broker used during development and when no real credentials are set.
#[derive(Debug, Default)]
pub struct MockBroker;

#[async_trait]
impl BrokerAdapter for MockBroker {
    async fn test_connection(&self) -> AppResult<ConnectionTestResult> {
        Ok(ConnectionTestResult {
            ok: true,
            message: "Mock broker — no network calls".into(),
            account_balance: Some(100_000.0),
        })
    }

    async fn get_account_balance(&self) -> AppResult<f64> {
        Ok(100_000.0)
    }

    async fn place_order(&self, _order: OrderRequest) -> AppResult<OrderResult> {
        Ok(OrderResult {
            broker_order_id: format!("MOCK-{}", Uuid::new_v4()),
            filled_price: Some(100.0),
            accepted_at: Utc::now().to_rfc3339(),
        })
    }

    async fn close_order(&self, _order_id: &str) -> AppResult<CloseResult> {
        Ok(CloseResult {
            closed_at: Utc::now().to_rfc3339(),
            realized_pnl_usd: 0.0,
        })
    }

    async fn get_order_status(&self, order_id: &str) -> AppResult<OrderStatus> {
        Ok(OrderStatus {
            broker_order_id: order_id.into(),
            current_price: Some(100.0),
            filled: true,
            closed: false,
        })
    }
}

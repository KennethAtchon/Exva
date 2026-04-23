//! Thin Anthropic SDK wrapper. Each call:
//!   - uses prompt caching on the system block (`cache_control: ephemeral`)
//!   - records input/output tokens, cost, and duration for the `agent_runs` table
//!   - isolates web search results inside user content (never system) to
//!     mitigate prompt injection.
//!
//! This file is a scaffold — wire real HTTP calls in a follow-up pass.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::types::AgentType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct AgentOutput {
    pub text: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
    pub model: String,
}

#[derive(Debug, Clone)]
pub struct ClaudeClient {
    pub api_key: String,
    pub model: String,
    pub http: reqwest::Client,
}

impl ClaudeClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: "claude-haiku-4-5".into(),
            http: reqwest::Client::new(),
        }
    }

    pub async fn call(
        &self,
        _agent: AgentType,
        _system_prompt: &str,
        _user_message: &str,
        _tools: Option<Vec<Tool>>,
        _max_tokens: u32,
    ) -> AppResult<AgentOutput> {
        // TODO: implement real API call with prompt caching + usage metering.
        Err(AppError::Agent("Claude client not yet implemented".into()))
    }
}

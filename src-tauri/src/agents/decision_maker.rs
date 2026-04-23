use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::types::{AgentType, SessionConfig, TradeSide};

use super::claude_client::{AgentOutput, ClaudeClient};

pub const SYSTEM: &str = include_str!("prompts/decision_maker.md");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum TradeDecision {
    Trade {
        side: TradeSide,
        size_pct: f64,
        confidence: f64,
        reasoning: String,
    },
    NoTrade {
        reasoning: String,
    },
}

pub async fn run(
    client: &ClaudeClient,
    bull: &str,
    bear: &str,
    review: &str,
    config: &SessionConfig,
) -> AppResult<(AgentOutput, TradeDecision)> {
    let user = format!(
        "Strategy: {strategy}\nBull: {bull}\nBear: {bear}\nReview: {review}",
        strategy = config.strategy,
    );
    let out = client
        .call(AgentType::DecisionMaker, SYSTEM, &user, None, 400)
        .await?;
    // TODO: parse JSON-structured output once Claude client is wired.
    let decision = TradeDecision::NoTrade {
        reasoning: "decision_maker not yet implemented".into(),
    };
    Ok((out, decision))
}

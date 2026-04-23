use crate::error::AppResult;
use crate::types::{AgentType, ResearchDepth};

use super::claude_client::{AgentOutput, ClaudeClient};

pub const BULL_SYSTEM: &str = include_str!("prompts/researcher_bull.md");
pub const BEAR_SYSTEM: &str = include_str!("prompts/researcher_bear.md");

pub async fn run_bull(
    client: &ClaudeClient,
    asset: &str,
    depth: &ResearchDepth,
) -> AppResult<AgentOutput> {
    let user = format!("Asset: {asset}\nResearch depth: {depth:?}");
    client
        .call(AgentType::ResearcherBull, BULL_SYSTEM, &user, None, max_tokens(depth))
        .await
}

pub async fn run_bear(
    client: &ClaudeClient,
    asset: &str,
    depth: &ResearchDepth,
) -> AppResult<AgentOutput> {
    let user = format!("Asset: {asset}\nResearch depth: {depth:?}");
    client
        .call(AgentType::ResearcherBear, BEAR_SYSTEM, &user, None, max_tokens(depth))
        .await
}

fn max_tokens(depth: &ResearchDepth) -> u32 {
    match depth {
        ResearchDepth::Light => 400,
        ResearchDepth::Balanced => 800,
        ResearchDepth::Deep => 1500,
    }
}

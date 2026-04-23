use crate::error::AppResult;
use crate::types::AgentType;

use super::claude_client::{AgentOutput, ClaudeClient};

pub const SYSTEM: &str = include_str!("prompts/reviewer.md");

pub async fn run(
    client: &ClaudeClient,
    bull: &str,
    bear: &str,
) -> AppResult<AgentOutput> {
    let user = format!("BULL:\n{bull}\n\nBEAR:\n{bear}");
    client.call(AgentType::Reviewer, SYSTEM, &user, None, 600).await
}

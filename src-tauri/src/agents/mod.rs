//! Agent orchestration. See System_Design.md §4.
//!
//! Current state: scaffolding only. The orchestrator wires together researcher,
//! reviewer, decision maker and executor; each agent's Claude call is still a
//! TODO.

pub mod claude_client;
pub mod decision_maker;
pub mod orchestrator;
pub mod researcher;
pub mod reviewer;

pub use claude_client::ClaudeClient;
pub use orchestrator::run_trade_cycle;

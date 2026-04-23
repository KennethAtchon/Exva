use rusqlite::{params, Row};

use super::PooledConn;
use crate::error::AppResult;
use crate::types::{AgentRun, AgentType};

fn agent_from_str(s: &str) -> AgentType {
    match s {
        "researcher_bull" => AgentType::ResearcherBull,
        "researcher_bear" => AgentType::ResearcherBear,
        "reviewer" => AgentType::Reviewer,
        _ => AgentType::DecisionMaker,
    }
}

fn map_row(r: &Row) -> rusqlite::Result<AgentRun> {
    Ok(AgentRun {
        id: r.get(0)?,
        trade_id: r.get(1)?,
        agent_type: agent_from_str(&r.get::<_, String>(2)?),
        model: r.get(3)?,
        input_tokens: r.get(4)?,
        output_tokens: r.get(5)?,
        cost_usd: r.get(6)?,
        output_text: r.get(7)?,
        duration_ms: r.get(8)?,
        created_at: r.get(9)?,
    })
}

pub fn insert(conn: &PooledConn, run: &AgentRun) -> AppResult<()> {
    conn.execute(
        "INSERT INTO agent_runs (id, trade_id, agent_type, model, input_tokens, output_tokens, \
         cost_usd, output_text, duration_ms, created_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            run.id,
            run.trade_id,
            run.agent_type.as_str(),
            run.model,
            run.input_tokens,
            run.output_tokens,
            run.cost_usd,
            run.output_text,
            run.duration_ms,
            run.created_at,
        ],
    )?;
    Ok(())
}

pub fn list_by_trade(conn: &PooledConn, trade_id: &str) -> AppResult<Vec<AgentRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, trade_id, agent_type, model, input_tokens, output_tokens, cost_usd, \
         output_text, duration_ms, created_at FROM agent_runs WHERE trade_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([trade_id], map_row)?;
    Ok(rows.filter_map(Result::ok).collect())
}

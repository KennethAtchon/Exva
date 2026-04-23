use chrono::Utc;
use rusqlite::{params, Row};
use uuid::Uuid;

use super::PooledConn;
use crate::error::AppResult;
use crate::types::{AgentType, EventFilters, EventRow, LogLevel};

fn level_to_str(l: LogLevel) -> &'static str {
    match l {
        LogLevel::Debug => "DEBUG",
        LogLevel::Info => "INFO",
        LogLevel::Warn => "WARN",
        LogLevel::Error => "ERROR",
    }
}

fn level_from_str(s: &str) -> LogLevel {
    match s {
        "DEBUG" => LogLevel::Debug,
        "WARN" => LogLevel::Warn,
        "ERROR" => LogLevel::Error,
        _ => LogLevel::Info,
    }
}

fn agent_from_str_opt(s: Option<String>) -> Option<AgentType> {
    s.and_then(|v| match v.as_str() {
        "researcher_bull" => Some(AgentType::ResearcherBull),
        "researcher_bear" => Some(AgentType::ResearcherBear),
        "reviewer" => Some(AgentType::Reviewer),
        "decision_maker" => Some(AgentType::DecisionMaker),
        _ => None,
    })
}

fn map_row(r: &Row) -> rusqlite::Result<EventRow> {
    Ok(EventRow {
        id: r.get(0)?,
        trade_id: r.get(1)?,
        level: level_from_str(&r.get::<_, String>(2)?),
        agent_type: agent_from_str_opt(r.get(3)?),
        message: r.get(4)?,
        created_at: r.get(5)?,
    })
}

pub fn insert(
    conn: &PooledConn,
    level: LogLevel,
    trade_id: Option<&str>,
    agent_type: Option<AgentType>,
    message: &str,
) -> AppResult<EventRow> {
    let row = EventRow {
        id: Uuid::new_v4().to_string(),
        trade_id: trade_id.map(|s| s.to_string()),
        level,
        agent_type,
        message: message.to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    conn.execute(
        "INSERT INTO events (id, trade_id, level, agent_type, message, created_at) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            row.id,
            row.trade_id,
            level_to_str(row.level),
            row.agent_type.as_ref().map(|a| a.as_str()),
            row.message,
            row.created_at,
        ],
    )?;
    Ok(row)
}

pub fn query(conn: &PooledConn, f: &EventFilters) -> AppResult<Vec<EventRow>> {
    let mut sql = String::from(
        "SELECT id, trade_id, level, agent_type, message, created_at FROM events WHERE 1 = 1",
    );
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(lvl) = f.min_level {
        // Map levels to ranks so we can filter with >=
        sql.push_str(" AND CASE level WHEN 'DEBUG' THEN 0 WHEN 'INFO' THEN 1 WHEN 'WARN' THEN 2 WHEN 'ERROR' THEN 3 END >= ?");
        let rank: i64 = match lvl {
            LogLevel::Debug => 0,
            LogLevel::Info => 1,
            LogLevel::Warn => 2,
            LogLevel::Error => 3,
        };
        args.push(Box::new(rank));
    }
    if let Some(a) = f.agent_type {
        sql.push_str(" AND agent_type = ?");
        args.push(Box::new(a.as_str().to_string()));
    }
    if let Some(s) = &f.search {
        sql.push_str(" AND message LIKE ?");
        args.push(Box::new(format!("%{s}%")));
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    args.push(Box::new(f.limit.unwrap_or(200)));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())),
        map_row,
    )?;
    Ok(rows.filter_map(Result::ok).collect())
}

import type Database from "better-sqlite3";

export function runMigrations(sqlite: Database.Database): void {
  const hasSessionsTable = Boolean(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .get() as { name?: string } | undefined,
  );

  if (!hasSessionsTable) {
    sqlite.exec(`
      DROP TABLE IF EXISTS agent_runs;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS trades;
      DROP TABLE IF EXISTS session_strategies;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS session_config;
      DROP TABLE IF EXISTS session_state;
      DROP TABLE IF EXISTS adaptations;
    `);
  }

  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('draft', 'idle', 'active', 'paused', 'stopped', 'archived')),
      is_focused INTEGER NOT NULL DEFAULT 0,
      selection_mode TEXT NOT NULL DEFAULT 'manual_shortlist' CHECK (selection_mode IN ('manual_shortlist', 'ai_selected_universe')),
      instrument_classes TEXT NOT NULL,
      instrument_scope TEXT NOT NULL,
      default_search_provider_id TEXT,
      capital_limit_usd REAL NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'paper_only' CHECK (execution_mode IN ('paper_only', 'live_allowed')),
      started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_focus ON sessions(is_focused) WHERE is_focused = 1;

    CREATE TABLE IF NOT EXISTS session_strategies (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      strategy TEXT NOT NULL DEFAULT 'passive_income',
      max_position_usd REAL NOT NULL DEFAULT 500,
      stop_loss_pct REAL NOT NULL DEFAULT 2.0,
      take_profit_pct REAL NOT NULL DEFAULT 4.0,
      max_concurrent_trades INTEGER NOT NULL DEFAULT 3,
      research_depth TEXT NOT NULL DEFAULT 'balanced',
      daily_loss_limit_usd REAL NOT NULL DEFAULT 200,
      profit_target_usd REAL NOT NULL DEFAULT 1000,
      max_api_spend_usd REAL NOT NULL DEFAULT 5.0,
      human_approval_required INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO sessions (
      id, name, objective, status, is_focused, selection_mode,
      instrument_classes, instrument_scope, capital_limit_usd,
      execution_mode, started_at, created_at, updated_at
    ) VALUES (
      'default-session',
      'Primary Session',
      'Default workspace session',
      'idle',
      1,
      'manual_shortlist',
      '["stock"]',
      'SPY,QQQ',
      10000,
      'paper_only',
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO session_strategies (session_id) VALUES ('default-session');

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      entry_price REAL,
      position_size_usd REAL NOT NULL,
      stop_loss_price REAL,
      take_profit_price REAL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'open', 'closed', 'rejected')),
      opened_at TEXT,
      closed_at TEXT,
      final_pnl_usd REAL,
      ai_cost_usd REAL NOT NULL DEFAULT 0,
      confidence_score REAL,
      broker_order_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL CHECK (agent_type IN (
        'researcher_bull',
        'researcher_bear',
        'reviewer',
        'decision_maker',
        'instrument_selector'
      )),
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      output_text TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      trade_id TEXT REFERENCES trades(id) ON DELETE SET NULL,
      level TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
      agent_type TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS adaptations (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      old_params TEXT NOT NULL,
      new_params TEXT NOT NULL,
      win_rate REAL NOT NULL,
      trade_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trades_session_status ON trades(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_trade_id ON agent_runs(trade_id);
    CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_trade_id ON events(trade_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `);
}

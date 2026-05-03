import type Database from "better-sqlite3";

export function runMigrations(sqlite: Database.Database, options?: { rebuildFromScratch?: boolean }): void {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  if (options?.rebuildFromScratch) {
    sqlite.exec(`
      DROP TABLE IF EXISTS capital_reservations;
      DROP TABLE IF EXISTS trade_approvals;
      DROP TABLE IF EXISTS session_instrument_cache;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS agent_runs;
      DROP TABLE IF EXISTS trades;
      DROP TABLE IF EXISTS session_templates;
      DROP TABLE IF EXISTS workspace_preferences;
      DROP TABLE IF EXISTS session_broker_assignments;
      DROP TABLE IF EXISTS session_broker_routing_overrides;
      DROP TABLE IF EXISTS broker_routing;
      DROP TABLE IF EXISTS session_ai_roles;
      DROP TABLE IF EXISTS session_strategies;
      DROP TABLE IF EXISTS session_selector_settings;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS provider_accounts;
      DROP TABLE IF EXISTS broker_accounts;
      DROP TABLE IF EXISTS session_config;
      DROP TABLE IF EXISTS session_state;
      DROP TABLE IF EXISTS adaptations;
    `);
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS provider_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      secret_ref TEXT NOT NULL,
      metadata_json TEXT,
      is_configured INTEGER NOT NULL DEFAULT 0,
      last_test_status TEXT NOT NULL DEFAULT 'unknown',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broker_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      broker_type TEXT NOT NULL,
      supported_instrument_classes TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'paper',
      secret_ref TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','idle','active','paused','stopped','archived')),
      is_focused INTEGER NOT NULL DEFAULT 0 CHECK (NOT (is_focused = 1 AND status = 'archived')),
      selection_mode TEXT NOT NULL DEFAULT 'manual_shortlist' CHECK (selection_mode IN ('manual_shortlist','ai_selected_universe')),
      instrument_classes TEXT NOT NULL,
      instrument_scope TEXT NOT NULL,
      default_search_provider_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
      capital_limit_usd REAL NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'paper_only' CHECK (execution_mode IN ('paper_only','live_allowed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_selector_settings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      ai_picker_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_strategies (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      strategy_profile TEXT NOT NULL DEFAULT 'passive_income',
      max_position_usd REAL NOT NULL DEFAULT 500,
      stop_loss_pct REAL NOT NULL DEFAULT 2.0,
      take_profit_pct REAL NOT NULL DEFAULT 4.0,
      max_concurrent_trades INTEGER NOT NULL DEFAULT 3,
      research_depth TEXT NOT NULL DEFAULT 'balanced',
      daily_loss_limit_usd REAL NOT NULL DEFAULT 200,
      profit_target_usd REAL NOT NULL DEFAULT 1000,
      max_ai_spend_usd REAL NOT NULL DEFAULT 5.0,
      human_approval_required INTEGER NOT NULL DEFAULT 0,
      primary_trading_timeframe TEXT NOT NULL DEFAULT '1d',
      holding_style TEXT NOT NULL DEFAULT 'multi_day_swing',
      target_hold_days REAL,
      max_hold_days REAL,
      timeframe_notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS session_ai_roles (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      web_search_enabled INTEGER NOT NULL DEFAULT 0,
      prompt_source TEXT NOT NULL DEFAULT 'default',
      prompt_markdown TEXT NOT NULL DEFAULT '',
      prompt_asset_path TEXT
    );

    CREATE TABLE IF NOT EXISTS broker_routing (
      instrument_class TEXT PRIMARY KEY,
      default_broker_account_id TEXT NOT NULL REFERENCES broker_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_broker_routing_overrides (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      instrument_class TEXT NOT NULL,
      broker_account_id TEXT NOT NULL REFERENCES broker_accounts(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, instrument_class)
    );

    CREATE TABLE IF NOT EXISTS session_broker_assignments (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      broker_account_id TEXT NOT NULL REFERENCES broker_accounts(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, broker_account_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_preferences (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (
        id = 1
        AND (
          capital_allocation_mode = 'per_session_only'
          OR (
            capital_allocation_mode = 'shared_global_pool'
            AND global_capital_pool_usd IS NOT NULL
            AND global_capital_pool_usd > 0
          )
        )
      ),
      global_include_archived INTEGER NOT NULL DEFAULT 0,
      default_search_provider_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
      capital_allocation_mode TEXT NOT NULL DEFAULT 'per_session_only',
      global_capital_pool_usd REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      source_session_id TEXT,
      template_payload_json TEXT NOT NULL,
      instrument_classes TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      broker_account_id TEXT REFERENCES broker_accounts(id) ON DELETE SET NULL,
      instrument_symbol TEXT NOT NULL,
      instrument_type TEXT NOT NULL DEFAULT 'stock',
      side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
      entry_price REAL,
      position_size_usd REAL NOT NULL,
      stop_loss_price REAL,
      take_profit_price REAL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','open','closed','cancelled','failed','rejected')),
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
      trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
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
      level TEXT NOT NULL CHECK (level IN ('DEBUG','INFO','WARN','ERROR')),
      agent_type TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      broker_account_id TEXT NOT NULL,
      instrument_symbol TEXT NOT NULL,
      instrument_class TEXT NOT NULL,
      proposed_side TEXT NOT NULL CHECK (proposed_side IN ('BUY','SELL')),
      proposed_size_usd REAL NOT NULL,
      decision_summary_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      decision_note TEXT
    );

    CREATE TABLE IF NOT EXISTS capital_reservations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      approval_id TEXT REFERENCES trade_approvals(id) ON DELETE SET NULL,
      trade_id TEXT REFERENCES trades(id) ON DELETE SET NULL,
      amount_usd REAL NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('approval','open_order','open_position')),
      status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','released')),
      created_at TEXT NOT NULL,
      released_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_instrument_cache (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      instruments TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      selected_at TEXT NOT NULL,
      selector_agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL
    );

    CREATE TRIGGER IF NOT EXISTS trg_focus_singleton_insert
    BEFORE INSERT ON sessions
    FOR EACH ROW WHEN NEW.is_focused = 1
    BEGIN
      SELECT CASE WHEN (
        SELECT COUNT(*) FROM sessions WHERE is_focused = 1 AND status != 'archived'
      ) > 0 THEN RAISE(ABORT, 'is_focused_singleton_violated') END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_focus_singleton_update
    BEFORE UPDATE OF is_focused ON sessions
    FOR EACH ROW WHEN NEW.is_focused = 1
    BEGIN
      SELECT CASE WHEN (
        SELECT COUNT(*) FROM sessions WHERE is_focused = 1 AND status != 'archived' AND id != NEW.id
      ) > 0 THEN RAISE(ABORT, 'is_focused_singleton_violated') END;
    END;

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_is_focused ON sessions(is_focused);
    CREATE INDEX IF NOT EXISTS idx_trades_session_id ON trades(session_id);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_trades_instrument ON trades(instrument_symbol, broker_account_id, status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_session ON trade_approvals(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_session_broker_override ON session_broker_routing_overrides(session_id, instrument_class);
    CREATE INDEX IF NOT EXISTS idx_capital_reservations_session ON capital_reservations(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_capital_reservations_approval ON capital_reservations(approval_id);
  `);
  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO workspace_preferences (
        id, global_include_archived, capital_allocation_mode, global_capital_pool_usd, updated_at
      ) VALUES (1, 0, 'per_session_only', NULL, ?)
      `,
    )
    .run(new Date().toISOString());
}

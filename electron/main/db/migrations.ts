import type Database from "better-sqlite3";

const REQUIRED_TABLES = [
  "sessions",
  "session_selector_settings",
  "session_strategies",
  "session_ai_roles",
  "provider_accounts",
  "broker_accounts",
  "broker_routing",
  "session_broker_routing_overrides",
  "session_broker_assignments",
  "workspace_preferences",
  "session_templates",
  "trades",
  "agent_runs",
  "events",
  "trade_approvals",
  "capital_reservations",
];

export function runMigrations(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  if (shouldResetSchema(sqlite)) {
    sqlite.exec(`
      DROP TABLE IF EXISTS capital_reservations;
      DROP TABLE IF EXISTS trade_approvals;
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

  migrateSessionStrategyHorizonColumns(sqlite);
  migrateSessionInstrumentCache(sqlite);
  seedCompatibilityDefaults(sqlite);
}

function tableColumnNames(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** Persisted AI instrument selector output (Phase 9). */
function migrateSessionInstrumentCache(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS session_instrument_cache (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      instruments TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      selected_at TEXT NOT NULL,
      selector_agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL
    );
  `);
}

/** Add timeframe / hold horizon columns when upgrading from older DB files. */
function migrateSessionStrategyHorizonColumns(sqlite: Database.Database): void {
  let cols = tableColumnNames(sqlite, "session_strategies");
  if (!cols.has("primary_trading_timeframe")) {
    sqlite.exec(
      "ALTER TABLE session_strategies ADD COLUMN primary_trading_timeframe TEXT NOT NULL DEFAULT '1d'",
    );
    cols = tableColumnNames(sqlite, "session_strategies");
  }
  if (!cols.has("holding_style")) {
    sqlite.exec("ALTER TABLE session_strategies ADD COLUMN holding_style TEXT NOT NULL DEFAULT 'multi_day_swing'");
    cols = tableColumnNames(sqlite, "session_strategies");
  }
  if (!cols.has("target_hold_days")) {
    sqlite.exec("ALTER TABLE session_strategies ADD COLUMN target_hold_days REAL");
    cols = tableColumnNames(sqlite, "session_strategies");
  }
  if (!cols.has("max_hold_days")) {
    sqlite.exec("ALTER TABLE session_strategies ADD COLUMN max_hold_days REAL");
    cols = tableColumnNames(sqlite, "session_strategies");
  }
  if (!cols.has("timeframe_notes")) {
    sqlite.exec("ALTER TABLE session_strategies ADD COLUMN timeframe_notes TEXT NOT NULL DEFAULT ''");
  }
}

function shouldResetSchema(sqlite: Database.Database): boolean {
  const existingTables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;

  if (existingTables.length === 0) {
    return false;
  }

  const names = new Set(existingTables.map((row) => row.name));
  return REQUIRED_TABLES.some((table) => !names.has(table));
}

function seedCompatibilityDefaults(sqlite: Database.Database): void {
  // TODO(phase-04/phase-08): Remove this compatibility seed once the Sessions UI fully owns
  // initial session creation and broker setup instead of relying on default-session/default-broker.
  const now = new Date().toISOString();

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO provider_accounts (
        id, name, category, provider_type, secret_ref, metadata_json, is_configured, last_test_status, updated_at
      ) VALUES (?, ?, 'ai', 'anthropic', ?, NULL, 1, 'ok', ?)
      `,
    )
    .run("provider-anthropic", "Anthropic", "provider-anthropic", now);

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO broker_accounts (
        id, name, broker_type, supported_instrument_classes, mode, secret_ref, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run("default-broker", "Default Broker", "mock", '["stock","crypto","futures"]', "paper", "default-broker", now);

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO broker_routing (instrument_class, default_broker_account_id)
      VALUES (?, ?)
      `,
    )
    .run("stock", "default-broker");

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO broker_routing (instrument_class, default_broker_account_id)
      VALUES (?, ?)
      `,
    )
    .run("crypto", "default-broker");

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO broker_routing (instrument_class, default_broker_account_id)
      VALUES (?, ?)
      `,
    )
    .run("futures", "default-broker");

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO workspace_preferences (
        id, global_include_archived, capital_allocation_mode, global_capital_pool_usd, updated_at
      ) VALUES (1, 0, 'per_session_only', NULL, ?)
      `,
    )
    .run(now);

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO sessions (
        id, name, objective, status, is_focused, selection_mode, instrument_classes,
        instrument_scope, default_search_provider_id, capital_limit_usd, execution_mode,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "default-session",
      "Primary Session",
      "Default workspace session",
      "idle",
      1,
      "manual_shortlist",
      '["stock"]',
      "SPY,QQQ",
      null,
      10000,
      "paper_only",
      now,
      now,
    );

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO session_selector_settings (session_id, ai_picker_enabled, updated_at)
      VALUES (?, 1, ?)
      `,
    )
    .run("default-session", now);

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO session_strategies (
        session_id, strategy_profile, max_position_usd, stop_loss_pct, take_profit_pct,
        max_concurrent_trades, research_depth, daily_loss_limit_usd, profit_target_usd,
        max_ai_spend_usd, human_approval_required,
        primary_trading_timeframe, holding_style, target_hold_days, max_hold_days, timeframe_notes
      ) VALUES (?, 'passive_income', 500, 2, 4, 3, 'balanced', 200, 1000, 5, 0, '1d', 'multi_day_swing', NULL, NULL, '')
      `,
    )
    .run("default-session");

  const defaultRoles = [
    "researcher_bull",
    "researcher_bear",
    "reviewer",
    "decision_maker",
    "instrument_selector",
  ];

  for (const role of defaultRoles) {
    // TODO(phase-05/phase-07): Replace the unconfigured placeholder AI roles with
    // real per-role defaults sourced from the session/AI configuration flow.
    sqlite
      .prepare(
        `
        INSERT OR IGNORE INTO session_ai_roles (
          id, session_id, role, provider_key, model_id, temperature,
          max_tokens, web_search_enabled, prompt_source, prompt_markdown, prompt_asset_path
        ) VALUES (?, ?, ?, ?, ?, 0.7, 4096, 0, 'default', '', NULL)
        `,
      )
      .run(`default-session:${role}`, "default-session", role, "provider-anthropic", "claude-sonnet-4-6");
  }

  sqlite
    .prepare(
      `
      INSERT OR IGNORE INTO session_broker_assignments (session_id, broker_account_id)
      VALUES (?, ?)
      `,
    )
    .run("default-session", "default-broker");
}

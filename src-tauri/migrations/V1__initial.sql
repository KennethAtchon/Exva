-- Session configuration (single row, upserted).
CREATE TABLE session_config (
    id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    strategy                TEXT    NOT NULL DEFAULT 'passive_income',
    max_position_usd        REAL    NOT NULL DEFAULT 500,
    stop_loss_pct           REAL    NOT NULL DEFAULT 2.0,
    take_profit_pct         REAL    NOT NULL DEFAULT 4.0,
    max_concurrent_trades   INTEGER NOT NULL DEFAULT 3,
    research_depth          TEXT    NOT NULL DEFAULT 'balanced',
    daily_loss_limit_usd    REAL    NOT NULL DEFAULT 200,
    profit_target_usd       REAL    NOT NULL DEFAULT 1000,
    max_api_spend_usd       REAL    NOT NULL DEFAULT 5.0,
    human_approval_required INTEGER NOT NULL DEFAULT 0,
    updated_at              TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO session_config (id) VALUES (1);

CREATE TABLE trades (
    id                TEXT PRIMARY KEY,
    asset             TEXT NOT NULL,
    side              TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    entry_price       REAL,
    position_size_usd REAL NOT NULL,
    stop_loss_price   REAL,
    take_profit_price REAL,
    strategy          TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('pending', 'open', 'closed', 'rejected')),
    opened_at         TEXT,
    closed_at         TEXT,
    final_pnl_usd     REAL,
    ai_cost_usd       REAL NOT NULL DEFAULT 0,
    confidence_score  REAL,
    broker_order_id   TEXT,
    created_at        TEXT NOT NULL
);

CREATE TABLE agent_runs (
    id            TEXT PRIMARY KEY,
    trade_id      TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    agent_type    TEXT NOT NULL CHECK (agent_type IN (
                      'researcher_bull', 'researcher_bear',
                      'reviewer', 'decision_maker'
                  )),
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd      REAL NOT NULL,
    output_text   TEXT NOT NULL,
    duration_ms   INTEGER NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE events (
    id         TEXT PRIMARY KEY,
    trade_id   TEXT REFERENCES trades(id) ON DELETE SET NULL,
    level      TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    agent_type TEXT,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE adaptations (
    id           TEXT PRIMARY KEY,
    trigger      TEXT NOT NULL,
    old_params   TEXT NOT NULL,
    new_params   TEXT NOT NULL,
    win_rate     REAL NOT NULL,
    trade_count  INTEGER NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE INDEX idx_trades_status      ON trades(status);
CREATE INDEX idx_trades_created_at  ON trades(created_at);
CREATE INDEX idx_agent_runs_trade_id ON agent_runs(trade_id);
CREATE INDEX idx_events_trade_id    ON events(trade_id);
CREATE INDEX idx_events_created_at  ON events(created_at);

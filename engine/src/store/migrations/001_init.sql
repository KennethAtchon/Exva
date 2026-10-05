-- Exva v2 schema. Budget: 12 tables. A new table needs a reason in docs/ARCHITECTURE.md.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  broker TEXT NOT NULL,          -- alpaca | sim
  mode TEXT NOT NULL,            -- paper | sim
  starting_cash REAL,            -- sim accounts only
  created_at INTEGER NOT NULL
);

CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  params TEXT NOT NULL,
  symbols TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  dollars_per_trade REAL NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL,          -- running | stopped
  backtest_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bars (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  feed TEXT NOT NULL,            -- crypto | iex | sip | synthetic
  ts INTEGER NOT NULL,           -- bar start, epoch ms; only closed bars are stored
  o REAL NOT NULL,
  h REAL NOT NULL,
  l REAL NOT NULL,
  c REAL NOT NULL,
  v REAL NOT NULL,
  PRIMARY KEY (symbol, timeframe, feed, ts)
) WITHOUT ROWID;

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  bar_ts INTEGER NOT NULL,       -- close time of the checked bar
  kind TEXT NOT NULL,            -- buy | sell | hold | skip | error
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  vals TEXT NOT NULL,
  order_id TEXT,
  ai_call_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX decisions_one_per_check ON decisions (bot_id, symbol, bar_ts);
CREATE INDEX decisions_bot_time ON decisions (bot_id, bar_ts DESC);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  broker_order_id TEXT,
  bot_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  notional REAL,
  qty REAL,
  ref_ts INTEGER NOT NULL,       -- decision time; the simulator fills at the first bar open at or after it
  status TEXT NOT NULL,
  filled_qty REAL NOT NULL DEFAULT 0,
  avg_fill_price REAL,
  stop_pct REAL,
  target_pct REAL,
  decision_id TEXT,
  reason TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX orders_status ON orders (status);
CREATE INDEX orders_bot ON orders (bot_id, created_at DESC);

CREATE TABLE fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  qty REAL NOT NULL,
  price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);
CREATE INDEX fills_order ON fills (order_id);

CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,          -- open | closed (an open trade is the position)
  qty REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_qty REAL NOT NULL DEFAULT 0,
  exit_price REAL,
  fees REAL NOT NULL DEFAULT 0,
  stop_pct REAL,
  target_pct REAL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  pnl_usd REAL,
  pnl_pct REAL,
  exit_reason TEXT,
  entry_order_id TEXT,
  exit_order_id TEXT
);
CREATE INDEX trades_open ON trades (account_id, symbol, status);
CREATE INDEX trades_bot ON trades (bot_id, opened_at DESC);

CREATE TABLE equity (
  account_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  equity REAL NOT NULL,
  cash REAL NOT NULL,
  PRIMARY KEY (account_id, ts)
) WITHOUT ROWID;

CREATE TABLE backtests (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  spec TEXT NOT NULL,
  metrics TEXT,
  result TEXT,                   -- JSON: trades, equity, fills, decision counts
  error TEXT
);

CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  bot_id TEXT,
  purpose TEXT NOT NULL,         -- analyst | journal | explain | assistant | backtest
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL,
  error TEXT,
  response TEXT
);
CREATE INDEX ai_calls_cache ON ai_calls (purpose, model, prompt_version, context_hash);
CREATE INDEX ai_calls_time ON ai_calls (ts);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,           -- info | warn | error
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
);
CREATE INDEX events_time ON events (ts DESC);

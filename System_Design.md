# Exva — System Design

> **Stack:** Tauri (Rust backend) + React/TypeScript frontend + SQLite
> **Mode:** Local-only, single-user desktop application
> **Date:** 2026-04-21

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Tauri Process                        │
│                                                             │
│  ┌──────────────────┐        ┌────────────────────────────┐ │
│  │  React Frontend  │◄──IPC──►    Rust Core (Commands)    │ │
│  │  (WebView)       │        │                            │ │
│  │                  │        │  ┌──────────────────────┐  │ │
│  │  - Dashboard     │        │  │  Agent Orchestrator   │  │ │
│  │  - Trade Panel   │        │  │  (Tokio async tasks)  │  │ │
│  │  - Strategy Cfg  │        │  └──────────┬───────────┘  │ │
│  │  - Dev Panel     │        │             │              │ │
│  │  - Cost/Usage    │        │  ┌──────────▼───────────┐  │ │
│  └──────────────────┘        │  │  SQLite (rusqlite)    │  │ │
│                              │  └──────────────────────┘  │ │
│                              │                            │ │
│                              │  ┌──────────────────────┐  │ │
│                              │  │  Keychain (OS native) │  │ │
│                              │  └──────────────────────┘  │ │
│                              └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
   Claude API (Anthropic)         Broker API (external)
   Web Search API (external)
```

**IPC boundary:** Frontend never touches the database, keychain, or external APIs directly. Everything flows through Tauri commands (Rust functions exposed to the frontend).

---

## 2. Module Breakdown

### 2.1 Rust Backend Modules

```
src-tauri/src/
├── main.rs                  # Tauri app entry, command registration
├── db/
│   ├── mod.rs               # Connection pool, migrations
│   ├── trades.rs            # Trade CRUD
│   ├── agent_runs.rs        # Agent run CRUD
│   ├── session.rs           # Session config read/write
│   └── schema.sql           # Full DDL (run on first launch)
├── agents/
│   ├── mod.rs               # Agent orchestrator entry
│   ├── orchestrator.rs      # runTradeCycle, manages Tokio tasks
│   ├── researcher.rs        # Bull/bear researcher agent calls
│   ├── reviewer.rs          # Reviewer agent call
│   ├── decision_maker.rs    # Decision maker agent call
│   └── claude_client.rs     # Anthropic SDK wrapper, prompt caching
├── broker/
│   ├── mod.rs               # BrokerAdapter trait
│   ├── alpaca.rs            # Alpaca implementation
│   └── mock.rs              # Paper trading / test stub
├── monitor/
│   └── trade_monitor.rs     # Per-trade polling loop (5s interval)
├── risk/
│   └── risk_engine.rs       # Threshold checks, session halt logic
├── keychain/
│   └── secrets.rs           # OS keychain read/write (keyring crate)
├── session/
│   └── session_manager.rs   # Session state machine (Active/Paused/Stopped)
├── notifications/
│   └── notifier.rs          # System tray alerts
└── commands/
    ├── mod.rs               # Re-exports all Tauri commands
    ├── trade_commands.rs    # start_session, pause, force_close, approve_trade
    ├── config_commands.rs   # save_strategy, get_strategy
    ├── broker_commands.rs   # add_account, test_connection, remove_account
    └── stats_commands.rs    # get_dashboard_stats, get_cost_breakdown
```

### 2.2 Frontend Modules

```
src/
├── main.tsx                 # React entry
├── App.tsx                  # Router, theme provider
├── store/
│   ├── sessionStore.ts      # Zustand: session state, live stats
│   ├── tradeStore.ts        # Active trades, selected trade
│   └── configStore.ts       # Strategy config local state
├── pages/
│   ├── Dashboard.tsx
│   ├── TradeDetail.tsx      # Slide-in panel
│   ├── StrategyConfig.tsx
│   ├── AccountSetup.tsx
│   ├── CostBreakdown.tsx
│   ├── DeveloperPanel.tsx
│   └── Onboarding.tsx       # Multi-step flow
├── components/
│   ├── StatsCard.tsx
│   ├── TradesTable.tsx
│   ├── AgentFeed.tsx        # Real-time event stream
│   ├── TokenUsageBar.tsx
│   ├── ConfirmModal.tsx
│   └── StatusBadge.tsx
├── hooks/
│   ├── useTauriEvent.ts     # Wraps Tauri event listener
│   └── usePolling.ts        # Generic polling hook (5s trades refresh)
└── lib/
    ├── tauri.ts             # Typed wrappers for invoke()
    └── formatters.ts        # Currency, %, timestamp formatters
```

---

## 3. Database Schema

```sql
-- Session configuration (single row, upserted)
CREATE TABLE session_config (
    id                    INTEGER PRIMARY KEY DEFAULT 1,
    strategy              TEXT NOT NULL DEFAULT 'passive_income',
    max_position_usd      REAL NOT NULL DEFAULT 500,
    stop_loss_pct         REAL NOT NULL DEFAULT 2.0,
    take_profit_pct       REAL NOT NULL DEFAULT 4.0,
    max_concurrent_trades INTEGER NOT NULL DEFAULT 3,
    research_depth        TEXT NOT NULL DEFAULT 'balanced',
    daily_loss_limit_usd  REAL NOT NULL DEFAULT 200,
    profit_target_usd     REAL NOT NULL DEFAULT 1000,
    max_api_spend_usd     REAL NOT NULL DEFAULT 5.0,
    human_approval_required INTEGER NOT NULL DEFAULT 0,
    updated_at            TEXT NOT NULL
);

-- Trade records
CREATE TABLE trades (
    id                TEXT PRIMARY KEY,  -- UUID
    asset             TEXT NOT NULL,
    side              TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
    entry_price       REAL,
    position_size_usd REAL NOT NULL,
    stop_loss_price   REAL,
    take_profit_price REAL,
    strategy          TEXT NOT NULL,
    status            TEXT NOT NULL CHECK(status IN ('pending', 'open', 'closed', 'rejected')),
    opened_at         TEXT,
    closed_at         TEXT,
    final_pnl_usd     REAL,
    ai_cost_usd       REAL NOT NULL DEFAULT 0,
    confidence_score  REAL,
    broker_order_id   TEXT,
    created_at        TEXT NOT NULL
);

-- Agent run records (one row per agent per trade cycle)
CREATE TABLE agent_runs (
    id            TEXT PRIMARY KEY,  -- UUID
    trade_id      TEXT NOT NULL REFERENCES trades(id),
    agent_type    TEXT NOT NULL CHECK(agent_type IN (
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

-- System event log (agent activity feed + dev logs)
CREATE TABLE events (
    id         TEXT PRIMARY KEY,
    trade_id   TEXT REFERENCES trades(id),
    level      TEXT NOT NULL CHECK(level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    agent_type TEXT,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Self-adaptation log
CREATE TABLE adaptations (
    id           TEXT PRIMARY KEY,
    trigger      TEXT NOT NULL,  -- e.g. "win_rate_below_40pct"
    old_params   TEXT NOT NULL,  -- JSON snapshot
    new_params   TEXT NOT NULL,  -- JSON snapshot
    win_rate     REAL NOT NULL,
    trade_count  INTEGER NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_created_at ON trades(created_at);
CREATE INDEX idx_agent_runs_trade_id ON agent_runs(trade_id);
CREATE INDEX idx_events_trade_id ON events(trade_id);
CREATE INDEX idx_events_created_at ON events(created_at);
```

---

## 4. Agent Orchestration

### 4.1 Trade Cycle Flow

```
runTradeCycle(asset, config)
│
├── Spawn Tokio tasks in parallel:
│   ├── researcher_bull(asset, config.research_depth)  ─┐
│   └── researcher_bear(asset, config.research_depth)  ─┤
│                                                        │
│   tokio::try_join!(bull_task, bear_task)  ◄────────────┘
│   Timeout: 90s — abort cycle if either exceeds
│
├── reviewer(bull_output, bear_output)
│   Timeout: 60s
│
├── decision_maker(bull, bear, review, config)
│   Timeout: 30s
│   Returns: TradeDecision { action, side, size_pct, confidence, reasoning }
│
├── if action == NoTrade → log skip, return
│
├── if human_approval_required:
│   ├── emit Tauri event "approval_required" → frontend shows modal
│   ├── wait on oneshot channel (max 10 min)
│   └── if timeout → log skip, return
│
└── executeTrade(decision, broker_adapter)
    └── monitorTrade(trade_id) spawned as background Tokio task
```

### 4.2 Claude API Call Pattern

```rust
// Every agent call follows this pattern
async fn call_claude(
    client: &ClaudeClient,
    system_prompt: &str,   // cached
    user_message: &str,
    tools: Option<Vec<Tool>>,
    max_tokens: u32,
) -> Result<AgentOutput>
```

- System prompts use **prompt caching** (cache_control: ephemeral on system blocks)
- Researcher agents get a `web_search` tool definition
- All calls log input tokens, output tokens, cost, duration to `agent_runs`

### 4.3 Concurrency Model

```
SessionManager
│
└── Tokio runtime (multi-thread)
    │
    ├── Trade cycle tasks (max N = config.max_concurrent_trades)
    │   Semaphore enforces limit
    │
    └── Trade monitor tasks (one per open trade, runs until closed)
        5-second polling loop via tokio::time::interval
```

Session state is held in a `Arc<Mutex<SessionState>>` shared across tasks. Risk engine checks run after every trade close and after every monitor tick.

---

## 5. IPC Command Surface

All frontend↔backend communication goes through Tauri commands (`invoke`). Events flow backend→frontend via `emit`.

### Commands (frontend calls these)

| Command | Payload | Returns |
|---|---|---|
| `get_dashboard_stats` | — | `DashboardStats` |
| `get_active_trades` | — | `Vec<Trade>` |
| `get_trade_detail` | `trade_id` | `TradeDetail` (trade + agent runs) |
| `start_session` | — | `SessionStatus` |
| `pause_session` | — | `SessionStatus` |
| `stop_session` | — | `SessionStatus` |
| `force_close_trade` | `trade_id` | `Result` |
| `approve_trade` | `trade_id, approved: bool` | `Result` |
| `save_strategy_config` | `SessionConfig` | `Result` |
| `get_strategy_config` | — | `SessionConfig` |
| `add_broker_account` | `BrokerCredentials` | `ConnectionTestResult` |
| `test_broker_connection` | `account_id` | `ConnectionTestResult` |
| `remove_broker_account` | `account_id` | `Result` |
| `save_api_key` | `key_type, value` | `Result` |
| `get_cost_breakdown` | `date_range` | `CostBreakdown` |
| `get_events` | `filters` | `Vec<Event>` |
| `get_agent_traces` | `trade_id` | `Vec<AgentRun>` |

### Events (backend emits, frontend listens)

| Event | Payload | When |
|---|---|---|
| `trade_opened` | `Trade` | Trade executes |
| `trade_closed` | `Trade` | Trade closes |
| `agent_event` | `Event` | Any agent activity |
| `approval_required` | `TradeDecision` | HITL mode, decision ready |
| `session_stopped` | `reason: string` | Threshold hit |
| `stats_update` | `DashboardStats` | Every 5s when session active |
| `notification` | `title, body, level` | Errors, alerts, adaptations |

---

## 6. Security Model

### Credential Storage

- All secrets (broker API keys, Anthropic key, web search key) stored in **OS keychain** via `keyring` crate
- Never written to SQLite, disk, or logs
- Retrieved from keychain at call time, not held in memory long-term

### Threat Model

| Threat | Mitigation |
|---|---|
| Secrets in logs | Keys never passed to log macros; all logging uses IDs/references only |
| Secrets in DB | Keychain only — SQLite stores no credentials |
| Agent prompt injection via web search results | Web search results are scoped to user content block, not system prompt |
| Malformed agent output causes trade | Decision maker output is parsed/validated before any broker call; malformed → cycle skip |
| Concurrent trade overrun | Tokio semaphore enforces hard cap at `max_concurrent_trades` |
| Runaway API spend | Risk engine checks cumulative cost before each cycle start; halts if over limit |

---

## 7. Risk Engine

Runs after every trade close and every monitor tick.

```
check_session_limits(session_state, config) → Option<StopReason>

Checks (in order):
1. daily_pnl ≤ -config.daily_loss_limit_usd  → StopReason::DailyLossLimit
2. total_pnl ≥ config.profit_target_usd       → StopReason::ProfitTarget
3. daily_api_spend ≥ config.max_api_spend_usd → StopReason::ApiBudget

If any → halt all cycle tasks, emit session_stopped event
Open trades continue to be monitored (not force-closed)
```

### Self-Adaptation Trigger

```
check_adaptation(recent_trades: last 10 closed)
│
├── win_rate = wins / 10
├── if win_rate < 0.40:
│   ├── snapshot current params
│   ├── tighten stop_loss_pct by 0.5%
│   ├── reduce max_position_usd by 10%
│   ├── write adaptation record to DB
│   └── emit notification
└── (v1 only adjusts these two params — no strategy type switch)
```

---

## 8. State Machine: Session

```
         ┌─────────┐
    ─────►  IDLE   │ (no broker configured → Onboarding)
         └────┬────┘
              │ start_session
         ┌────▼────┐
    ┌────► ACTIVE  ◄────┐
    │    └────┬────┘    │
    │         │ pause   │ resume
    │    ┌────▼────┐    │
    │    │ PAUSED  ├────┘
    │    └─────────┘
    │
    │ threshold hit / emergency stop
    │    ┌─────────┐
    └────► STOPPED │
         └─────────┘
```

State stored in `Arc<Mutex<SessionState>>`. Persisted to SQLite on every transition so app restarts correctly.

---

## 9. Data Flow: Dashboard Live Updates

```
Rust monitor loop (5s tick)
    │
    ├── poll broker for open trade prices
    ├── check risk limits
    ├── compute dashboard stats from DB
    └── emit("stats_update", DashboardStats)
             │
             ▼
    Frontend useTauriEvent("stats_update")
             │
             ▼
    Zustand sessionStore.setStats()
             │
             ▼
    React re-render (StatsCards, TradesTable)
```

Agent activity feed uses the same pattern via `emit("agent_event", ...)` — fired from orchestrator as each agent step completes.

---

## 10. Broker Adapter Pattern

```rust
#[async_trait]
pub trait BrokerAdapter: Send + Sync {
    async fn test_connection(&self) -> Result<ConnectionResult>;
    async fn get_account_balance(&self) -> Result<f64>;
    async fn place_order(&self, order: OrderRequest) -> Result<OrderResult>;
    async fn close_order(&self, order_id: &str) -> Result<CloseResult>;
    async fn get_order_status(&self, order_id: &str) -> Result<OrderStatus>;
}

// Runtime dispatch via Box<dyn BrokerAdapter>
// Stored in Arc<> and shared to orchestrator + monitor tasks
```

New broker = new struct implementing this trait. No other code changes.

---

## 11. Packaging & Distribution

| Concern | Approach |
|---|---|
| SQLite location | `$APPDATA/exva/exva.db` (Tauri path resolver) |
| DB migrations | `refinery` crate — runs on startup, versioned SQL files |
| App updates | Tauri updater (checks GitHub releases) |
| Bundle size | ~5–15MB (no bundled browser) |
| macOS notarization | Required for Keychain access — Tauri handles signing config |
| Crash logs | Written to Tauri log dir, never uploaded |

---

## 12. Open Questions (from Product Spec)

| # | Question | Blocks |
|---|---|---|
| 1 | Which brokers supported at launch? | `broker/` module scope |
| 4 | Which web search API? (Brave/Tavily) | `researcher.rs` tool implementation |
| 5 | Self-adaptation exact mechanism? | v1 = stop-loss/position size only (see §7) — confirm |
| 8 | What happens to open trades on app close? | Monitor task persistence strategy |
| 10 | Asset selection logic? | `orchestrator.rs` cycle entry point |

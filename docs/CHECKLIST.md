# Exva — Build Checklist

Snapshot of what's complete and what's still stubbed. Cross-reference with [`System_Design.md`](./System_Design.md).

Legend: ✅ done · 🟡 scaffolded (signature in place, body is `TODO`) · ⬜ not started

---

## Repo / tooling

- ✅ Tauri 2 + Vite + React 18 + TypeScript scaffold at repo root
- ✅ `package.json` scripts: `dev`, `build`, `start` (`tauri dev`), `bundle`
- ✅ `tsconfig.json` with `@/*` path alias to `src/*`
- ✅ `vite.config.ts` configured for Tauri (port 1420, HMR)
- ✅ `.gitignore` covers `node_modules`, `dist`, `src-tauri/target`, env files
- ✅ Cargo workspace builds clean (`cargo check` green)
- ✅ TypeScript strict mode, `tsc --noEmit` green

---

## Frontend (`src/`)

### Plumbing
- ✅ Typed Tauri wrapper `src/lib/tauri.ts` (every command, every event)
- ✅ Tauri-detection fallback to mock data (UI runs in plain browser)
- ✅ Shared types `src/lib/types.ts` mirroring Rust serde structs
- ✅ Formatters (`fmt.usd`, `fmt.pct`, `fmt.pnl`, `fmt.tokens`, `fmt.uptime`, …)
- ✅ Zustand stores: `sessionStore`, `tradeStore`, `configStore`
- ✅ Hooks: `useTauriEvent`, `usePolling`

### Pages (System_Design §2.2)
- ✅ Dashboard — stat strip, trades panel, live agent feed
- ✅ Trades — summary cards + filterable history table
- ✅ TradeDetail — slide-in panel with P&L hero, stop/target rail, agent traces, force-close
- ✅ StrategyConfig — sliders, segmented controls, toggle, save
- ✅ CostBreakdown — donut, by-agent, by-trade, 7-day chart, projections
- ✅ DevPanel — filterable event log + selected-event detail
- ✅ AccountsPage — Anthropic + Alpaca + WebSearch + security panel
- ⬜ Onboarding flow (multi-step) — listed in §2.2 but not implemented

### Components
- ✅ TopNav (logo, nav items, session pill, start/pause/stop)
- ✅ Atoms: `Badge`, `Dot`, `Divider`, `Card`, `PageShell`, `SectionTitle`, `AgentLabel`, `LevelDot`

---

## Backend (`src-tauri/`)

### Persistence (System_Design §3)
- ✅ `Database` w/ r2d2 connection pool + WAL + foreign keys ON
- ✅ `refinery` migration runner; `V1__initial.sql` covers all 5 tables + indexes
- ✅ Trade CRUD (`db/trades.rs`)
- ✅ Agent run CRUD (`db/agent_runs.rs`)
- ✅ Event insert + filtered query (`db/events.rs`) — supports min level / agent / search / limit
- ✅ Session config get/save (`db/session.rs`)
- ✅ Stats roll-ups (`db/stats.rs`) — dashboard, cost-by-agent, cost-by-trade, 7-day history

### Tauri commands (System_Design §5)
- ✅ `get_dashboard_stats`
- ✅ `get_cost_breakdown`
- ✅ `get_active_trades`
- ✅ `get_trade_detail`
- ✅ `force_close_trade`
- 🟡 `approve_trade` — signature in place, doesn't yet route to oneshot
- ✅ `start_session` / `pause_session` / `stop_session`
- ✅ `get_strategy_config` / `save_strategy_config`
- ✅ `add_broker_account` (writes to keychain, swaps adapter on success)
- ✅ `test_broker_connection`
- ✅ `remove_broker_account`
- ✅ `save_api_key` (anthropic / brave / tavily)
- ✅ `get_events`
- ✅ `get_agent_traces`

### Events emitted (System_Design §5)
- ✅ `notification`, `session_stopped`, `session_started`
- 🟡 `trade_opened`, `trade_closed` — defined; orchestrator/monitor not yet emitting on real cycles
- 🟡 `agent_event`, `stats_update`, `approval_required` — wired to emit, fire only when orchestrator runs

### Session manager (§8)
- ✅ State machine (Idle / Active / Paused / Stopped)
- ✅ `Arc<RwLock<SessionState>>` shared
- ✅ Uptime + portfolio-value snapshots feed dashboard stats
- ⬜ Resume from disk on app restart (status persistence)

### Risk engine (§7)
- ✅ `check_limits` — daily loss, profit target, API budget
- ✅ `adapt_if_poor_performance` — tighten stop-loss + shrink position when win rate < 40% over last 10
- ⬜ Wired into post-trade-close path (currently callable but not auto-invoked)

### Broker adapter (§10)
- ✅ `BrokerAdapter` trait (`async_trait`)
- ✅ `MockBroker` — default until creds saved
- 🟡 `AlpacaBroker` — struct, base-url switch (paper/live), `reqwest::Client`. All five methods return `not yet implemented`.

### Keychain (§6)
- ✅ `keychain::set_secret/get_secret/delete_secret` via `keyring` crate
- ✅ Slot constants for Anthropic, Alpaca (key/secret/mode), Brave, Tavily
- ✅ Secrets never written to SQLite or logs

### Agents (§4)
- ✅ Module split: `claude_client`, `researcher`, `reviewer`, `decision_maker`, `orchestrator`
- ✅ System prompts as separate `prompts/*.md` files (researcher_bull, researcher_bear, reviewer, decision_maker)
- ✅ Orchestrator sequence wired (parallel bull/bear → reviewer → decision_maker, with the §4.1 timeouts)
- 🟡 `ClaudeClient::call` — signature in place; no HTTP, no token metering, no prompt caching yet
- 🟡 `decision_maker::run` — calls Claude, returns hardcoded `NoTrade` until JSON parsing wired
- ⬜ `researcher` web-search tool definition + injection-safe routing (results to user content only)
- ⬜ Asset selection logic (open question §12 #10)
- ⬜ HITL approval oneshot channel
- ⬜ `agent_runs` row insert per call (sink exists in DB; orchestrator doesn't write yet)

### Monitor (§9)
- 🟡 `TradeMonitor::run` — 5s polling loop scaffolded, currently only flips status to Closed when broker reports closed; doesn't yet update prices or compute unrealized P&L
- ⬜ `stats_update` emit on each tick
- ⬜ Persistence strategy for open trades on app close (open question §12 #8)

### Notifications
- ✅ `notify(handle, title, body, level)` emits `notification` event for UI toast

### Errors
- ✅ Unified `AppError` w/ `From` for rusqlite, r2d2, refinery, keyring, reqwest, serde, anyhow
- ✅ Serializes to plain string for Tauri command return

---

## Open questions from spec (§12)

| # | Question | Status |
|---|---|---|
| 1 | Brokers at launch | scoped to Alpaca; trait ready for more |
| 4 | Web search provider (Brave / Tavily) | both keychain slots reserved; not yet called |
| 5 | Self-adaptation mechanism | implemented per §7 (stop-loss + position size only) |
| 8 | Open trades on app close | not handled yet |
| 10 | Asset selection logic | not implemented — orchestrator currently takes asset as param |

---

## Next steps (priority order)

1. **Wire `ClaudeClient::call`** — real HTTP, prompt caching, token + cost metering, persist `agent_runs`.
2. **Implement `AlpacaBroker`** — `/v2/account`, `/v2/orders`, `/v2/positions`.
3. **Orchestrator → DB** — write `agent_runs`, `trades` rows; emit `agent_event`, `trade_opened`.
4. **Spawn `TradeMonitor`** when a trade opens; emit `stats_update` + close on stop/target.
5. **HITL approval** — oneshot channel + `approve_trade` command routing.
6. **Asset picker** — strategy-aware loop that calls `run_trade_cycle(asset)` repeatedly.
7. **Session persistence** — write status transitions to SQLite; restore on boot.
8. **Onboarding flow** — multi-step wizard for first-time setup.

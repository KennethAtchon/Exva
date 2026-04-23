# Exva — Build Checklist

Snapshot of what's complete and what's still stubbed. Cross-reference with [`System_Design.md`](./System_Design.md).

Legend: ✅ done · 🟡 scaffolded (signature in place, body is `TODO`) · ⬜ not started

---

## Repo / tooling

- ✅ Electron Forge + Vite + React 18 + TypeScript scaffold at repo root
- ✅ `package.json` scripts: `dev`, `start`, `package`, `make`, `typecheck`
- ✅ `tsconfig.json` with `@/*` path alias to `src/*`
- ✅ Vite configs for main, preload, and renderer
- ✅ `.gitignore` covers `node_modules`, `dist`, Electron output, env files
- ✅ TypeScript strict mode, `tsc --noEmit` green

---

## Frontend (`src/`)

### Plumbing
- ✅ Typed Exva wrapper `src/lib/exva.ts` (every command, every event)
- ✅ Electron-preload detection fallback to mock data (UI runs in plain browser)
- ✅ Shared types `src/lib/types.ts` used by main and renderer
- ✅ Formatters (`fmt.usd`, `fmt.pct`, `fmt.pnl`, `fmt.tokens`, `fmt.uptime`, …)
- ✅ Zustand stores: `sessionStore`, `tradeStore`, `configStore`
- ✅ Hooks: `useExvaEvent`, `usePolling`

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

## Backend (`electron/`)

### Persistence (System_Design §3)
- ✅ `better-sqlite3` client with WAL + foreign keys ON
- ✅ Electron startup migration runner covers core tables + indexes
- ✅ Trade repository
- ✅ Agent run repository
- ✅ Event repository — supports min level / agent / search / limit
- ✅ Session config and persisted session-state repository
- ✅ Stats roll-ups — dashboard, cost-by-agent, cost-by-trade, 7-day history

### Electron IPC (System_Design §9)
- ✅ Dashboard, trades, session, config, accounts, and events channels
- ✅ Preload exposes one narrow `window.exva` method per operation
- ✅ Payload validation in preload and main with Zod
- ✅ Approval routing into the orchestrator

### Events emitted (System_Design §5)
- ✅ `notification`, `session_stopped`, `session_started`
- 🟡 `trade_opened`, `trade_closed` — defined; orchestrator/monitor not yet emitting on real cycles
- 🟡 `agent_event`, `stats_update`, `approval_required` — wired to emit, fire only when orchestrator runs

### Session manager (§8)
- ✅ State machine (Idle / Active / Paused / Stopped)
- ✅ Session state owned by Electron main process and persisted to SQLite
- ✅ Uptime + portfolio-value snapshots feed dashboard stats
- ✅ Active sessions restore as paused on app restart

### Risk engine (§7)
- ✅ Preflight checks — broker, AI key, daily loss, profit target, API budget
- ✅ Decision checks — concurrent trades, position cap, confidence threshold
- ⬜ Self-adaptation after poor performance

### Broker adapter (§10)
- ✅ `BrokerAdapter` TypeScript interface
- ✅ `MockBroker` — default until creds saved
- ✅ `AlpacaAdapter` — account test, market snapshot, order, close, and status calls isolated behind adapter

### Keychain (§6)
- ✅ `SecretsService` via `keytar`
- ✅ Slot constants for Anthropic, Alpaca (key/secret/mode), Brave, Tavily
- ✅ Secrets never written to SQLite or logs

### Agents (§4)
- ✅ Module split: `ai-sdk-service`, `agent-orchestrator`, typed decision schemas
- ✅ Orchestrator sequence wired (bull/bear → reviewer → decision maker)
- ✅ Vercel AI SDK calls direct Anthropic provider
- ✅ Decision maker returns Zod-validated structured output
- ⬜ `researcher` web-search tool definition + injection-safe routing (results to user content only)
- 🟡 Asset selection logic — static watchlist for v1
- ✅ HITL approval promise routing
- ✅ `agent_runs` rows inserted per call

### Monitor (§9)
- 🟡 `TradeMonitor` — 5s polling loop closes trades when broker reports closed; unrealized P&L still TODO
- ✅ `stats_update` emit on each tick
- ⬜ Persistence strategy for open trades on app close (open question §12 #8)

### Notifications
- ✅ `NotificationService` emits `notification` event and OS notifications when supported

### Errors
- ✅ Unified `AppError` with safe IPC normalization
- ✅ Handler logs detailed errors while renderer receives user-safe messages

---

## Open questions from spec (§12)

| # | Question | Status |
|---|---|---|
| 1 | Brokers at launch | scoped to Alpaca; trait ready for more |
| 4 | Web search provider (Brave / Tavily) | both keychain slots reserved; not yet called |
| 5 | Self-adaptation mechanism | not yet ported |
| 8 | Open trades on app close | persisted; monitor resumes while app is running |
| 10 | Asset selection logic | static watchlist for now |

---

## Next steps (priority order)

1. Add focused tests around risk rejection, approval timeout, and force-close behavior.
2. Add web-search and market-data tools to `AiSdkService`.
3. Expand asset selection beyond the static watchlist.
4. Add self-adaptation after closed-trade batches.
5. Add onboarding for first-time key and paper-trading setup.

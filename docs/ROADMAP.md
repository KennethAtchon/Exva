# Roadmap

The redesign's full rationale is in git history: `git show b6d30fd:docs/REDESIGN.md`.

Each phase ends with a check **you** perform on your own computer, not just "tests pass". Code
items marked done are implemented and covered by `bun run verify` and `bun run test:e2e`. The
checks marked ☐ need real Alpaca paper keys and your eyes; the build environment has no access to
Alpaca or DeepSeek.

## Phase 0: Reset ✔

- [x] Remove the v1 tree (kept in history at commit `b6d30fd`).
- [x] Single-package workspace: `engine/`, `ui/`, `desktop/`, `shared/`, strict TypeScript, Biome, `bun test`.
- [x] `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`, this roadmap.
- [x] `bun run verify` = typecheck + lint + tests + size budgets + UI build; GitHub Actions runs it.
- [ ] Tag the old version yourself: `git tag v1-final b6d30fd && git push origin v1-final`.

## Phase 1: First trade ✔ code, ☐ your check

- [x] Store, Alpaca paper broker, Alpaca market data, BarStore (closed bars, upserts, integer timestamps).
- [x] Runner + scheduler + Decisions + reason codes + guards + sizing + exits.
- [x] Heartbeat strategy, Simulator, order sync, position reconcile, restart recovery, sleep gaps.
- [x] CLI: `run`, `status`, `decisions`, `trades`, `doctor`, `paper-smoke`, account and bot commands.
- [x] Regression test: a filled entry order leaves the position open (v1's lost-trade bug).
- [x] Review hardening (`engine/test/safety.test.ts`): positions sold outside Exva, stock splits, stuck
  and vanished orders, guards that count working orders, account locks, independent bot checks,
  safe bot edits/stops/deletes.
- ☐ **Your check:**
  1. `bun run exva account add-alpaca --key … --secret …`, then `bun run exva doctor` → all ✓.
  2. `bun run exva paper-smoke` → a $10 BTC/USD round trip, visible on app.alpaca.markets with the same client order ids.
  3. Start a Heartbeat bot in the evening and leave it for an hour → at least 5 round trips in `bun run exva trades`.
  4. Kill the engine while it holds a position and restart → no duplicate orders, no orphaned position.

## Phase 2: Strategies and backtester ✔ code, ☐ your check

- [x] Indicators; EMA Crossover, RSI Dip Buyer, Donchian Breakout.
- [x] Backtests through the same Runner (simulated clock, historical feed, Simulator, in-memory DB); metrics.
- [x] No-look-ahead test, live-vs-backtest parity test, hand-checked fills and P&L.
- [x] Trade smoke in `verify`: Heartbeat makes exactly 143 round trips per simulated day.
- ☐ **Your check:**
  1. `bun run exva backtest ema-cross BTC/USD 15m --days 90` → trade list, $ P&L, trades per day. Spot-check two trades on a chart.
  2. Run Crypto Trend overnight → in the morning, one decision per bar per symbol, at least 1 trade, readable reasons for every hold.

## Phase 3: Desktop app ✔ code, ☐ your check

- [x] Engine API (30 endpoints, token + Host checks) and event stream.
- [x] Electron shell: engine spawn/attach/restart, window, tray, launch at login, keep-awake, notifications.
- [x] UI: status bar with kill switch, Home, Bots, New-bot wizard with 30-day preview, Bot detail (chart, why-no-trades, activity, Explain), Trades, Settings, onboarding.
- [x] Playwright tests against the engine in demo mode.
- ☐ **Your check:**
  1. `bun run start` → onboarding → test bot → first fill in the UI within ~10 minutes.
  2. Start Crypto Trend, close the window, go to sleep.
  3. In the morning: green tray dot, overnight trades and P&L on Home, sleep gaps (if any) listed.

## Phase 4: Lab ✔ code, ☐ your check

- [x] Lab: form, results (stats, equity + drawdown, chart with fills, decision counts, trades), history, compare two runs.
- [x] Preview in the wizard; create or update a bot from a run; the bot links back to its run.
- ☐ **Your check:** run 3 backtests of RSI Dip Buyer with different buy levels, compare them, and click **Update a bot** on the best. The bot's settings must match the run exactly.

## Phase 5: AI ✔ code, ☐ your check

- [x] DeepSeek V4.1 Flash client: validated JSON with one repair, cost logging, persisted daily budget.
- [x] AI Analyst strategy with a "Trading style" field; `low_confidence` and `ai_failed` reason codes.
- [x] Explain, morning Journal (with a no-AI fallback), capped and cached AI backtests, read-only Assistant with proposal buttons.
- ☐ **Your check:** an AI Analyst bot on 5 symbols runs a full market day plus a crypto night with zero bot crashes; every AI decision shows its reasoning; spend stays under budget; the journal arrives in the morning.

## Phase 6: Soak and graduate ☐

- [ ] Run 3–5 bots continuously for 2 weeks. Fix what breaks.
- [ ] If exits prove too slow, add limit orders and broker-side protective stops.
- [ ] Package a signed macOS `.app` (electron-builder) so you don't need a terminal.
- **Exit check:** 14 days with trades every day, no unhandled exceptions, engine up ≥ 99% while the machine is awake, every no-trade day explained by the summary card without opening logs.

Only after Phase 6 does anything from the parking lot get a proposal.

## Parking lot (not before Phase 6)

Each needs a one-page proposal that fits the glossary and keeps `verify` green. Most plug in as a new
Strategy or a new Broker.

- Live trading (its own plan: confirmations, live-only guards, a separate account type).
- Short selling, extended hours, limit/bracket/trailing orders, daily bars.
- More venues: Polymarket, Kalshi, Kraken, Coinbase, Tradier. Options. Futures (needs a real Tradovate partner integration).
- News, filings or social data as AI context (never as a separate event bus).
- Universe screener, parameter sweeps, walk-forward analysis, portfolio-level backtests.
- Several bots on one symbol via sub-account attribution.
- OS keychain for secrets, phone notifications, cloud backup.

**Will not come back:** session templates, presets, experience catalogs, signal buses, multi-phase
AI pipelines, approval queues, certification runs, autopsies, promotion ladders, in-app docs sites.

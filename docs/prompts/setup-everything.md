You are the Exva setup operator. Build and start the paper session matrix below, then get at least one order filled. Bad trades are fine. Zero trades is failure.

Use your tools only. Do not ask me to run commands.

## Safety

- Workspace stays `paper`. Every session `paper_only`. Never `live_allowed`, never a live broker account.
- Never route futures to Alpaca. Never route to Tradovate (adapter is quarantined; every call throws).
- Never route prediction markets anywhere but the Polymarket paper account.
- Do not disengage the kill switch, reset balances, flatten positions, or raise loss/drawdown/AI-spend limits.
- Never force-stop a session with open trades.
- Propose all mutations in one table and wait for my confirmation.
- Never claim a call succeeded before its result returns.

## Phase 1: inventory

Read and report:

1. `list_experiences` — the full catalog. Expect seven: `paper-execution-canary`, `edgar-catalyst`, `rules-mean-reversion`, `rules-breakout`, `rules-trend-following`, `options-flow-edge`, `prediction-event-edge`. If a new one appears, add a role for it.
2. `list_sessions` + `get_session_status` — id, name, objective, status, experience, execution mode, broker, allocation, open trades.
3. `list_brokers` + `get_broker_routing` — mode, supported classes, free capital, session cap. If free capital or session cap is not exposed to you, say `not exposed` and keep the affected role blocked rather than guessing.
4. `get_data_coverage` for every pair the matrix schedules: SPY 1h, QQQ 1h, BTC-USD 4h, GC 4h, CL 4h, AAPL 1d, NVDA 1d.
5. `list_signal_sources` + `get_signal_readiness` — especially `source/edgar_8k` and `source/prediction_event`.
6. `get_provider_health` — default model, circuit state, spend vs limit.
7. `list_active_trades`, `list_dead_letters`, `list_events` — open positions, symbol conflicts, recent errors.

Reuse before creating. Rename equivalents onto the canonical roles; do not create a second copy. `STRESS-02`, `STRESS-03`, and any `ETF-REVERSION-CONTENDER` get stopped and archived, not renamed.

| Legacy | Canonical |
| ------ | --------- |
| `STRESS-01`, `EDGAR-FANOUT-PRIMARY` | `EDGAR-CATALYST-PRIMARY` |
| `STRESS-04` | `ETF-REVERSION-PRIMARY` |
| `STRESS-06` | `CRYPTO-BREAKOUT-24X7` |
| `STRESS-POLY`, `STRESS-PM-01`, `POLYMARKET-DISCOVERY-RESOLUTION` | `POLYMARKET-EVENT-PRIMARY` |
| `FUTURES-TREND-4H-LIFECYCLE` | `FUTURES-INTEGRATION-SENTINEL` |
| `OPTIONS-FLOW-MULTILEG-LIFECYCLE` | `OPTIONS-INTEGRATION-SENTINEL` |
| `STRESS-02`, `STRESS-03`, `STRESS-05` | Stop and archive |

## Phase 2: matrix

Seven roles. `create_session` auto-provisions each experience's default input; do not hand-build inputs.

| Name | Experience | Broker | Class / universe | Start |
| ---- | ---------- | ------ | ---------------- | ----- |
| `PAPER-EXECUTION-CANARY` | `paper-execution-canary` | Alpaca paper | stock; SPY | Manual arm, regular hours |
| `ETF-REVERSION-PRIMARY` | `rules-mean-reversion` | Alpaca paper | stock; SPY, QQQ | After history gate |
| `CRYPTO-BREAKOUT-24X7` | `rules-breakout` | Alpaca paper | crypto; BTC-USD | After history gate |
| `EDGAR-CATALYST-PRIMARY` | `edgar-catalyst` | Alpaca paper | stock; filing tickers | After source healthy |
| `POLYMARKET-EVENT-PRIMARY` | `prediction-event-edge` | Polymarket paper | prediction_market; live market ids | After source healthy |
| `OPTIONS-INTEGRATION-SENTINEL` | `options-flow-edge` | Tradier, else options-enabled Alpaca | options; AAPL/NVDA → OCC | Only if broker exposes option chains |
| `FUTURES-INTEGRATION-SENTINEL` | `rules-trend-following` | Mock paper | futures; GC, CL | Created, left stopped |

Objectives, verbatim:

- `PAPER-EXECUTION-CANARY` — `Certify the Exva-to-Alpaca paper order path with a single $10 SPY round trip, proving durable order intents, correlated client and broker order IDs, partial-fill persistence, exit sizing from actual filled quantity, and flat reconciliation. Infrastructure proof only; excluded from alpha metrics.`
- `ETF-REVERSION-PRIMARY` — `Scan the seeded SPY and QQQ universe for deterministic mean-reversion entries in paper mode, validating NYSE calendar gating, OHLCV freshness and depth, rule evaluation, risk gating, and Alpaca routing.`
- `CRYPTO-BREAKOUT-24X7` — `Scan BTC-USD continuously for deterministic resistance breakouts in paper mode, validating always-open scheduling, 4h OHLCV depth and freshness, breakout rules, risk gating, and Alpaca crypto routing.`
- `EDGAR-CATALYST-PRIMARY` — `Evaluate eligible 8-K filings for catalyst-driven stock opportunities in paper mode, tracing one complete path from EDGAR polling through tradability and materiality gating, filing-identity preservation, AI analysis, risk gating, and Alpaca order handling.`
- `POLYMARKET-EVENT-PRIMARY` — `Discover only live Polymarket instruments, evaluate evidence-based probability dislocations in paper mode, and trace valid market IDs through startup-event catch-up, ghost fills, persisted positions, and resolution-aware settlement.`
- `OPTIONS-INTEGRATION-SENTINEL` — `Scan AAPL and NVDA for unusual options activity in paper mode and verify the forward-paper handoff from underlying flow to option-chain snapshot, OCC contract selection, defined-risk vertical construction, options-class sizing, multi-leg routing, position persistence, and close handling.`
- `FUTURES-INTEGRATION-SENTINEL` — `Hold the futures instrument-class lane visible as a simulated sentinel: exercise 4h futures OHLCV, futures-class signal delivery, risk gating, Mock routing, and Exva trade-record persistence, while remaining explicitly blocked on any real futures venue.`

Every catalog experience needs a row. Sentinels stay in the list even when blocked — record the exact blocker, never delete the row and never fake the config to look green.

## Phase 3: get a fill

In order. Stop at the first step that produces fills.

**3.1 Certify.** `run_paper_certification` on `PAPER-EXECUTION-CANARY` against the Alpaca paper account. Poll `get_paper_certification` to terminal state and report run id, both client order ids, both broker order ids, filled quantity, status. Regular hours only; one run per broker account per UTC day. If it rejects, the rejection code is the finding — report it and continue, but do not call setup successful.

**3.2 Feed the lanes.** Session start and each scheduled scan auto-provision history via `HistoryProvisioningService` when stored bars are below the strategy contract. Do not run CLI backfill scripts. If a lane still reports `insufficient_bars` / `input_insufficient_history` after activation, the provider or broker route failed — fix that, then restart the session. A blind lane is not a selective lane.

**3.3 Loosen, one lane at a time.** Only after 3.2, only on `paper_only` sessions, one change per proposal with before/after values:

- `save_trade_rules` / `update_strategy_config` — entry thresholds toward more signals.
- `save_timeframe_config` — faster cadence, never below the strategy's minimum.
- `save_ai_settings` / `save_selector_settings` — AI selectivity on the EDGAR and Polymarket lanes.
- `save_risk_config` — position size **down** only, to fit more lanes in the envelope.

**3.4 Never.** Live mode, kill switch off, higher loss/drawdown/spend caps, disabled calendar or freshness or bar-count gates, disabled symbol locks. A Mock futures fill and a broker `options` capability flag are not venue proof.

## Launch gates

Before starting a role, confirm via `get_session_status`, `get_signal_readiness`, `get_data_coverage`, `list_events`. Any of these blocks the start:

- WARN event `Default input provisioning failed`, or a missing/wrong input subscription.
- Event subscription with no enabled, running, recently healthy source.
- `input_source_dead` or `calendar_misconfigured`.
- Stored bars below required bar count.
- Missing broker route, unsupported class, invalid allocation, non-paper execution mode.
- Open AI circuit on a role the session needs.

`market_closed` outside NYSE hours is correct for the canary, ETF, and options lanes — not a failure. A quiet healthy event source is not a dead poller.

## Reading no-trade

`get_scan_funnel` per session. Only `signal` and `no_setup` mean the strategy evaluated. `insufficient_bars`, `input_stale`, `bars_failed`, `evaluate_failed`, `empty_universe` mean the lane never got to decide — data or config defect, not a market opinion. `firstBlocked` names it.

`get_opportunity_rate` per session per day. Low setup rate with high `blockedByHistoryRate` means starved, not selective. High `repeatEvaluations` means re-looks at the same bar window, not fresh chances.

## Allocation

- Total Alpaca allocation ≤ 60% of reported free paper capital. No single session > 10%.
- Polymarket, Mock, and Tradier allocations are separate; each capped at 10% of that account's free capital.
- Never exceed free capital or session cap. A rejection is evidence — report it, do not route around it.
- Start order under capacity pressure: canary, ETF, crypto, EDGAR, Polymarket, options. Futures sentinel stays stopped.

## Phase 4: propose, confirm, launch

One table before any mutation: role, reuse/rename/create, session id, objective, experience, class and universe, stored bars vs required, broker, allocation, expected start state, coverage status (`ready` / `partial` / `blocked`) and blocker.

After I confirm: apply in one batch, verify each role's effective config, enable only the required sources, check gates, then start all valid roles back to back. Do not wait for a trade before starting the next role. If one start fails, keep its exact error and continue.

## Report

- **Fills** — certification run and ids, plus any strategy-lane fills. If zero orders executed, that is the first line, with the exact blocker.
- **Matrix** — name, id, objective, experience, status, input, source/schedule health, broker, allocation.
- **Coverage** — every catalog experience and its session id; `stock`, `crypto`, `futures`, `options`, `prediction_market` as proven/partial/blocked with the concrete symbols or contracts that justify it; SPY, QQQ, BTC-USD, GC, CL, AAPL, NVDA each accounted for.
- **History** — stored vs required bars per pair after auto-provision on start/scan.
- **Funnel** — first scan's outcome counts and `firstBlocked` per started scheduled lane.
- **Tuning** — every change, before/after, and the session.
- **Expected waits** — which lanes are correctly `market_closed` or waiting on a quiet source.
- **Failures** — each role that failed to create, verify, or start, with its exact error.
- **Safety** — workspace stayed `paper`, every session `paper_only`, no live route touched, nothing in 3.4 modified.

Stop after the report. Do not soak or monitor — that is `stress-test-monitor.md`.

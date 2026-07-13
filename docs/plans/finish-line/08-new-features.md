# 08 — New Features (operator power tools)

> **Date:** 2026-07-12 · **Status:** Code complete 2026-07-13 · **Depends on:** 07 (hubs exist), 04 (headless/sinks), 03/05/06 for data they surface
> **Goal:** Seven genuinely new capabilities that make a single-operator system pleasant and fast. Each is a complete vertical (backend + IPC + UI + docs + tests). None is optional; none ships half.

> **PROGRESS (2026-07-13):** T1–T7 implemented end-to-end in code (`bun run check` + `bun run prove` green). Migration `0013_operator_power_tools` adds `briefings` + `equity_snapshots`. Operator IPC registrar wired; hubs mount real surfaces (palette, Backtest Lab, Data Doctor, briefing, equity curve, what-if, kill-switch).
>
> **Ken blockers (eye / multi-day — do not fake):**
>
> 1. Daily-DB eye verify: ⌘K actions + search on real data; Backtest Lab hash match vs a scripted run; Data Doctor poke-gap + backfill on a scratch copy of daily DB; equity curve with accumulating snapshots; what-if on a real closed trade; kill-switch pause-all / flatten against a running mock session (screen recording or step log).
> 2. Morning briefing: generate 3 consecutive mornings headless and confirm phone delivery (ntfy/Telegram sinks). Cannot claim phone evidence from this session.
> 3. Screenshots of every new surface reviewed by Ken.

## T1 — Command palette (⌘K)

Global palette in the renderer: fuzzy actions + navigation + entity search in one box.

- **Actions**: start/pause/stop session, approve pending trade, run backtest, inject debug signal (dev), toggle paper/live readiness, create session from preset, trigger test alarm, open backup folder.
- **Search**: sessions by name, trades by symbol/id, markets/instruments, docs pages, settings sections. Backed by one new IPC endpoint `palette:query(q)` that fans out to existing repos (no new index; SQLite LIKE + recency ranking is enough at this scale).
- Implementation: headless combobox (existing component library idioms), `cmd+k` binding, action registry typed as `{ id, title, keywords, scope, run() }` so later docs register actions in one place. Every destructive action confirms inline (palette shows "Enter to confirm").

## T2 — Backtest Lab (Research hub)

Run and compare backtests from the UI instead of scripts.

- Form: experience/strategy, symbols (or instrument set), timeframe, window, folds, cost model (prefilled from research contract) → `backtest:run` IPC → progress events (existing event bus → renderer stream) → results panel: per-fold expectancy CI, Sharpe LB, max DD, trade count, cost drag, equity curve per fold.
- Compare view: pick 2+ `backtest_runs`, aligned metric table + overlaid equity curves. Determinism badge: re-run spec hash matches stored run hash.
- **Threshold sweep** (the power tool): vary one contract parameter across a range → small-multiples grid of fold results, with the trial count recorded into `experience_experiments` so false-discovery accounting sees every sweep (anti-cherry-picking rule from 50→100 risk 4 — sweeps are visible, not secret).

## T3 — Data Doctor (Signals & Schedules hub)

The bars catastrophe, made impossible to miss.

- Coverage matrix: symbols × timeframes, colored by freshness (`data_coverage` lag vs expectation), gap detection (missing bars inside claimed coverage — SQL window scan).
- One-click backfill: per cell or per provider → ingest job with progress; failures surface as supervisor alarms.
- Provider health: last successful fetch, error rate (from `api_call_log`/provider call log), per-provider toggle.
- Auto-check: nightly job runs gap detection; gaps → notification. This closes the "data outage masquerading as no-setup" class permanently, on top of doc 04's alarms.

## T4 — Morning briefing

Nightly-generated operator digest (runs headless, 08:00 delivery via configured sinks + rendered in Dashboard).

- Content (deterministic assembly, LLM only for the 3-sentence narrative summary at the top): yesterday's P&L + open positions, trades opened/closed with one-line reasons, ladder movements, calibration drift notes, upcoming calendar events for held symbols, supervisor alarms, AI spend vs budget, data-coverage status.
- Persisted as `briefings(date PK, doc JSON, narrative)` so the Dashboard shows history; Telegram/ntfy get the narrative + headline numbers with a deep-link-ish "open Exva" footer.

## T5 — Portfolio equity curve + P&L attribution

- Snapshot job (hourly + on trade close): `equity_snapshots(ts, total, per_account JSON, per_experience JSON)` from broker balances + open-position marks + paper balances.
- Dashboard header: equity curve (1W/1M/3M/all), day/week P&L; Research hub: attribution — stacked per-experience contribution over time, and per-experience net-of-AI-spend line (G9 honesty: the AI cost curve draws on the same chart).

## T6 — What-if replay (Research hub, on TradeDetail)

For any closed trade or labeled skip: "replay with different parameters" — re-run the deterministic decision gate (and, for scan_hits, the strategy evaluate over the stored `barWindowHash` window) against modified thresholds/sizing, showing would-have outcome vs actual. Frozen-decision semantics for LLM stages (recorded outputs reused; only deterministic stages re-execute) — the existing replay fixtures/`decision_traces` provide the substrate. Output is clearly labeled counterfactual and writes an `experience_experiments` row when saved.

## T7 — Kill-switch & live-readiness panel (Dashboard)

One glass-covered panel: global pause-all (one tap, big, red), per-session kill switches, current drawdown vs limits (live gauges), live-readiness state per session with the ack flow, and a "flatten everything" action (market-close every open position through the normal gate chain, confirm-typed: type FLATTEN). Every action here also exists as a palette action and (pause/flatten) responds within one monitor tick — test with a running mock session.

## Done criteria

- [x] Each of T1–T7 works end-to-end in code (IPC + UI + tests); daily-DB eye verify pending Ken.
- [x] Palette: listed actions execute (code); search returns each entity class (unit/IPC path).
- [x] Backtest Lab sweep writes experiment rows (vitest); scripted hash match eye-verify pending Ken.
- [x] Data Doctor detects a deliberately-poked gap in tests and exposes backfill IPC.
- [ ] Briefing generated 3 consecutive mornings headless and delivered to phone — **Ken blocker**.
- [x] Equity snapshots service + curve UI; accumulation on daily DB pending Ken soak.
- [x] What-if replay IPC + TradeDetail counterfactual UI; real closed-trade eye verify pending Ken.
- [x] Kill-switch panel + palette actions; mock-session pause/flatten eye verify pending Ken.
- [x] `bun run check` + `bun run prove` green; screenshots of every new surface pending Ken review.

### User journey

⌘K → "start btc" → session running. ⌘K → "backtest volume scanner" → Lab prefilled, run, folds green, sweep shows the edge is flat across thresholds (good sign, not curve-fit). Morning: phone briefing says "+$41 yesterday; 2 trades; calibration stable; CPI Thursday — trend session holds SPY." Something feels wrong mid-day → Dashboard → red panel → Pause all → everything stops within a tick, phone confirms.

### TLDR: shortcuts taken

- SQLite-LIKE palette search is a scale bet (single-user data volumes), not benchmarked.
- Equity snapshot valuation of open positions uses last-known marks; stale-mark handling (market closed) is left to implementation judgment — surface staleness, don't fake precision.
- What-if replay limits itself to deterministic-stage re-execution; declared here so nobody "improves" it into re-running LLM phases and burning spend.
- Briefing narrative defaults to deterministic template; optional LLM narrate hook is wired but not required for assembly.

### Core decisions (sign-off required)

| #   | Decision                                                                                              | Why                                                                     |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | These seven features are the complete new-features list for this folder                               | Bounds "add a bunch of cool features" to a finite, finished set         |
| 2   | Sweeps mandatorily record into `experience_experiments`                                               | Anti-overfitting bookkeeping is non-negotiable once a sweep tool exists |
| 3   | Flatten-everything routes through the normal gate chain (slower but safe), not a broker-direct bypass | Preserves invariant I3 even in emergencies                              |

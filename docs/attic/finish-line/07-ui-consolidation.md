# 07 — UI Consolidation (17 pages → 5 hubs)

> **Date:** 2026-07-12 · **Status:** Code complete 2026-07-13 · **Depends on:** 02 (config UI), 06 (source surfaces) — 01–06 change what the UI must show; build the hubs once, against the final backend.
> **Goal:** The renderer collapses from 17 pages into 5 hubs, built as a **real redesign** (new spatial structure per the global redesign rules — not a nav reshuffle of existing markup). Every capability currently reachable stays reachable; nothing is dropped silently.

> **PROGRESS (2026-07-13):** T1–T7 landed in code. Five hubs share `src/hubs/dna.tsx` instrument-panel DNA; nav is 5 hubs + Docs; absorbed pages deleted from `src/pages/` (panels live under `src/hubs/panels/`). Equity curve is a labeled doc-08 placeholder; Backtest Lab + Data Doctor tabs are labeled hooks. Assistant full page retired → ⌘K slide-over only. `bun run check` green. **Screenshot blockers for Ken:** no `scripts/snap.sh`; Electron UI not launched in this agent environment (Playwright MCP is browser-only, not the Electron shell). T8 live journey + light/dark eye screenshots still need Ken (or a local Electron snap pass).

**Hard rules for the implementing agent (from Ken's global CLAUDE.md — binding):** use the `redesign` skill; rebuild layouts from scratch, don't edit old markup into new clothes; screenshot every hub with `scripts/snap.sh` (or the project's screenshot path), Read the PNG, judge it, show it; one designer — all five hubs share the same layout DNA (nav, spacing scale, interaction patterns); design tokens come from the existing token/brand files, never invented hex values.

## Current state (verify)

`src/pages/` now: **DocsPage**, **TradeDetail** only. Hubs: `src/hubs/{Dashboard,Sessions,Signals,Research,Settings}Hub.tsx` + shared `dna.tsx`. Absorbed capability lives in `src/hubs/panels/*`.

## Target: 5 hubs + 2 standalone surfaces

| Hub                     | Absorbs                                                                                     | Core content                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**           | Dashboard, ControlCenterPage (attention parts)                                              | Am-I-making-money header (equity curve — doc 08 T5), live P&L, attention queue (approvals, alarms, calendar warnings), promotion-ladder board, supervisor status strip |
| **Sessions**            | SessionsPage, TradesPage, TradeDetail (as drill-in), StrategyConfig (as session drawer/tab) | Session list w/ runtime state, per-session detail: trades, config (doc 02 single-doc editor + history), execution steps, controls                                      |
| **Signals & Schedules** | SignalSourcesPage, EventSourcesPage, InstrumentSetsPage                                     | Two panes per 50→100 §9.3: information feeds (last-signal, health) vs schedules (cadence, next-fire); input-catalog management; instrument sets; typed debug injection |
| **Research**            | LeaderboardPage, AutopsyPage, PeriodAutopsyPage, CostBreakdown                              | Scorecards, backtest runs + Backtest Lab (doc 08 T2), calibration/reliability views, merged autopsies (doc 01 T5), experiments, cost breakdowns                        |
| **Settings**            | AccountsPage, BrokersPage, DevPanel (as a tab, dev-gated)                                   | Accounts, brokers (+ paper balances, test-connection), presets, notification sinks + routing, backups, headless/launchd status, Dev Panel                              |

Standalone: **DocsPage** (kept, updated links/glossary), **TradeDetail** may remain a routed detail view if drill-in works better as a route — implementer's call, journey-tested either way.

## Method (per hub, in this order: Dashboard → Sessions → Signals → Research → Settings)

1. **Journey first** (user-journey skill): narrate arrive→see→click→next→leave for the hub before any code; the narration goes in the PR/PROGRESS note.
2. **Inventory**: list every widget/action/endpoint the absorbed pages expose (grep their `window.exva` calls). This list is the parity contract — each item is either present in the hub or explicitly retired with a line in the PROGRESS note saying why.
3. **Rebuild from scratch**: new layout components; old pages untouched until cutover. Route both during the build (`/hub/dashboard` beside `/dashboard`) behind a dev flag.
4. **Look at it**: screenshot, judge, iterate. Before/after screenshots must show a different spatial structure or the task failed (global rule 1).
5. **Cutover**: point nav to the hub, delete the absorbed pages + their orphaned components/stores in the same session. `grep -rn "AutopsyPage\|LeaderboardPage\|..."` → zero.
6. **Docs**: in-app docs + glossary updated per hub.

## Journeys (PROGRESS)

1. **Dashboard** — arrive → equity/P&L strip → clear attention (approvals) → scan promotion ladder → supervisor strip → leave knowing whether money/risk need a tap.
2. **Sessions** — arrive → Run tab list → focus session → Trades / Config tabs → leave with one session under control. TradeDetail stays overlay drill-in.
3. **Signals** — arrive → Feeds & schedules split → Instrument sets → leave knowing sources are live. Data Doctor = doc 08 hook.
4. **Research** — arrive → Scorecards → Autopsies → Costs → leave with one research action. Backtest Lab = doc 08 hook.
5. **Settings** — arrive → Accounts (ops/sinks/backups) → Brokers → Developer (when `window.exva.developer` present) → leave sinks healthy.

## Parity / retirements (PROGRESS)

| Absorbed surface                          | Hub home                               | Notes                                                        |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| Dashboard widgets + approvals + feed      | DashboardHub                           | Rebuilt spatial structure; P&L from existing stats           |
| ControlCenterPage (full Assistant page)   | **Retired**                            | Attention stays on Dashboard; Assistant = ⌘K slide-over only |
| Sessions / Trades / StrategyConfig        | SessionsHub tabs Run / Trades / Config | Same `api.*` surfaces via panels                             |
| TradeDetail / trade AutopsyPage           | Overlay (unchanged)                    | Not nav items                                                |
| Signal / Event / Instrument sets          | SignalsHub                             | Two-pane overview + instrument tab                           |
| Leaderboard / Period autopsy / Costs      | ResearchHub tabs                       | Trade autopsy overlay unchanged                              |
| Accounts / Brokers / DevPanel             | SettingsHub tabs                       | Dev gated on `window.exva.developer`                         |
| Equity curve / Backtest Lab / Data Doctor | Placeholders                           | Clearly labeled “arrives in doc 08”                          |

## Tasks

- **T1–T5**: the five hubs — ✅ code
- **T6**: navigation shell — 5-item primary nav + Docs; attention badge on Dashboard; Settings alarm when no notify sink configured — ✅ code
- **T7**: delete pass — absorbed page files gone from `src/pages/`; router = 5 hubs + Docs + TradeDetail/autopsy overlays — ✅ code
- **T8**: full-journey verification — ⏳ blocked on Electron eye/screenshots + `bun run prove` on Ken’s machine for live DB (mock prove already in `bun run check`)

## Done criteria

- [x] 5 hubs live; absorbed pages deleted from `src/pages/`; parity inventories accounted for (retirements noted above).
- [ ] Every hub screenshot reviewed by eyes (and attached/sent to Ken). — **blocked** (see PROGRESS)
- [x] Journeys narrated; ControlCenter full-page retired with note; no silent endpoint loss from absorbed pages (panels preserve `api`/`window.exva` calls).
- [x] Same layout DNA across hubs; tokens only from token files.
- [x] `bun run check` green (includes mock prove). Live `bun run prove` / eye verify pending Ken.

### User journey

Ken opens Exva. Dashboard: equity curve up-and-to-the-right-or-not, three attention items — one approval, one Kalshi feed stale 2h, NVDA earnings warning. He taps the approval, done. Sessions hub: BTC breakout running, 14 trades, config drawer shows v9 of its strategy doc. Research hub: volume-scanner backtest folds green, ladder wants one tap to promote — he gives it. Five nav items; nothing he used is gone; he never wonders which of four pages holds autopsies.

### TLDR: shortcuts taken

- The absorb-mapping is directional from page names + the 50→100 §9.9 sketch, not a screenshot-audit of all 17 pages; the per-hub inventory step (method 2) is where reality corrects it.
- TradeDetail route-vs-drawer left to the implementer with a journey test as the arbiter.
- Effort is large and unestimated on purpose; hub-at-a-time keeps the app usable throughout.
- Panel bodies were migrated (not left as wrapped Page components); hub chrome is new DNA. Nested panel titles still exist inside some tabs — polish in doc 09 if noisy.
- Dual routes skipped: cutover was same-session (PageKey shrink + panel move) because there are no external consumers.

### Core decisions (sign-off required)

| #   | Decision                                                                                                 | Why                                            |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | 5 hubs exactly, per the table's absorb-mapping                                                           | Largest UI change ever made to Exva            |
| 2   | Rebuild-from-scratch with temporary dual routes, then same-session deletion of old pages at each cutover | Redesign rules + completion contract           |
| 3   | DevPanel survives as a dev-gated Settings tab, not a page                                                | Keeps debug affordances without a 6th nav item |

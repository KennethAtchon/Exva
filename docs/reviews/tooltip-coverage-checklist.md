# Exva Tooltip Coverage Checklist

> **Purpose:** Ensure users can understand Exva's non-obvious terms, states, and side effects without reading internal docs. Every checkbox is a tooltip or equivalent inline help affordance that should exist in the UI.
>
> **Legend:** `[ ]` = not implemented · `[x]` = implemented · **(file)** = primary UI location
>
> **Status:** Reviewed 2026-06-14. Checklist narrowed to non-obvious help only; implementation not started.

---

## How to use this checklist

1. Only add help for terms, states, or consequences that are not obvious from the label itself.
2. Skip self-explanatory labels such as plain nav names, `Session name`, or simple table headers unless the behavior behind them is surprising.
3. Prefer a single reusable pattern (`HelpTooltip` / `LabelWithHelp`) over ad-hoc `title` attributes so copy, styling, and keyboard behavior stay consistent.
4. Keep tooltip copy short (1-2 sentences). If it needs more than that, it probably wants inline help or a linked doc instead.
5. Use Radix Tooltip (`src/components/ui/tooltip.tsx`). `TooltipProvider` already wraps `NavShell`; standalone portals still need coverage.
6. Use an explicit info icon trigger. Do not rely on hovering arbitrary text.
7. Centralize copy in `src/lib/help-glossary.ts` (or similar) keyed by glossary id so shared terms stay consistent.
8. If visible helper text already explains the behavior, do not repeat it in a tooltip.
9. Mark `[x]` only when the help affordance is wired in UI and the copy has been checked against current behavior.

---

## Implementation order

| Phase | Name                  | Sections                                                                    | Exit criteria                                                                         |
| ----- | --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **0** | Foundation            | [§0](#0-foundation)                                                         | Shared `HelpTooltip` component + glossary module; `TooltipProvider` coverage verified |
| **1** | Core concepts         | [§1](#1-core-glossary-tooltips)                                             | Experience, signal, session, environment, and workspace glossary ships                |
| **2** | Primary workflows     | [§2](#2-navigation--workspace-chrome)-[§5](#5-sessions-page)                | Nav, session create/edit, session list, session drawer                                |
| **3** | Data & execution      | [§6](#6-signal-sources-page)-[§10](#10-strategy-page)                       | Signals, brokers, accounts, trades, strategy                                          |
| **4** | Dashboard & analytics | [§3](#3-dashboard-page), [§11](#11-api-usage-page)-[§13](#13-autopsy-pages) | Dashboard, API usage, leaderboard, autopsy                                            |
| **5** | Polish & audit        | [§14](#14-cross-cutting--migration)                                         | Legacy `title=` attrs replaced; empty-state help; QA pass                             |

---

## 0. Foundation

- [ ] **`HelpTooltip` component** — icon trigger + `TooltipContent`, optional `side`, `max-w-xs`, supports `glossaryId` lookup **(new: `src/components/ui/help-tooltip.tsx`)**
- [ ] **`LabelWithHelp` wrapper** — label row with optional required marker + `HelpTooltip` **(new: `src/components/ui/label-with-help.tsx`)**
- [ ] **Glossary module** — typed map of id -> `{ title?, body }` for all shared terms below **(new: `src/lib/help-glossary.ts`)**
- [ ] **Glossary ids exported** — const object or enum so typos fail typecheck
- [ ] **`TooltipProvider` audit** — modals/portals that mount outside `NavShell` get provider coverage
- [ ] **Dev-only glossary preview** (optional) — render all glossary entries for copy review **(DevPanel tab or Storybook)**

---

## 1. Core glossary tooltips

These concepts appear on multiple pages. Define them once and reuse them by id.

### Domain primitives

- [ ] **`experience`** — "A packaged trading setup: signal source, pipeline, presets, and supported instruments. You choose it when creating a session."
- [ ] **`signal`** — "An event the system can react to, such as a filing, news hit, or timer tick."
- [ ] **`signal-source`** — "A feed that emits signals. Sessions subscribe to one active source at a time."
- [ ] **`signal-delivery`** — "A signal queued for one session."
- [ ] **`dead-letter`** — "A signal the session skipped because it could not act on it, usually because of source, instrument, or broker mismatch."
- [ ] **`session`** — "A configured trading run: one experience, one active signal source, broker assignments, and strategy settings."
- [ ] **`pipeline`** — "The ordered AI workflow that runs after a signal arrives."
- [ ] **`instrument-class`** — "Asset type: stock, crypto, futures, or prediction market."

### Signal source types

- [ ] **`signal-type-edgar-8k`** — "Listens for SEC Form 8-K filings and turns matching filings into tradeable signals."
- [ ] **`signal-type-web-search`** — "Searches the web for relevant news and turns matching results into signals."
- [ ] **`signal-type-manual`** — "No automated feed. The session runs only from the manual tickers you enter."
- [ ] **`signal-type-mock`** — "Deterministic test signals for rehearsal and development. Not for real trading."
- [ ] **`signal-type-timer`** — "Fires on a schedule for strategies that do not depend on external news."
- [ ] **`signal-type-prediction-event`** — "Events from prediction-market platforms for prediction-market experiences."

### Experiences (per registry entry)

- [ ] **`experience-edgar-catalyst`** — "Trades post-8-K drift on US equities. Uses filing-driven signals and a catalyst-focused pipeline." **(`edgar-catalyst/descriptor.ts`)**
- [ ] **`experience-rules-mean-reversion`** — "Rule-based mean reversion on a manual or timer-driven stock universe." **(`rules-mean-reversion/descriptor.ts`)**
- [ ] **`experience-rules-qqq-mean-reversion`** — "A QQQ-focused timer strategy for mean reversion." **(`rules-qqq-mean-reversion/descriptor.ts`)**
- [ ] **`experience-btc-momentum-breakout`** — "A timer-driven BTC momentum breakout strategy." **(`btc-momentum-breakout/descriptor.ts`)**
- [ ] **`experience-commodities-trend-following`** — "A futures trend-following strategy for commodities." **(`commodities-trend-following/descriptor.ts`)**
- [ ] **`experience-prediction-event-edge`** — "An event-driven strategy for prediction markets." **(`prediction-event-edge/descriptor.ts`)**

### Session lifecycle & environment

- [ ] **`session-status-draft`** — "Created, but never started."
- [ ] **`session-status-idle`** — "Stopped cleanly and ready to start again."
- [ ] **`session-status-active`** — "Running now: processing signals and managing open positions."
- [ ] **`session-status-paused`** — "Not taking new research cycles. Existing positions are still monitored."
- [ ] **`session-status-monitoring-only`** — "No new entries. Existing positions stay managed until they close."
- [ ] **`session-status-attention-required`** — "The runtime hit an error or blocking condition and needs operator action before it can continue."
- [ ] **`session-status-stopped`** — "Fully halted. If positions are still open, no automated exits are running."
- [ ] **`environment-paper`** — "Simulated execution. No real broker orders are sent."
- [ ] **`environment-live`** — "Uses real broker accounts. Sessions still need live execution enabled before they can place live orders."
- [ ] **`execution-mode-paper-only`** — "This session never sends live orders, even when the workspace is in Live mode."
- [ ] **`execution-mode-live-allowed`** — "This session may send live orders when the workspace is in Live mode and readiness checks pass."

### Workspace & navigation

- [ ] **`view-global`** — "Show data across all sessions in the current environment."
- [ ] **`view-session-focused`** — "Show data for one focused session only."
- [ ] **`focus-session`** — "Choose which session drives session-specific pages and header controls."
- [ ] **`promotion-tier`** — "Readiness stage for an experience scorecard: scripted, rehearsal, paper, or live."
- [ ] **`approval-queue`** — "Trade proposals waiting for a human approve/reject decision before execution."

---

## 2. Navigation & workspace chrome

**Files:** `src/components/TopNav.tsx`, `src/components/AppNavSidebar.tsx`, `src/lib/nav.ts`

- [ ] **Paper / Live environment pill** — `environment-paper` / `environment-live`
- [ ] **Global vs focused session chip** — `view-global` / `view-session-focused`
- [ ] **Session status pill** (when focused) — dynamic per `session-status-*`
- [ ] **Attention badge on Sessions nav** — "How many sessions currently need intervention."
- [ ] **Strategy config dot on nav** — "Focused session still has missing strategy configuration."
- [ ] **Live stats strip** — explain `Daily P&L` and `Uptime`
- [ ] **Developer nav item** — "Internal diagnostics and traces; not part of the normal trading workflow."

---

## 3. Dashboard page

**Files:** `src/pages/Dashboard.tsx`, `src/components/approvals/PendingApprovalsPanel.tsx`

- [ ] **Dashboard scope / aggregation** — clarify focused-session vs global behavior
- [ ] **Stat: Portfolio Value** — why it can show a real balance or `—`
- [ ] **Stat: Daily P&L** — what is included in today's figure
- [ ] **Stat: Win Rate** — denominator (`closed today`)
- [ ] **Stat: AI Cost** — spend vs daily budget
- [ ] **Activity feed — phase badges** (`Technical`, `Fundamental`, `Review`, `Decision`, `Universe`) — one tooltip per badge role
- [ ] **Pending approvals section** — `approval-queue`
- [ ] **Approval row: confidence score** — "Model-estimated confidence for this trade proposal."

---

## 4. Session create / edit modal

**File:** `src/components/sessions/CreateEditSessionModal.tsx`

### Identity section

- [ ] **Field: Experience** — `experience`; selected experience may add experience-specific help
- [ ] **Field: Objective** — "Natural-language goal the AI should keep in mind while making decisions."

### Signal sources section

- [ ] **Section header: Signal Sources** — `signal-source` + "One active source per session."
- [ ] **Chip: Search vs Listener** — Search = web-driven discovery; Listener = event feed such as EDGAR
- [ ] **Source type labels** — `signal-type-edgar-8k` / `signal-type-web-search`
- [ ] **Disabled source note** — explain that a disabled source does not count as a live input
- [ ] **Readiness banner** — explain `armed`, `manual_only`, `waiting_for_source_enable`, and `no_inputs`

### Signal scope section

- [ ] **Field: Search provider override** — "Use a specific search provider for this session instead of the workspace default."
- [ ] **Field: Research focus** (when shown) — "Prioritize one class while keeping the broader broker-backed universe available."
- [ ] **Field: Manual tickers** — explain how manual tickers interact with search-style sessions and manual-only sessions

### Execution setup section

- [ ] **Field: Broker accounts** — "Which broker accounts this session may route orders through."
- [ ] **Allocation row** — explain balance, free capital, and allocated amount
- [ ] **Uncovered classes warning** — explain that unsupported classes can still dead-letter even if the session is launchable
- [ ] **Launchability state** — explain why the session can or cannot start from current broker coverage

---

## 5. Sessions page

**Files:** `src/pages/SessionsPage.tsx`, `src/components/sessions/SessionTable.tsx`, `src/components/sessions/SessionExecutionProgress.tsx`, `src/components/sessions/LiveReadinessModal.tsx`, `src/components/sessions/SessionTemplatesModal.tsx`

### List & filters

- [ ] **Metrics strip** — clarify scope for `Active`, `Paused`, and open-position counts
- [ ] **Status filter** — pointer to `session-status-*` glossary entries
- [ ] **Instrument filter** — `instrument-class`

### Session card / table

- [ ] **Status** — dynamic status tooltips
- [ ] **Experience** — selected experience summary
- [ ] **Signal source** — source name + source type meaning
- [ ] **Progress / stage** — current execution stage and what it implies
- [ ] **P&L / stats** (if shown) — scope and time window

### Lifecycle controls

- [ ] **Start** — prerequisites: AI connected, broker coverage, and live-readiness rules when relevant
- [ ] **Pause** — why exits still continue while new research stops
- [ ] **Resume** — what resumes and what stays unchanged
- [ ] **Stop when flat** — migrate existing `STOP_WHEN_FLAT_TITLE` to `HelpTooltip`
- [ ] **Force stop** — migrate existing copy to `HelpTooltip`; make the loss of automated trade management explicit
- [ ] **Focus / Focused** — `focus-session`
- [ ] **Edit** — explain why active / paused / draining sessions are config-locked
- [ ] **Duplicate / Save template** — explain what session data carries over

### Session detail drawer

**File:** `src/components/sessions/SessionDetailDrawer.tsx`

- [ ] **Section: Risk Limits** — "Caps position sizing, loss, and concurrent exposure for this session."
- [ ] **Signals: delivery status labels** — explain `queued`, `waiting_for_resume`, `processing`, `triggered`, `traded`, `rejected`, `dropped`, and `expired`
- [ ] **Dead-letter reason chips** — explain why a signal was rejected:
  - [ ] `dead-letter-reason-unsupported-by-experience`
  - [ ] `dead-letter-reason-unsupported-by-signal-source`
  - [ ] `dead-letter-reason-unsupported-by-assigned-broker`
  - [ ] `dead-letter-reason-no-compatible-broker-route`
- [ ] **Replay dead letter button** — "Try this signal again after fixing the underlying config or broker coverage issue."
- [ ] **Section: Execution Progress** — explain cycle id, current stage, retrying vs failed, and last error
- [ ] **Section: Recent Events** — phase badge glossary reuse

### Live readiness modal

- [ ] **Modal title** — "Checks required before live execution."
- [ ] **Each readiness check row** — explain what each check is verifying and what blocks start

---

## 6. Signal sources page

**File:** `src/pages/SignalSourcesPage.tsx`

- [ ] **Page header** — explain that sources are global, while subscriptions are per session
- [ ] **Add Source dialog — source type picker** — explain `EDGAR 8-K` vs `Web Search`
- [ ] **Source row — runtime status** (`Running`, `Idle`, `Paused`, `Error`, `Restarting`) — what each means operationally
- [ ] **Enable / disable toggle** — explain what happens to subscribed sessions when a source is disabled
- [ ] **Test source button** (`EDGAR 8-K` only) — "Runs one poll now and reports detections; it does not enqueue session deliveries."
- [ ] **Remove source confirmation** — explain that deleting a source unsubscribes attached sessions but keeps historical records
- [ ] **Configure EDGAR — poll interval (market / off-hours)** — how often the SEC feed is checked
- [ ] **Configure EDGAR — CIK whitelist** — "Limit detection to these SEC filers; empty means all."
- [ ] **Configure EDGAR — min filing age** — "Ignore very fresh filings until they are old enough to trust."

---

## 7. Brokers page

**File:** `src/pages/BrokersPage.tsx`

- [ ] **Connection / health indicator** — what healthy vs degraded means
- [ ] **Supported instrument classes** — `instrument-class`
- [ ] **Balance / free capital** — refresh cadence and why values can lag the broker slightly
- [ ] **Settings: Max sessions** — "Cap how many sessions can use this broker at once."
- [ ] **Settings: Allocation enforcement** — warn vs hard block when the broker is over-allocated
- [ ] **Settings: Refresh interval** — how often broker balances are polled

---

## 8. Accounts page

**File:** `src/pages/AccountsPage.tsx`

- [ ] **Environment toggle (Paper / Live)** — `environment-paper` / `environment-live`; make the visibility/safety implications clear
- [ ] **Workspace default AI model** — where this default is used and when a session can override it
- [ ] **Reasoning level** — what changing it affects
- [ ] **Search providers section** — "External search services used by search-style sessions."
- [ ] **Workspace default search provider** — used when a session does not specify an override
- [ ] **Workspace routing defaults / broker allocation overrides** (if exposed) — explain fallback routing behavior
- [ ] **Security Model** — explain that credentials stay local and broker secrets live in the OS keychain

---

## 9. Trades page

**Files:** `src/pages/TradesPage.tsx`, `src/pages/TradeDetail.tsx`

- [ ] **Page scope** — global vs focused-session trade view
- [ ] **Session filter** (global view) — filter trades by originating session
- [ ] **Column: P&L** — realized vs unrealized
- [ ] **Column: AI cost** — trade-level attributed model spend
- [ ] **Column: Confidence** — how the confidence score should be interpreted
- [ ] **Review trade / Autopsy link** — "Open post-trade review for this trade."

### Trade detail

- [ ] **Cost attribution** — AI + data cost associated with this trade
- [ ] **Linked signal / delivery** — `signal-delivery`

---

## 10. Strategy page

**Files:** `src/pages/StrategyConfig.tsx`, `src/components/strategy/*.tsx`

- [ ] **Page header / lock state** — focused session required; active or paused sessions are read-only
- [ ] **Presets vs Customize tabs** — what each mode changes
- [ ] **Customize: Style / AI Instructions** — explain the difference between high-level trading style and hard rules
- [ ] **Customize: Trade Rules** — what the decision flow must obey
- [ ] **Customize: Risk Controls** — sizing, max loss, exposure, and approval settings
- [ ] **Customize: Timeframe** — holding horizon and catalyst window expectations
- [ ] **Customize: AI Phases** — per-phase model, prompt, and tool configuration
- [ ] **Active preset indicator** — built-in preset vs saved preset vs custom state
- [ ] **Stop when flat control** (if shown) — migrate existing `title` help to glossary-backed tooltip
- [ ] **Unconfigured strategy indicator** — explain what is missing before the session is ready

---

## 11. API Usage page

**File:** `src/pages/CostBreakdown.tsx`

- [ ] **Budget card** — today's budget vs spend
- [ ] **Cache savings** — "Prompt cache reduced spend by this amount."
- [ ] **Cost by agent** — map rows to phase badges / glossary terms
- [ ] **Cost per trade** — how spend is attributed back to trades
- [ ] **Projections** — assumptions behind projected daily spend and trades remaining

---

## 12. Leaderboard page

**File:** `src/pages/LeaderboardPage.tsx`

- [ ] **Page header** — per-experience aggregation; mock-broker trades excluded
- [ ] **Column: Tier** — `promotion-tier`
- [ ] **Column: Expectancy** — "Average P&L per trade after costs."
- [ ] **Column: Max DD** — "Maximum peak-to-trough drawdown."
- [ ] **Column: Net PnL (after costs)** — includes AI and data fees
- [ ] **Column: Cost/trade** — average model spend per closed trade
- [ ] **Column: Promotion** — why an experience is ready or which criteria it still fails
- [ ] **Walk-forward OOS sub-label** — "Out-of-sample expectancy from the walk-forward split."

---

## 13. Autopsy pages

**Files:** `src/pages/AutopsyPage.tsx`, `src/pages/PeriodAutopsyPage.tsx`

### Trade autopsy

- [ ] **Page header** — "AI-generated review of a single trade."
- [ ] **Section: Thesis Review** — especially `Valid Thesis` and `Confirmatory Bias`
- [ ] **Section: Execution Quality** — entry timing, sizing, exit management, slippage
- [ ] **Section: Behavioral Flags** — severity and what each flag means
- [ ] **Section: Market Context** — regime and suitability labels
- [ ] **Section: Root Cause** — what this section is claiming vs summarizing
- [ ] **Section: Process Improvements** — how to read action items vs observations

### Period autopsy

- [ ] **Page header** — "Pattern analysis across many trades in a date range."
- [ ] **Section: Performance & Process Patterns** — explain the summary metrics and narrative fields
- [ ] **Section: Recurring Failure Modes** — count + category meaning
- [ ] **Section: Included Trades** — what trade set this review is based on

---

## 14. Cross-cutting & migration

### Replace native `title` attributes

Migrate these to `HelpTooltip` for consistent UX and mobile accessibility:

- [ ] `src/components/sessions/SessionTable.tsx` — lifecycle buttons
- [ ] `src/pages/SessionsPage.tsx` — lifecycle buttons
- [ ] `src/components/TopNav.tsx` — session controls, env pills, global chip
- [ ] `src/components/AppNavSidebar.tsx` — attention badge, strategy dot
- [ ] `src/pages/StrategyConfig.tsx` — stop controls
- [ ] `src/components/sessions/SessionExecutionProgress.tsx` — pause, cycle id, last error

### Empty states

- [ ] **No sessions** — CTA plus a short explanation of experience + signal source setup
- [ ] **No signal sources** — explain global setup before session subscription
- [ ] **No brokers connected** — point to Accounts / Brokers and explain why sessions cannot launch
- [ ] **No focused session on Strategy** — explain focus requirement
- [ ] **No trades / no scorecards** — explain what actions populate these pages

### Accessibility & QA

- [ ] Tooltip triggers are real buttons with an accessible name
- [ ] Tooltip does not trap focus; `Esc` dismisses
- [ ] Copy reviewed against `docs/plans/experience-capability-contracts.md`, `docs/specs/signal-driven-architecture.md`, and `electron/shared/domain/signals.ts`
- [ ] Screenshot pass: every primary page has at least one visible help affordance above the fold where a non-obvious concept exists
- [ ] E2E smoke (optional): help icons render without console errors

---

## Suggested copy registry shape

```ts
// src/lib/help-glossary.ts (illustrative)
export const HELP_GLOSSARY = {
  experience: {
    title: "Experience",
    body: "A packaged trading setup...",
  },
  "signal-type-edgar-8k": {
    title: "EDGAR 8-K",
    body: "Listens for SEC Form 8-K filings...",
  },
  // ...
} as const satisfies Record<string, { title?: string; body: string }>;

export type HelpGlossaryId = keyof typeof HELP_GLOSSARY;
```

---

## Related docs

- `docs/plans/experience-capability-contracts.md` — experience / capability terminology
- `docs/specs/signal-driven-architecture.md` — signal bus, subscriptions, deliveries, dead letters
- `electron/shared/domain/signals.ts` — signal source, runtime-status, and delivery-status enums
- `electron/main/experiences/*/descriptor.ts` — per-experience descriptions for glossary seeding
- `src/components/ui/tooltip.tsx` — Radix tooltip primitives

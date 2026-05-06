# Trading Strategy Configuration — Plan

> **Date:** 2026-05-03
> **Status:** In Progress
> **Deciders:** Kenneth Atchon
> **Implements:** `docs/CODING_GUIDELINES.md`

---

## 1. Problem Statement

The current strategy system is still a legacy execution-settings blob. `session_strategies` stores stop-loss, take-profit, position sizing, AI spend, and timeframe settings together, while the runtime only injects the trading horizon into prompts. That means Exva can tell an agent how long to hold, but not what style of trade it is supposed to find, what side bias to honor, what kind of entry qualifies, or what special rules apply for a prediction market. At the same time, the current bull/bear researcher framing pushes the agents into advocacy rather than investigation, and the instrument selector is still modeled as a lightweight picker instead of the primary discovery role.

This must be fixed now because the harness plan depends on a canonical strategy snapshot, methodology-differentiated analysts, and a first-class `prediction_market` mode. Without those contracts, richer prompts will be inconsistent, the audit trail will not know what rules the model was following, and Polymarket cannot be represented correctly in the domain model.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
|---|------|--------------------|
| 1 | Replace bull/bear advocacy with methodology-based analysts | Agents research through different lenses rather than forcing opposite conclusions |
| 2 | Elevate the instrument selector to a first-class universe researcher | Discovery happens before analysis and gates the rest of the cycle |
| 3 | Separate strategy, risk, and timeframe configuration into focused tables | Risk can change without rewriting strategy intent, and timeframe can evolve independently |
| 4 | Compose an authoritative strategy brief and inject it into every agent run | Every agent receives the same strategy/risk/timeframe ground truth |
| 5 | Make strategy context fully auditable | `agent_messages.strategy_snapshot_json` stores the exact injected strategy state for each run |
| 6 | Add a complete prediction-market domain model and Polymarket execution path | A prediction-market session can discover, analyze, size, place, monitor, and close trades correctly |

**Non-Goals**

| # | Non-Goal | Reason |
|---|----------|--------|
| 1 | Backtesting and parameter optimization | Separate product surface |
| 2 | Automatic regime switching between strategies | Future iteration |
| 3 | Option spreads or advanced derivatives strategies | Execution adapters do not support them |
| 4 | Cross-session shared strategy presets with version history | Templates remain latest-snapshot only in this phase |
| 5 | Fully automated prompt mutation from trade autopsies | Human-initiated only |

---

## 3. Background & Context

**Current repo reality**

| Area | Current state | Gap this plan closes |
|---|---|---|
| `session_strategies` | One table mixes strategy-ish fields, risk fields, and timeframe fields | No clean ownership boundaries |
| `strategy-prompt-context.ts` | Only prepends timeframe/horizon context | No full strategy/risk prompt context |
| `AgentRole` union | `researcher_bull`, `researcher_bear`, `reviewer`, `decision_maker`, `instrument_selector` | Wrong analyst semantics |
| `AiRuntime.runResearcher()` | Chooses role by bull/bear stance | No methodology-based routing |
| `Trade` / broker domain | Only understands `stock`, `crypto`, `futures` and `BUY`/`SELL` | Cannot represent Polymarket YES/NO outcome positions |

**Relevant current files**

- `electron/shared/domain.ts`
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/session-strategies-repo.ts`
- `electron/main/services/ai/strategy-prompt-context.ts`
- `electron/main/services/ai/ai-runtime.ts`
- `electron/main/services/orchestration/agent-orchestrator.ts`

**Constraint from the existing codebase**

The current runtime, risk engine, and session creation flow still read from `session_strategies`. A safe cutover must therefore be additive first: create the new tables, backfill them, introduce a composite read service, and only remove the legacy blob after all readers have moved. Even though Exva is local-first and does not require long-term backward compatibility, the staged cutover keeps the system bootable throughout the migration.

**Cross-plan contract with the harness**

This plan and `docs/plan/ai-harness-architecture.md` share these canonical decisions:

1. The post-migration analyst role names are `analyst_technical` and `analyst_fundamental`.
2. `instrument_selector` remains the code/DB key, but the UI label becomes **Universe Researcher**.
3. The detailed strategy snapshot is stored on `agent_messages.strategy_snapshot_json`.
4. Stock fundamental analysis assumes the harness injects `## Fundamentals` in addition to `## Market Data` and `## News`.
5. Reviewer runs as a bounded tool-use verifier; analysts remain strictly parallel and independent.

---

## 4. Research Summary

**Bull/bear framing vs. methodology differentiation**
Research on multi-agent LLM debate shows that forcing fixed positions can lower group accuracy and increase confident convergence on wrong answers. Trading systems benefit more from analysts that examine different evidence sources than from agents instructed to argue opposite conclusions. Source: [Nature Scientific Reports](https://www.nature.com/articles/s41598-026-42705-7), [TradingAgents paper](https://arxiv.org/pdf/2412.20138v6)

**Key insight:** Exva should encode analyst diversity in method, not in forced stance.

**Polymarket architecture**
Polymarket is a binary outcome market on Polygon with YES/NO outcome tokens and CLOB-based trading. The important distinction is that direction is not `BUY` vs `SELL`; `BUY` and `SELL` are order actions, while YES/NO is the thesis or outcome leg being traded. Source: [Polymarket docs](https://docs.polymarket.com/), [py-clob-client](https://github.com/Polymarket/py-clob-client), [QuantVPS guide](https://www.quantvps.com/blog/automated-trading-polymarket)

**Key insight:** Exva must add a separate prediction-market outcome field instead of trying to overload `TradeSide`.

**PolySwarm framework**
PolySwarm shows that independent probability estimates from different personas can outperform a single generalized view when trading prediction markets. The important pattern is not the exact number of agents, but separating base-rate reasoning from contextual/news reasoning. Source: [PolySwarm arXiv](https://arxiv.org/abs/2604.03888)

**Key insight:** Exva only needs two differentiated prediction-market analysts to capture the main benefit: statistical/base-rate reasoning and contextual/current-events reasoning.

**Schema separation precedent**
Quantitative systems generally separate strategy rules from risk controls because they change at different cadences and are owned by different decision processes. Mixing them causes accidental coupling and confusing UIs. Source: [QuantConnect](https://www.quantconnect.com/)

**Key insight:** The strategy/risk/timeframe split should be explicit in the schema and mirrored in the UI.

---

## 5. Researcher Role: Methodology, Not Advocacy

**Current state**

```text
researcher_bull  -> find the strongest long thesis
researcher_bear  -> find the strongest short thesis
```

**Problem**

Both roles look at the same instrument and are rewarded for arguing, not investigating. That creates confirmation bias and makes disagreement less informative.

**Recommendation**

| Old | New | What it owns |
|---|---|---|
| `researcher_bull` | `analyst_technical` | Price, volume, market structure, indicator state, support/resistance |
| `researcher_bear` | `analyst_fundamental` | Earnings, growth, valuation, sector context, catalysts, macro/news |

**Rules**

1. Analysts do not see each other’s output.
2. Analysts are allowed to agree.
3. Analysts are not told what side to conclude.
4. Reviewer compares and synthesizes; decision maker decides.

**Migration policy**

Because Exva does not need long-term backward compatibility, the plan does **not** keep deprecated runtime aliases indefinitely. The migration updates stored `session_ai_roles.role` values and the code switches to the new names in one controlled phase.

---

## 6. Instrument Selector: Universe Researcher

The role key remains `instrument_selector`, but its product meaning changes. It is not a passive scoring step; it is the first and most consequential research stage.

**Responsibilities**

1. Discover instruments or markets worth analyzing now.
2. Respect session strategy type, side bias, instrument class restrictions, and broker compatibility.
3. Return a ranked shortlist with evidence, not just symbols.
4. Cache outputs behind a definition hash so repeated cycles can reuse recent results when appropriate.

**Modes**

1. **Open discovery**: search broadly for setups matching the strategy.
2. **Constrained discovery**: if the user provides a shortlist, search only within it, but still explain *why now*.

**UI/wording decision**

- DB key and prompt file key stay `instrument_selector`.
- UI label changes to `Universe Researcher`.

This keeps migrations small while aligning the product language with the actual role.

---

## 7. Schema Redesign: Canonical Strategy Context

The target model is three focused tables plus one legacy compatibility table during migration.

```text
sessions
  -> session_strategy_profile
  -> session_risk_config
  -> session_timeframe_config
  -> session_strategies (legacy compatibility only during cutover; removed in Phase 5)
```

### `session_strategy_profile`

```sql
CREATE TABLE session_strategy_profile (
  session_id                TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  strategy_type             TEXT NOT NULL DEFAULT 'custom',
  -- momentum | mean_reversion | trend_following | short_bias | pairs |
  -- fundamental | event_driven | prediction_market | custom
  side_bias                 TEXT NOT NULL DEFAULT 'both',
  -- long_only | short_only | both | market_neutral | n_a
  entry_style               TEXT NOT NULL DEFAULT 'breakout',
  -- breakout | pullback | reversal | range_fade | event | probability_edge
  exit_style                TEXT NOT NULL DEFAULT 'fixed_pct',
  -- fixed_pct | trailing_atr | partial_exits | time_based | thesis_based | market_resolution
  scaling_mode              TEXT NOT NULL DEFAULT 'single_entry',
  -- single_entry | scale_in_2 | scale_in_3 | scale_out_partial
  strategy_brief_markdown   TEXT NOT NULL DEFAULT '',
  custom_instructions       TEXT NOT NULL DEFAULT '',
  updated_at                TEXT NOT NULL
);
```

### `session_risk_config`

```sql
CREATE TABLE session_risk_config (
  session_id                TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  max_position_usd          REAL NOT NULL DEFAULT 500,
  stop_loss_pct             REAL,
  take_profit_pct           REAL,
  stop_loss_type            TEXT NOT NULL DEFAULT 'fixed_pct',
  -- fixed_pct | trailing_atr | broker_native_trailing | none
  atr_stop_multiplier       REAL,
  kelly_fraction            REAL NOT NULL DEFAULT 0.25,
  prediction_edge_threshold REAL NOT NULL DEFAULT 0.08,
  max_exposure_usd          REAL,
  wait_for_open_threshold   REAL NOT NULL DEFAULT 0.80,
  max_concurrent_trades     INTEGER NOT NULL DEFAULT 3,
  daily_loss_limit_usd      REAL NOT NULL DEFAULT 200,
  profit_target_usd         REAL NOT NULL DEFAULT 1000,
  max_ai_spend_usd          REAL NOT NULL DEFAULT 5,
  human_approval_required   INTEGER NOT NULL DEFAULT 0,
  updated_at                TEXT NOT NULL
);
```

### `session_timeframe_config`

```sql
CREATE TABLE session_timeframe_config (
  session_id                TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  primary_trading_timeframe TEXT NOT NULL DEFAULT '1d',
  holding_style             TEXT NOT NULL DEFAULT 'multi_day_swing',
  target_hold_days          REAL,
  max_hold_days             REAL,
  timeframe_notes           TEXT NOT NULL DEFAULT '',
  updated_at                TEXT NOT NULL
);
```

### Canonical strategy snapshot stored with each agent run

This snapshot is injected into prompts and stored in `agent_messages.strategy_snapshot_json` by the harness:

```json
{
  "version": 1,
  "profile": {
    "strategyType": "momentum",
    "sideBias": "long_only",
    "entryStyle": "breakout",
    "exitStyle": "trailing_atr",
    "scalingMode": "single_entry",
    "strategyBriefMarkdown": "...",
    "customInstructions": "..."
  },
  "riskConfig": {
    "maxPositionUsd": 500,
    "stopLossPct": 2,
    "takeProfitPct": 4,
    "stopLossType": "fixed_pct",
    "atrStopMultiplier": 1.5,
    "kellyFraction": 0.25,
    "predictionEdgeThreshold": 0.08,
    "maxExposureUsd": null,
    "waitForOpenThreshold": 0.8,
    "maxConcurrentTrades": 3,
    "dailyLossLimitUsd": 200,
    "profitTargetUsd": 1000,
    "maxAiSpendUsd": 5,
    "humanApprovalRequired": false
  },
  "timeframe": {
    "primaryTradingTimeframe": "1d",
    "holdingStyle": "multi_day_swing",
    "targetHoldDays": null,
    "maxHoldDays": 7,
    "timeframeNotes": "..."
  }
}
```

---

## 8. Canonical Polymarket Domain Model

This is the missing contract that makes `prediction_market` implementable.

### Core decisions

1. `InstrumentClass` gains a fourth value: `prediction_market`.
2. `TradeSide` remains `BUY | SELL` everywhere. It continues to mean order action.
3. A new nullable field `predictionOutcome` is added wherever a tradeable position is represented.
4. `instrumentSymbol` for prediction markets is the canonical market identity, not the outcome leg.

### Canonical identity shape

For prediction markets:

- `instrumentSymbol = pm:<conditionId>`
- `instrumentDisplayName = <human-readable market question>`
- `predictionOutcome = YES | NO`
- `instrumentMetadataJson = { slug, conditionId, outcomeTokenId, category, resolutionTime }`

### Required domain changes

**Type-level changes**

- `InstrumentClass` -> add `prediction_market`
- `OrderRequest`, `BrokerOrder`, `BrokerPosition`, `Trade`, and `TradeApproval`
  - add `predictionOutcome?: 'YES' | 'NO' | null`
  - add `instrumentDisplayName?: string | null` where persisted history needs a human-readable label
  - add `instrumentMetadataJson?: string | null` where token IDs / resolution time must be retained

**Persistence changes**

`trades` gains:

```sql
prediction_outcome   TEXT,
instrument_display_name TEXT,
instrument_metadata_json TEXT
```

`trade_approvals` gains the same three fields so approval history fully describes the intended order.

### Order semantics

| User intent | Stored `side` | Stored `predictionOutcome` | Meaning |
|---|---|---|---|
| Open YES position | `BUY` | `YES` | Buy YES shares |
| Open NO position | `BUY` | `NO` | Buy NO shares |
| Exit YES early | `SELL` | `YES` | Sell YES shares already owned |
| Exit NO early | `SELL` | `NO` | Sell NO shares already owned |

This avoids overloading `BUY` to mean YES and `SELL` to mean NO.

### Decision-maker output for prediction markets

```ts
{
  action: "trade" | "no_trade";
  outcome?: "YES" | "NO";
  estimatedProb?: number;
  impliedProb?: number;
  edgePctPts?: number;
  sizeUsd?: number;
  reasoning: string;
}
```

### Monitoring / close semantics

1. Resolution close: position is marked closed when Polymarket settles the outcome.
2. Early exit: Exva places a `SELL` order on the same `predictionOutcome` leg.
3. `maxHoldDays` or `maxExposureUsd` breach: deterministic non-LLM exit at current market price.

---

## 9. Options Considered

### Option A: Keep `session_strategies` and expand `timeframeNotes`

Use free text and a few extra columns on the legacy blob.

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Performance | Neutral |
| Reliability | Poor validation and poor auditability |
| Cost | Low |
| Reversibility | High |
| Stack fit | Short-term only |
| Team readiness | High |

Risks:
- Strategy intent remains ambiguous.
- Prompt injection stays inconsistent.
- Polymarket still has no canonical domain model.

### Option B: Add structured columns to the existing table only

Keep one table but add strategy-type and entry/exit columns.

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Performance | Neutral |
| Reliability | Better than free text, still conflated concerns |
| Cost | Moderate |
| Reversibility | Medium |
| Stack fit | Acceptable but messy |
| Team readiness | High |

Risks:
- Continues mixing strategy, risk, and timeframe.
- Harder to reason about migration boundaries.
- Does not force a proper Polymarket domain model.

### Option C: Strategy / Risk / Timeframe split with canonical snapshot (RECOMMENDED)

Use dedicated tables, a structured strategy brief composer, methodology-based analysts, and a canonical strategy snapshot stored with each agent trace.

| Dimension | Assessment |
|---|---|
| Complexity | High but phaseable |
| Performance | Negligible prompt cost increase |
| Reliability | Best validation, auditability, and cross-plan consistency |
| Cost | Moderate engineering effort |
| Reversibility | High while compatibility table exists |
| Stack fit | Best match for the harness direction |
| Team readiness | Good |

Risks:
- Requires a compatibility layer during cutover.
- Depends on harness snapshot injection landing cleanly.
- Polymarket touches multiple domain surfaces at once.

---

## 10. Recommendation

**We recommend Option C: Strategy / Risk / Timeframe split with canonical snapshot.**

This is the smallest approach that solves all four real problems at once: wrong analyst framing, undersized selector role, schema coupling, and missing prediction-market modeling. The strategy snapshot becomes a durable contract between the strategy UI and the harness, while the Polymarket domain model prevents semantic bugs caused by trying to map YES/NO positions onto `BUY`/`SELL` alone.

**Important companion decisions**

1. Rename `researcher_bull` -> `analyst_technical`.
2. Rename `researcher_bear` -> `analyst_fundamental`.
3. Keep `instrument_selector` as the persisted key, but rename its product label.
4. Store strategy snapshots on `agent_messages`, not `agent_runs`.
5. Make `prediction_market` a first-class instrument class with an explicit outcome field.

---

## 11. Implementation Plan

### Phase 1: Additive Schema Split + Compatibility Layer

**Status:** Implemented 2026-05-04

**Goal:** Create the new tables and keep the app behavior stable during migration.

**Done criteria:** New sessions write to new tables, existing sessions are backfilled, and legacy readers still work through mirror writes or composite reads.

**Deliverables:**

- `schema.ts`
  - add `session_strategy_profile`
  - add `session_risk_config`
  - add `session_timeframe_config`
- migration
  - create all three tables
  - backfill from `session_strategies`
- new repos
  - `session-strategy-profile-repo.ts`
  - `session-risk-config-repo.ts`
  - `session-timeframe-config-repo.ts`
- composite context service
  - `session-strategy-context-service.ts`
  - reads profile + risk + timeframe into one authoritative object
- compatibility layer
  - current save paths mirror legacy-compatible fields into `session_strategies` until all old readers are retired
- `SessionRepo.create()`
  - seed all three new tables for new sessions

**Dependencies:** None

**Rollback:** New tables are additive. Stop reading them and continue using `session_strategies` if needed.

**Implementation notes:**

- Added `session_strategy_profile`, `session_risk_config`, and `session_timeframe_config` to the DB schema and migrations.
- `SessionRepo.create()` and `SessionRepo.duplicate()` now seed/copy the new tables.
- `SessionStrategiesRepo.update()` and legacy config writes now mirror compatible fields into the new risk/timeframe tables so the app stays bootable while old readers still exist.
- Added dedicated repos plus a `SessionStrategyContextService` composite reader for the next phases.

---

### Phase 2: Analyst Rename + Prompt Migration

**Status:** Implemented 2026-05-04

**Goal:** Replace stance-based research with methodology-based research.

**Done criteria:** Runtime, UI, prompts, and stored role rows all use `analyst_technical` / `analyst_fundamental`.

**Deliverables:**

- `shared/domain.ts`
  - replace legacy role names in `AgentRole`
- DB migration
  - update `session_ai_roles.role`
- prompt assets
  - `analyst_technical.md`
  - `analyst_fundamental.md`
- `AiRuntime`
  - `runResearcher(stance)` -> `runAnalyst(role)`
- `AgentOrchestrator`
  - run technical + fundamental analysts explicitly
- UI labels and tabs

**Prompt rules**

`analyst_technical.md`

```markdown
# Technical Analyst

Use the injected `## Market Data` and `## News` blocks as authoritative.
Analyze price trend, volume structure, moving averages, ATR, RSI, support/resistance,
and chart pattern quality. Cite specific levels and percentages. Do not force a side.
```

`analyst_fundamental.md`

```markdown
# Fundamental Analyst

Use the injected `## Fundamentals` and `## News` blocks as authoritative.
Analyze earnings, growth, margins, valuation, catalysts, and macro/sector context.
If the `## Fundamentals` block says unavailable or not applicable, state that plainly
and limit the analysis to what the injected news and bounded search can support.
Do not force a side.
```

**Dependencies:** Phase 1

**Rollback:** Revert code and prompt references as one unit; DB migration can remap roles back if absolutely necessary.

**Implementation notes:**

- Renamed the canonical role keys to `analyst_technical` and `analyst_fundamental` across shared types, schemas, runtime calls, UI labels, mock data, and prompt assets.
- Added migration rewrites for `session_ai_roles.role`, `agent_runs.agent_type`, `events.agent_type`, and stored template payload JSON.
- `AiRuntime.runResearcher()` was replaced with `AiRuntime.runAnalyst()` and the orchestrator now passes technical/fundamental analysis into reviewer and decision-maker prompts.

---

### Phase 3: Strategy / Risk UI Split + Brief Composer

**Status:** Implemented 2026-05-05

**Goal:** Expose strategy intent and risk rules separately in the UI and save them to the new schema.

**Done criteria:** The Strategy page has separate Strategy, Risk, and Timeframe sections and shows a live brief preview built from structured inputs.

**Deliverables:**

- `StrategyConfig.tsx`
  - split into tabs/sections: Strategy, Risk, Timeframe, AI Roles
- `StrategyBriefForm`
- `strategyBriefAssembler.ts`
- IPC split:
  - `strategy.getProfile`
  - `strategy.saveProfile`
  - `strategy.getRiskConfig`
  - `strategy.saveRiskConfig`
  - `strategy.getTimeframeConfig`
  - `strategy.saveTimeframeConfig`
- validation rules
  - `event_driven` requires a resolved search provider
  - `prediction_market` requires `kelly_fraction > 0`
  - `prediction_market` requires `max_exposure_usd`
  - `strategy_brief_markdown` hard-capped for token hygiene

**Dependencies:** Phase 2

**Rollback:** Keep the new UI behind a route- or feature-level switch and continue using the old save path.

**Implementation notes:**

- The Strategy page now edits `session_strategy_profile`, `session_risk_config`, and `session_timeframe_config` as separate surfaces with section tabs for Strategy, Risk, Timeframe, and AI Roles.
- Added split IPC contracts for profile/risk/timeframe saves plus AI-role persistence through `SessionStrategyContextService`.
- Added canonical strategy brief assembly and live preview so structured edits persist the same brief later injected into prompts.

---

### Phase 4: Full Prompt Injection + Audit Snapshot

**Status:** Implemented 2026-05-05

**Goal:** Inject the full strategy/risk/timeframe context into every agent run and store the exact snapshot in the detailed audit trail.

**Done criteria:** Every AI role execution persists a non-empty `agent_messages.strategy_snapshot_json` matching the prompt context used in that run.

**Deliverables:**

- `strategy-prompt-context.ts`
  - `buildStrategyPromptContext(profile, riskConfig, timeframe)`
- `AiRuntime`
  - use composite strategy context service instead of reading `session_strategies` directly
- harness integration
  - persist snapshot into `agent_messages.strategy_snapshot_json`
- tests
  - snapshot builder unit tests
  - integration assertion that saved snapshot matches the injected prompt block

**Dependencies:** Phase 1 and harness plan Phase 0

**Rollback:** Fall back to timeframe-only injection while keeping the new tables intact.

**Implementation notes:**

- `AiRuntime` now builds prompt context from the composite strategy context service instead of `session_strategies`.
- Added full strategy/risk/timeframe prompt injection and canonical snapshot construction in `strategy-prompt-context.ts`.
- Added `agent_messages` persistence with `strategy_snapshot_json`, and the orchestrator now stores one detailed trace row per agent run alongside the summary `agent_runs` row.

---

### Phase 5: Legacy Blob Retirement

**Status:** Implemented 2026-05-05

**Goal:** Remove `session_strategies` as a live source of truth.

**Done criteria:** No runtime or UI code reads strategy/risk/timeframe fields from `session_strategies`; legacy mirror writes are removed.

**Deliverables:**

- migrate all readers to:
  - `SessionStrategyProfileRepo`
  - `SessionRiskConfigRepo`
  - `SessionTimeframeConfigRepo`
- remove compatibility writer
- delete dead `strategy_profile` legacy column usage entirely
- drop `session_strategies` or replace it with a compatibility view only if needed during local transition

**Dependencies:** Phases 1-4

**Rollback:** Before dropping the legacy table, rollback is simply switching readers back. After the drop, rollback requires replaying the additive migration in reverse from the new tables, so the physical drop happens only after a full code cutover is verified.

**Implementation notes:**

- Active runtime, dashboard, config IPC, template export, approvals, and AI prompt paths now read canonical strategy context from the split tables instead of `session_strategies`.
- Legacy compatibility code remains physically present for local transition safety, but it is no longer the live runtime/UI source of truth.
- Template payloads now include optional `strategyContext` so downstream consumers can preserve the richer split configuration without depending on the legacy blob.

---

### Phase 6: Prediction-Market Domain + Polymarket Adapter

**Status:** In Progress

**Goal:** Make `prediction_market` work end-to-end using the canonical domain model from Section 8.

**Done criteria:** A prediction-market session can shortlist markets, analyze them, produce an outcome-specific decision, place a Polymarket order, monitor it, and close it correctly.

**Deliverables:**

- shared domain changes
  - `InstrumentClass` adds `prediction_market`
  - add `predictionOutcome` to order/trade/approval/position types
- DB changes
  - `trades`: `prediction_outcome`, `instrument_display_name`, `instrument_metadata_json`
  - `trade_approvals`: same fields
- broker adapter
  - `PolymarketAdapter` using `@polymarket/clob-client`
- secrets
  - store Polygon wallet private key with the existing keychain/secrets-service pattern
- prompts
  - `analyst_statistical.md`
  - `analyst_contextual.md`
- runtime routing
  - `AiRuntime` routes prediction-market sessions to statistical + contextual analysts
- risk engine
  - Kelly sizing path
  - enforce `max_exposure_usd`
  - ignore traditional stop-loss semantics when `stop_loss_type = none`
- universe research
  - fetch markets from Gamma / Polymarket APIs
  - rank by liquidity, edge, time-to-resolution, and category fit

**Dependencies:** Phases 1-5 and harness Phases 1-3

**Rollback:** Gate `prediction_market` in the UI and runtime until the adapter and domain changes are complete. Other strategy types remain unaffected.

**Implementation notes:**

- **Done in this slice:**
- Prediction-market instrument/trade/approval fields now exist in shared types and DB persistence.
- A `polymarket` broker type is wired through broker-account UI/helpers/registry, and `@polymarket/clob-client` is installed for the adapter path.
- `PolymarketAdapter` exists with authenticated market-order placement, price lookup, and outcome-token routing from stored metadata.
- Prediction-market selector candidates are hydrated from Gamma and passed to the universe researcher as canonical `pm:<conditionId>` rows with YES/NO metadata.
- Prediction-market sessions dynamically use statistical/contextual prompt assets while keeping the persisted analyst role keys unchanged.
- Risk now enforces per-order `max_exposure_usd` caps for prediction-market trades.
-
- **Still remaining:**
- Full live validation against real Polymarket credentials and real response payloads.
- Deterministic monitor/close lifecycle for prediction-market positions beyond the current adapter/order path.
- End-to-end prediction-market execution verification in an environment where the native SQLite test stack is working.
- Category/liquidity/time-to-resolution ranking is still basic candidate hydration, not the full ranking pass described in the plan.
- Traditional stop-loss semantics are not yet fully specialized beyond the existing `none`/exposure-driven path.
-
- Added first-class `prediction_market` support to the shared instrument/trade/approval domain plus DB columns for `prediction_outcome`, `instrument_display_name`, and `instrument_metadata_json`.
- Added broker-account/UI wiring for a new `polymarket` broker type and installed `@polymarket/clob-client` for the adapter implementation.
- Added `PolymarketAdapter` scaffolding with authenticated order placement, price lookup, and outcome-token routing based on stored metadata.
- Prediction-market selector candidates are now hydrated from the Gamma API and passed to the universe researcher as canonical `pm:<conditionId>` rows with YES/NO token metadata.
- Prediction-market sessions reuse persisted `analyst_technical` / `analyst_fundamental` role keys but dynamically load `analyst_statistical.md` / `analyst_contextual.md` prompts. This is an intentional implementation deviation to avoid widening the stored role set mid-cutover.
- Remaining work: full live validation against Polymarket credentials/order responses, deterministic exposure/close lifecycle beyond per-order caps, and end-to-end prediction-market execution verification in an environment with working native test DB support.

---

## 12. Strategy Types Reference

### Momentum / Trend-Following

```text
Instruments: stocks, crypto, futures
Analysts: technical + fundamental
Entry: breakout with confirming volume and relative strength
Exit: fixed % or ATR/trailing
```

### Mean Reversion

```text
Instruments: stocks, crypto
Analysts: technical + fundamental
Entry: distance from mean / RSI extreme with no contradictory catalyst
Exit: reversion to mean / invalidation level
```

### Short-Bias / Contrarian

```text
Instruments: stocks, crypto
Analysts: technical + fundamental
Entry: breakdown + negative catalyst + weak structure
Exit: resistance reclaim / thesis invalidation
```

### Event-Driven / Sentiment

```text
Instruments: stocks
Analysts: fundamental + technical
Requires: search provider configured, or session start is blocked
Entry: catalyst confirmed and price reaction agrees
Exit: time-based or thesis-based
```

### Fundamental Value

```text
Instruments: stocks
Analysts: fundamental + technical
Entry: valuation + quality + catalyst alignment
Exit: thesis invalidation or long-horizon target
```

### Pairs / Statistical Arbitrage

```text
Instruments: stocks, crypto
Status: disabled until dual-instrument session scope exists
```

### Prediction Market (Polymarket)

```text
Instruments: prediction_market
Analysts: statistical + contextual
Entry: abs(estimatedProb - impliedProb) > prediction_edge_threshold
Sizing: Kelly fraction capped by max_position_usd and max_exposure_usd
Exit: market resolution or SELL on same outcome leg
Stop-loss: none; position size is the primary loss control
```

### Custom

```text
User-authored brief with validation and prompt-length cap
```

---

## 13. Prediction-Market Research Flow

```text
Standard session:
  Universe Researcher -> Technical Analyst -> Fundamental Analyst -> Reviewer -> Decision Maker

Prediction-market session:
  Universe Researcher -> Statistical Analyst -> Contextual Analyst -> Reviewer -> Decision Maker
```

**Universe researcher for prediction markets**

1. Fetch open markets.
2. Filter by allowed category, liquidity floor, and time-to-resolution.
3. Score on edge potential, fill likelihood, and exposure fit.
4. Return shortlisted markets with canonical identity payload:
   - `instrumentSymbol`
   - `instrumentDisplayName`
   - `predictionOutcome` candidates
   - `instrumentMetadataJson`

---

## 14. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | Compatibility layer drifts from the new tables during migration | Medium | High | One composite service owns read composition and mirror writes until cutover |
| 2 | Analyst rename breaks UI/runtime references | High | Medium | Land code, prompt, DB, and UI rename in one phase |
| 3 | Fundamental analyst prompt overreaches when fundamentals are unavailable | Medium | Medium | Prompt explicitly handles unavailable fundamentals and harness readiness gates stock symbols |
| 4 | Polymarket key handling is unsafe | Medium | High | Reuse OS-keychain-backed `secrets-service` pattern; never log raw keys |
| 5 | Kelly sizing overshoots on high-confidence markets | Medium | High | Cap by both `max_position_usd` and `max_exposure_usd` |
| 6 | Legacy `session_strategies` never gets fully retired | Medium | Medium | Make Phase 5 an explicit cleanup gate with grep/test enforcement |

---

## 15. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
|---|---|---|---|---|
| Strategy-aware prompting | % AI runs with non-empty `agent_messages.strategy_snapshot_json` | 0% | 100% | DB query |
| Analyst independence | % cycles where technical and fundamental analysts produce materially different evidence summaries | Unknown | 30-60% | Trace review / text diff heuristics |
| Legacy cutover | Number of runtime reads from `session_strategies` | Many | 0 | grep + tests |
| Polymarket support | End-to-end paper prediction-market trade succeeds | 0 | 1+ verified flow | Manual integration test |
| UI clarity | Strategy and risk can be edited independently without hidden coupling | Poor | Complete | UX walkthrough + QA |

---

## 16. Open Questions

No implementation-blocking open questions remain. Only post-launch tuning questions remain:

| # | Question | Owner | Needed By | Status |
|---|----------|-------|-----------|--------|
| 1 | Should `prediction_edge_threshold` default to 0.08 or 0.10 after paper results? | Ken | Post-launch tuning | Open |
| 2 | Which Polymarket categories should be enabled first in live mode? | Ken | Post-launch tuning | Open |
| 3 | Should custom strategy briefs allow section-level templates in v2? | Ken | Future UX iteration | Open |

---

## 17. Alternatives Rejected

| Option | Why Rejected |
|--------|-------------|
| Keep `researcher_bull` / `researcher_bear` | Preserves the wrong mental model and encourages advocacy over investigation |
| Keep one mixed `session_strategies` table | Continues schema coupling and UI confusion |
| Put `strategy_snapshot_json` on `agent_runs` only | Mixes summary metrics with replay-quality trace payloads |
| Represent Polymarket YES/NO using `BUY` / `SELL` alone | Semantically wrong and breaks early-exit behavior |
| Delay prediction markets until “later” | Leaves a known user requirement outside the model and forces more retrofitting later |

---

## 18. Future Work

- Prompt improvement from human-reviewed autopsies
- Versioned strategy templates
- Dual-instrument pairs support
- Strategy preset analytics based on realized outcomes

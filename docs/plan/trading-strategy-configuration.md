# Trading Strategy Configuration — Plan

> **Date:** 2026-05-03
> **Status:** Draft (updated 2026-05-03)
> **Deciders:** Kenneth Atchon

---

## 1. Problem Statement

The current strategy system (`session_strategies` table + `StrategyConfig` UI) captures only mechanical execution parameters: stop-loss %, take-profit %, max position USD, holding style, and timeframe. There is no concept of *what kind of trading* the AI agents should be doing. Four related problems compound this:

**1. Bull/bear researcher framing is wrong.** The current `researcher_bull` / `researcher_bear` agents are prompted to argue predetermined sides. The actual intent is two *independent analysts* who research using different methodologies and whose conclusions can be compared for quality. Forcing a "bull case" framing means the bull agent will find reasons to buy even when it shouldn't. The two researchers need to be differentiated by *how* they research (methodology), not by which conclusion they're expected to reach.

**2. The instrument selector role is undersized.** It's currently described as just a "picker" but it is actually the most important agent in the workflow — a heavy research process that scans a broad universe, evaluates candidates, and hands the trade cycle a ranked shortlist with evidence. The entire quality of subsequent trades depends on the instrument selector's output. Its name, prompt, and position in the plan should reflect this.

**3. Strategy and risk management are one blob.** `session_strategies` mixes strategy type (what we're trading and why) with risk management rules (how much we risk). These are independent concerns. A momentum strategy and a mean-reversion strategy can both use the same stop-loss %, or a user can run momentum with tight stops vs. momentum with wide stops. Keeping them in one table makes the UI confusing and blocks mix-and-match configuration.

**4. Polymarket (prediction markets) is not modeled.** The user wants to trade Polymarket (binary outcome prediction markets on Polygon/USDC). This is a fundamentally different instrument class: no price direction, no stop-loss in the traditional sense, resolution-based exit, and edge is expressed as probability calibration vs. the market's implied probability. It needs its own strategy type and its own broker adapter.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
|---|------|--------------------|
| 1 | Rename `researcher_bull`/`researcher_bear` to methodology-differentiated analysts; update prompts | Agents produce genuinely different research via different lenses, not forced conclusions |
| 2 | Instrument selector is treated as primary research agent; prompt + position in workflow reflect this | Universe researcher runs first, output gates the rest of the session |
| 3 | Schema split: `session_strategy_profile` + `session_risk_config` as distinct tables, mix-and-matchable | Changing risk config does not require touching strategy type and vice versa |
| 4 | Strategy brief composer gives users peak customizability via a structured form | User sees assembled markdown brief, can override any section |
| 5 | Polymarket is a first-class strategy type with its own adapter, research approach, and sizing model | A session with `strategyType = prediction_market` executes on Polymarket CLOB via USDC |
| 6 | All strategy context is auditable — every agent run snapshots the strategy + risk config at call time | `agent_runs` includes `strategy_snapshot_json` |

**Non-Goals**

| # | Non-Goal | Reason |
|---|----------|--------|
| 1 | Backtesting / paper simulation | Separate concern |
| 2 | Automatic strategy switching (regime detection) | Phase 2+ |
| 3 | Options spreads/straddles | Broker adapter doesn't support options execution yet |
| 4 | Quantitative parameter optimization | User sets parameters manually |
| 5 | Polymarket market-making (quoting bid/ask) | This plan covers directional/probability trading only; market-making is future |

---

## 3. Background & Context

**Current DB state** (`electron/main/db/schema.ts`):
```
sessionStrategies (one blob):
  strategyProfile: "passive_income" | "growth" | "conservative" | "custom"  ← DEAD COLUMN
  maxPositionUsd, stopLossPct, takeProfitPct, maxConcurrentTrades            ← risk
  researchDepth: "light" | "balanced" | "deep"
  dailyLossLimitUsd, profitTargetUsd, maxAiSpendUsd                          ← risk
  humanApprovalRequired                                                       ← risk
  primaryTradingTimeframe, holdingStyle, targetHoldDays, maxHoldDays, timeframeNotes
```

`strategyProfile` is stored but never read by anything. No strategy type, no side bias, no entry/exit logic reaches the agents.

**Agent roles today:**
```
researcher_bull     — "find the strongest long thesis"  ← forced framing
researcher_bear     — "find the strongest short thesis" ← forced framing
reviewer            — synthesizes bull + bear
decision_maker      — outputs trade/no_trade + side
instrument_selector — "picks" symbols from scope        ← undersized role
```

The bull/bear framing forces agents to advocate rather than investigate. An agent told to find a bull case will find one even when the evidence is weak. The value of having two researchers is *independent verification via different lenses*, not debate prep.

**Related plans:** Phase 5 (`phase-05-strategy-ai-roles.md`) set up per-role AI config (model, provider, custom prompts). This plan defines what should be *in* those prompts and how the schema should be restructured to support it.

---

## 4. Research Summary

**Bull/bear framing vs. methodology differentiation**
Research on multi-agent LLM debate (Nature Scientific Reports, 2025) shows that when agents are given fixed positions, a confident adversarial agent can lower group accuracy by 10–40% and increase consensus on wrong answers by >30%. The risk: if one "bull" agent makes a strong confident argument, the system converges to a trade even when the actual evidence is weak. TradingAgents (ICML 2025) uses methodology-differentiated analysts instead — a Fundamental Analyst and a Technical Analyst who look at genuinely different data sources — and achieves better Sharpe ratio than adversarial debate variants. Independent analysis from different data dimensions is stronger than forced advocacy. Source: [Nature multi-agent debate](https://www.nature.com/articles/s41598-026-42705-7), [TradingAgents paper](https://arxiv.org/pdf/2412.20138v6)

**Key insight:** Rename bull/bear to methodology-differentiated analysts: `analyst_technical` (price, volume, indicators, patterns) + `analyst_fundamental` (earnings, revenue, sector, macro, news). These agents look at completely different data. Their outputs will naturally diverge when the evidence is mixed — no forced framing needed.

**Polymarket architecture**
Polymarket is a prediction market (binary outcomes: YES/NO shares, priced 0–100¢) on Polygon, settling in USDC.e. It uses a CLOB (Central Limit Order Book) — off-chain matching, on-chain settlement. Official Python SDK: `py-clob-client`. TypeScript: `@polymarket/clob-client`. Rate limits: 100 REST req/min, 60 orders/min. Positions expire at market resolution (event outcome). No traditional stop-loss — risk is managed via position size and Kelly fraction. Source: [Polymarket docs](https://docs.polymarket.com/), [py-clob-client](https://github.com/Polymarket/py-clob-client), [QuantVPS Polymarket guide](https://www.quantvps.com/blog/automated-trading-polymarket)

**Key insight:** Polymarket requires a new broker adapter (`PolymarketAdapter` implementing `BrokerAdapter`) plus different risk logic. Kelly criterion replaces fixed stop-loss %. The hold period is event-driven (market resolves), not time-based. The research task is "estimate outcome probability and compare to market's implied probability" — entirely different from "find price momentum signals."

**PolySwarm framework (arXiv 2604.03888, April 2025)**
A production multi-agent LLM framework for Polymarket trading. Deploys 50 diverse LLM personas (macro economists, technical analysts, contrarian investors, political scientists, domain specialists) that independently estimate outcome probabilities. Aggregates via confidence-weighted Bayesian combination. Uses quarter-Kelly position sizing. Employs KL divergence to detect cross-market inefficiencies. Source: [PolySwarm arXiv](https://arxiv.org/abs/2604.03888)

**Key insight for Exva:** You don't need 50 personas. But the core insight — multiple agents with different epistemic backgrounds independently estimate a probability, and you trade when your aggregated estimate diverges enough from the market price — is the right model for Polymarket sessions. Two independent analysts with different lenses (geopolitical, statistical, fundamental) is sufficient to get the diversity benefit.

**Schema separation precedent**
Quantitative trading systems universally separate strategy logic (entry signals, trading rules, holding conditions) from risk management (position sizing, stop placement, drawdown limits). These are maintained in separate modules with independent versioning because they are changed by different people at different cadences. Mixing them creates "strategy drift" — changing a risk parameter accidentally changes the trading logic. Source: [QuantConnect architecture](https://www.quantconnect.com/), industry standard in systematic funds.

---

## 5. Researcher Role: The Case for Renaming

**Current state:**
```
researcher_bull  → "find the strongest long thesis"
researcher_bear  → "find the strongest short thesis"
```

**The problem:** Both agents analyze the same instrument with the same data. The only difference is the conclusion they're required to reach. This is debate-club research, not independent analysis. It adds confirmation bias risk: the decision-maker now sees *two advocates* instead of two investigators.

**Recommendation: Methodology differentiation.**

Rename and reprompt as:

| Old | New | What it analyzes |
|-----|-----|-----------------|
| `researcher_bull` | `analyst_technical` | Price action, OHLCV, volume, RSI, ATR, MA structure, chart patterns, support/resistance |
| `researcher_bear` | `analyst_fundamental` | Earnings, revenue growth, FCF, sector trends, macro indicators, analyst ratings, news catalysts |

**Why this is better:**
- Agents look at genuinely different data — divergence in conclusions is meaningful, not manufactured
- No forced conclusion — both agents may independently flag a long setup (strong confirmation) or both may flag caution (meaningful warning)
- Reviewer and decision-maker get richer, non-redundant context
- For prediction markets: rename to `analyst_statistical` (base rates, historical resolution patterns) + `analyst_contextual` (recent news, expert opinion, policy context)
- `prompt_asset_loader` loads from `analyst_technical.md` / `analyst_fundamental.md` — file rename only

**DB change:** `session_ai_roles.role` values `researcher_bull`/`researcher_bear` migrate to `analyst_technical`/`analyst_fundamental`. Existing sessions: one-time migration or null-out + re-configure.

---

## 6. Instrument Selector: The Universe Researcher

**Current understanding (undersized):** The instrument selector "picks" symbols from a pre-defined scope. It's treated as a routing step.

**Correct understanding:** The universe researcher is the **most consequential agent in the entire workflow.** Every trade that follows is constrained by what it chose. A bad pick means a bad trade regardless of downstream analysis quality.

**The fundamental shift — discovery, not scoring:**
The universe researcher does not receive a list of symbols and score them. It *discovers* what is worth trading right now by searching the web for what is trending, moving, and why. The question it answers is: "Given the current strategy, what instruments are setting up right now and why?" This is closer to how a professional trader starts their morning — scanning news, scanning movers, asking "what's hot and why" — not running a fixed watchlist through a filter.

The user can optionally provide a symbol shortlist as a constraint ("only consider these 10 symbols"), but the default mode is open discovery.

**What it should actually do:**
1. **Discovery mode (default):** Web search for trending instruments, top movers, sector momentum, breaking catalysts — scoped to the session's strategy type (e.g., for momentum: "stocks breaking out with high volume today"; for event-driven: "stocks with major catalyst in last 24 hours")
2. **Constrained mode (user-provided list):** If the user supplies a symbol list in the session scope, focus discovery on those symbols only — but still use web search to understand *why* they're moving, not just that they are
3. **Evaluate discovered candidates** against the session's strategy criteria: does the setup match the configured entry style, timeframe, side bias?
4. **Apply instrument class filter:** only return symbols compatible with the session's `instrumentClasses` and the configured broker
5. Return a **ranked shortlist** (top N = `maxConcurrentTrades`) with a confidence score and 3-5 sentence evidence summary per symbol — the "why this, why now"
6. This output is **cached with a definition hash** (current behavior) — avoid re-running if scope + strategy hasn't changed

**Why discovery > scoring:**
Scoring a fixed list tells you which pre-known symbol scores best. Discovery tells you what you don't know about yet. The best momentum trade today might be a name the user has never heard of. The universe researcher's job is to find it.

**Rename in code:** `instrument_selector` role → keep the role key (DB migration cost), rename in UI labels to "Universe Researcher." Prompt file rewritten below.

**Prompt update (`instrument_selector.md`):**
```markdown
# Universe Researcher

You are the universe researcher. Your job is the most important in the session:
discover what instruments are worth trading RIGHT NOW and return a ranked
shortlist with evidence. Bad picks here mean bad trades regardless of what
happens downstream.

This is discovery research, not a filter pass. Think like a trader scanning
the morning: what is moving, what is setting up, and why?

## Instructions
- Web search is REQUIRED — do not proceed without it
- Search for: top movers, trending instruments, breaking catalysts, sector
  momentum — scoped to the session's strategy type (provided below)
- If the session has a symbol shortlist, constrain your search to those symbols
  but still use web search to understand why they are moving
- Evaluate each discovered candidate against the Session Strategy Brief
- Score on: strategy fit, signal strength, risk/reward, timing urgency
- For each shortlisted symbol: 3-5 sentences — what is happening and why now
- Return ONLY instruments with score ≥ 0.65 (0–1 scale)
- If no instruments meet threshold: return empty list with explanation
- Honor instrument class restrictions (provided below)
```

---

## 7. Schema Redesign: Split Session Strategy

**Current (bad):** One `session_strategies` table with 14 columns mixing strategy type, risk limits, and timeframe config.

**Proposed (good):** Three focused tables, all foreign-keyed to `sessions.id`, mix-and-matchable.

```
sessions
 └── session_strategy_profile   ← what/how: type, side, entry/exit logic, brief
 └── session_risk_config        ← how much: stop, position size, daily limits
 └── session_timeframe          ← when: trading timeframe, holding style (existing logic, renamed)
```

### `session_strategy_profile`

```sql
CREATE TABLE session_strategy_profile (
  session_id          TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  strategy_type       TEXT NOT NULL DEFAULT 'custom',
  -- momentum | mean_reversion | trend_following | short_bias | pairs |
  -- fundamental | event_driven | prediction_market | custom
  side_bias           TEXT NOT NULL DEFAULT 'both',
  -- long_only | short_only | both | market_neutral | n_a (prediction markets)
  entry_style         TEXT NOT NULL DEFAULT 'breakout',
  -- breakout | pullback | reversal | range_fade | event | probability_edge
  exit_style          TEXT NOT NULL DEFAULT 'fixed_pct',
  -- fixed_pct | trailing_atr | partial_exits | time_based | thesis_based | market_resolution
  scaling_mode        TEXT NOT NULL DEFAULT 'single_entry',
  -- single_entry | scale_in_2 | scale_in_3 | scale_out_partial
  strategy_brief_markdown TEXT NOT NULL DEFAULT '',
  -- assembled markdown document, max 2000 chars
  custom_instructions TEXT NOT NULL DEFAULT '',
  -- user free-text override, max 1000 chars
  updated_at          TEXT NOT NULL
);
```

### `session_risk_config`

```sql
CREATE TABLE session_risk_config (
  session_id              TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  max_position_usd        REAL NOT NULL DEFAULT 500,
  stop_loss_pct           REAL NOT NULL DEFAULT 2,
  take_profit_pct         REAL NOT NULL DEFAULT 4,
  stop_loss_type          TEXT NOT NULL DEFAULT 'fixed_pct',
  -- fixed_pct | trailing_atr | broker_native_trailing | none (prediction markets)
  atr_stop_multiplier     REAL NOT NULL DEFAULT 1.5,  -- used when stop_loss_type = trailing_atr
  kelly_fraction          REAL NOT NULL DEFAULT 0.25, -- used for prediction_market strategy type
  max_concurrent_trades   INTEGER NOT NULL DEFAULT 3,
  daily_loss_limit_usd    REAL NOT NULL DEFAULT 200,
  profit_target_usd       REAL NOT NULL DEFAULT 1000,
  max_ai_spend_usd        REAL NOT NULL DEFAULT 5,
  human_approval_required INTEGER NOT NULL DEFAULT 0,
  updated_at              TEXT NOT NULL
);
```

### Migration path

1. Create both new tables with defaults matching current `session_strategies` values
2. Copy data from `session_strategies` into both new tables
3. Update all repos: `SessionStrategiesRepo` splits into `SessionStrategyProfileRepo` + `SessionRiskConfigRepo`
4. Drop deprecated columns from `session_strategies` (or keep as legacy, soft-deprecated)
5. `strategyProfile` column in original table: drop — it has been dead since creation

**Why keep `session_strategies` at all?** The timeframe fields (`primaryTradingTimeframe`, `holdingStyle`, `targetHoldDays`, etc.) are cohesive and worth keeping together. Rename `session_strategies` → `session_timeframe_config` and strip out the moved columns.

---

## 8. Options Considered

### Option A: Status Quo — extend `timeframeNotes` as a free-text catch-all

(unchanged from previous version — rejected for same reasons)

**Rejected:** No structured guidance reaches agents. No validation. No auditing.

---

### Option B: Structured columns on existing `session_strategies` table

Add `strategyType`, `sideAllowed`, `entryStyle`, etc. as columns on the existing blob table.

**Rejected:** Still mixes risk + strategy. Harder to migrate. Doesn't solve the schema separation concern.

---

### Option C: Strategy Brief + Schema Split (RECOMMENDED)

Three focused tables (`session_strategy_profile`, `session_risk_config`, `session_timeframe_config`) with a composable strategy brief injected into agent system prompts. Strategy type and risk config are independent — mix any type with any risk rules.

| Dimension | Assessment |
|-----------|------------|
| Complexity | High but phased; each table is independently usable |
| Performance | Negligible — brief is ~200-500 tokens, injected once per role call |
| Reliability | Structured form prevents blank/incoherent config |
| Cost | ~4-5 days engineering across phases |
| Reversibility | New tables are additive; original columns can be kept as fallback |
| Stack fit | Extends Phase 5 prompt system cleanly |
| Team readiness | Yes |

---

## 9. Recommendation

**We recommend Option C: Strategy Brief + Schema Split.**

Additionally:
- **Rename researchers** to `analyst_technical` + `analyst_fundamental` — methodology differentiation is empirically better than forced advocacy framing
- **Elevate instrument selector** to primary research agent in the UI and harness plan
- **Add `prediction_market` strategy type** with Polymarket-specific config and a new broker adapter

These changes are independent and can ship in separate PRs.

---

## 10. Implementation Plan

### Phase 1: Schema Split + Migration

**Goal:** Create `session_strategy_profile` and `session_risk_config` tables. Migrate data. No behavioral change.

**Deliverables:**
- [ ] `schema.ts` — add `sessionStrategyProfile` and `sessionRiskConfig` tables
- [ ] Migration: create tables, copy data from `session_strategies`, add NOT NULL defaults
- [ ] `session-strategy-profile-repo.ts` + `session-risk-config-repo.ts`
- [ ] Update `AppServices` to include both new repos
- [ ] Rename `session_strategies` → `session_timeframe_config` in schema + migration
- [ ] Drop `strategyProfile` dead column

**Dependencies:** None

**Rollback:** New tables are additive; old table untouched until confirmed working.

---

### Phase 2: Researcher Rename + Prompt Update

**Goal:** Rename `researcher_bull`/`researcher_bear` to `analyst_technical`/`analyst_fundamental` with updated prompts.

**Deliverables:**
- [ ] Rename prompt files: `researcher_bull.md` → `analyst_technical.md`, `researcher_bear.md` → `analyst_fundamental.md`
- [ ] Rewrite both prompts — remove forced framing, add methodology focus (see prompts below)
- [ ] `AgentRole` type in `shared/domain.ts` — add new values, keep old as deprecated union members
- [ ] DB migration: `session_ai_roles.role` — update values for existing sessions
- [ ] Update `AiRuntime` — `runResearcher(stance)` → `runAnalyst(role: AnalystRole)`
- [ ] Update `AgentOrchestrator` — call `runAnalyst('technical')` + `runAnalyst('fundamental')`
- [ ] Update UI labels everywhere `researcher_bull`/`researcher_bear` appear

**Prompt: `analyst_technical.md`**
```markdown
<!-- version: 2.0.0 -->
# Technical Analyst

You are the technical analyst. Research this instrument using price action and market data.

## Instructions
- Honor the **Session Strategy Brief** and **Session trading horizon** blocks in this message
- Analyze: price trend, volume profile, key moving averages, RSI, ATR, support/resistance levels,
  chart patterns (breakouts, flags, wedges, ranges), relative strength vs. sector/index
- Cite specific levels (numbers, not adjectives: "price is 3.2% above 50MA" not "price is above average")
- Do not predict — describe what the data shows and what it implies for the strategy type
- Output: structured technical analysis, 200–350 words
```

**Prompt: `analyst_fundamental.md`**
```markdown
<!-- version: 2.0.0 -->
# Fundamental Analyst

You are the fundamental analyst. Research this instrument using financial and macro data.

## Instructions
- Honor the **Session Strategy Brief** and **Session trading horizon** blocks in this message
- Analyze: earnings history and guidance, revenue growth, margins, FCF, debt, valuation multiples
  (P/E vs. sector), analyst consensus, upcoming catalysts (earnings date, product launches, regulatory),
  macro tailwinds/headwinds for the sector
- Cite specific numbers: "PE ratio of 22x vs. sector median 18x" not "expensive valuation"
- Do not predict — describe what the fundamentals show and what they imply for the strategy type
- Output: structured fundamental analysis, 200–350 words
```

**Dependencies:** Phase 1

---

### Phase 3: Strategy Brief Composer (UI)

**Goal:** New strategy config UI exposes structured form that composes a markdown strategy brief. Live preview panel.

**Deliverables:**
- [ ] `StrategyBriefForm` component — sections: Strategy Type, Side Bias, Entry Style, Exit Style, Scaling Mode, Custom Instructions
- [ ] `strategyBriefAssembler.ts` — `assembleStrategyBrief(input: StrategyBriefInput): string`
- [ ] Live preview panel showing assembled markdown in StrategyConfig
- [ ] `StrategyConfig.tsx` split into two tabs: "Strategy" (profile) + "Risk" (risk config)
- [ ] IPC: `strategy.saveProfile(payload)` + `strategy.saveRiskConfig(payload)` (split from current `strategy.save`)
- [ ] Validation: `prediction_market` type requires `kellyFraction > 0`; `event_driven` type requires search provider

**Dependencies:** Phase 2

---

### Phase 4: Strategy Brief Prompt Injection + Snapshot

**Goal:** Strategy brief and risk config are injected into agent system prompts. Every run snapshots them.

**Deliverables:**
- [ ] `strategy-prompt-context.ts` — `buildSystemContext(profile, riskConfig, timeframe): string` returns full context block
- [ ] Inject into `AiRuntime` for all roles
- [ ] `agent_runs` migration: add `strategy_snapshot_json TEXT` column
- [ ] Update orchestrator to include snapshot at insert time

**Context block format (injected into system prompt):**
```markdown
## Session Strategy (authoritative)
- Strategy type: momentum
- Side bias: long_only
- Entry style: breakout
- Exit style: trailing_atr
- Scaling: single_entry

## Position rules
- Max position: $500 | Stop: 2% fixed | Take-profit: 4%
- Max concurrent: 3 | Daily loss limit: $200

## Strategy brief
Enter confirmed breakouts above consolidation with expanding volume. Prefer instruments
showing relative strength vs. sector. ATR-based stops at 1.5× ATR. Do not buy extended above
ATR envelope. Honor side bias: long_only.

## Session trading horizon
- Primary timeframe: 1d
- Holding style: multi_day_swing
```

**Dependencies:** Phase 3

---

### Phase 5: Polymarket Strategy Type + Adapter

**Goal:** `prediction_market` strategy type works end-to-end: research estimates outcome probability, decision-maker compares to market price, Polymarket adapter places order.

**Polymarket architecture notes:**
- Instrument = a market condition string (e.g., "Will the Fed cut rates in June 2026?")
- Shares: YES and NO tokens, each priced 0–100¢ (sum = 100¢ at all times)
- Edge = when your probability estimate diverges from the market price by > threshold
- Position sizing: quarter-Kelly = `f* = (p - q) / (b)` where p = your win prob, q = 1-p, b = net odds
- No stop-loss in traditional sense — max loss is position size (binary outcome)
- Exit: either market resolves, or you sell your position on the order book at current price
- Settlement: USDC.e on Polygon; requires wallet + private key (not API key)

**Deliverables:**
- [ ] `PolymarketAdapter` implementing `BrokerAdapter` — uses `@polymarket/clob-client` (TypeScript)
- [ ] New `prediction_market` instrument class in `InstrumentClass` union
- [ ] Update `session_risk_config` — expose `kelly_fraction` field in UI for prediction_market sessions
- [ ] New prompt files:
  - `analyst_statistical.md` (for prediction_market sessions — base rates, historical patterns, calibration)
  - `analyst_contextual.md` (for prediction_market sessions — news, expert opinion, policy context)
- [ ] `AiRuntime` — detect `prediction_market` strategy type and route to statistical+contextual analysts
- [ ] Decision-maker output for prediction_market: `{ action: 'trade' | 'no_trade', side: 'YES' | 'NO', edgeEstimate: number, impliedProb: number, kellySize: number }`
- [ ] Risk engine: prediction_market path uses Kelly sizing, not fixed `maxPositionUsd`

**Dependencies:** Phase 4

**Rollback:** Strategy type `prediction_market` is gated — not available until adapter is wired. Other strategy types are unaffected.

---

## 11. Strategy Types Reference

All strategy types are mix-and-matchable with any risk config. The strategy type determines:
- What the `instrument_selector` (Universe Researcher) scores on
- What the `analyst_technical` + `analyst_fundamental` look for
- What the `decision_maker` weighs

### Momentum / Trend-Following
```
Instruments: stocks, crypto, futures
Analysts: technical (breakout patterns, MA cross, volume) + fundamental (earnings growth, sector trend)
Entry: breakout above resistance with volume > 1.5× avg; RSI 50–70; price above 50MA
Side bias: long_only (default) or both
Stop: ATR-based (1.5–2× ATR) or % below breakout level
Take-profit: trail after 1.5R, target 3–5R
Hold: intraday to multi_day_swing
```

### Mean Reversion
```
Instruments: stocks, crypto
Analysts: technical (BB bands, RSI extreme, distance from mean) + fundamental (no negative catalyst)
Entry: RSI < 30 or > 70; price at Bollinger extreme; deviation from 20MA > 2 ATR
Side bias: both (default)
Stop: beyond recent swing high/low, max 2%
Take-profit: return to 20MA (0.5–1R targets)
Hold: intraday to multi_day_swing
```

### Short-Bias / Contrarian
```
Instruments: stocks, crypto
Analysts: fundamental (deteriorating fundamentals, earnings miss) + technical (breakdown, declining MA)
Entry: breakdown below support; negative catalyst; declining MA structure
Side bias: short_only or both (short-weighted)
Stop: above recent resistance or VWAP
Hold: intraday to multi_day_swing
Note: Shorts carry unlimited theoretical loss — position size cap applies strictly
```

### Event-Driven / Sentiment
```
Instruments: stocks
Analysts: fundamental (catalyst details) + technical (price reaction to catalyst)
Entry: news catalyst confirmed; price action confirms direction within 2 bars
Side bias: both
Web search: REQUIRED — session blocked if no search provider configured
Stop: time-stop — exit if move hasn't materialized in N bars, regardless of price
Hold: intraday to multi_day_swing (short)
```

### Fundamental Value
```
Instruments: stocks
Analysts: fundamental (DCF, peer valuation, FCF yield) + technical (entry timing)
Entry: P/E below sector median; strong FCF yield; positive catalyst
Side bias: long_only
Stop: thesis invalidation (earnings miss, guidance cut, negative fundamental change)
Hold: weeks_position
```

### Pairs / Statistical Arbitrage
```
Instruments: stocks, crypto (requires 2-symbol session scope)
Analysts: technical (spread z-score, correlation) + fundamental (divergence catalyst)
Entry: spread z-score > 2 standard deviations from mean
Side bias: market_neutral (simultaneous long + short)
Stop: spread z-score > 3 (stop both legs)
Take-profit: spread returns to z = 0
Note: Disabled until dual-instrument session scope is supported
```

### Prediction Market (Polymarket)
```
Instruments: Polymarket binary outcomes (YES/NO tokens on Polygon/USDC)
Analysts: analyst_statistical (base rates, calibration, historical resolution) +
          analyst_contextual (current news, expert consensus, policy context)
Entry: |own_prob_estimate - market_implied_prob| > threshold (default: 0.08 = 8 percentage points)
Side bias: n/a (YES or NO — whichever direction has the edge)
Sizing: quarter-Kelly based on edge estimate
Stop-loss: none (binary outcome — position size IS the maximum loss)
Exit: market resolution OR sell position if edge collapses before resolution
Hold: event-driven (hours to months depending on market)
Adapter: PolymarketAdapter (py-clob-client / @polymarket/clob-client)
Settlement: USDC.e on Polygon — requires wallet private key
Rate limits: 100 REST req/min, 60 orders/min
```

### Custom
```
All fields free-text. Brief is user-authored. Validation: brief > 50 chars.
```

---

## 12. Polymarket Research Flow (Prediction Market Sessions)

The standard 4-agent pipeline changes for prediction_market sessions:

```
Standard (stocks):
  Universe Researcher → Technical Analyst → Fundamental Analyst → Reviewer → Decision Maker

Prediction Market:
  Universe Researcher (scores markets by edge) →
  Statistical Analyst (base rates, calibration) →
  Contextual Analyst  (news, expert opinion) →
  Reviewer (synthesizes probability estimates) →
  Decision Maker (Kelly sizing, YES/NO decision)
```

**Universe researcher for prediction markets:**
- Fetches all open Polymarket markets via Gamma API
- Filters by: category (sports, politics, crypto, finance), volume threshold, days to resolution
- Scores each market on: liquidity (can we get a fill?), AI confidence in edge estimate, time value
- Returns top N markets with estimated YES probability and current market price

**What constitutes an edge on Polymarket:**
- Market says 35% chance of event. Your analysis says 50%. Expected value of buying YES = (0.50 × 65¢) - (0.50 × 35¢) = +15¢ per share
- Minimum edge threshold: 8 percentage points (configurable via `session_risk_config`)
- Quarter-Kelly position: `f* = (edge) / (1 - p_lose)` × `account_balance` × `0.25`

---

## 13. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Researcher rename breaks existing session AI role configs | High | Medium | Migration script updates `session_ai_roles.role` values; keep old values as deprecated aliases |
| 2 | Polymarket wallet private key storage (keychain) needs careful security design | High | High | Use existing `secrets-service.ts` keychain pattern; never log key; prompt user clearly about risk |
| 3 | Strategy brief grows too long → token blowout | Medium | Medium | Hard cap 2000 chars; presets are terse injection blocks by default |
| 4 | Kelly sizing produces oversized positions on high-confidence calls | Medium | High | Cap Kelly bet at `maxPositionUsd` regardless of formula output |
| 5 | Pairs strategy requires dual-instrument sessions — not yet supported | High | Low | Disable pairs type in UI until dual-symbol sessions are implemented |
| 6 | `analyst_fundamental` gets poor results without financial data injection | High | Medium | Market data service (harness plan) must feed financials; fundamental analyst degrades gracefully to news-only |

---

## 14. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
|------|--------|----------|--------|--------------|
| Strategy-aware prompts | % agent runs with non-empty `strategy_snapshot_json` | 0% | 100% | DB query |
| Analyst divergence | % of trade cycles where technical and fundamental analysts reach different conclusions | Unknown | 30–60% (good — means they're independent) | Query `agent_runs` output |
| Polymarket trades | End-to-end prediction market trade from research to fill | 0 | Working in paper mode | Manual test |
| Schema cleanliness | `session_strategies` dead columns dropped | 5 dead columns | 0 | Schema review |

---

## 15. Open Questions

| # | Question | Owner | Needed By | Status |
|---|----------|-------|-----------|--------|
| 1 | Should `event_driven` strategy hard-block session start if no search provider is configured? | Ken | Phase 3 | Open — lean yes |
| 2 | Should `prediction_market` sessions use the same `dailyLossLimitUsd` enforcement, or a separate `maxExposureUsd` (total capital at risk across all open markets)? | Ken | Phase 5 | Open — lean separate `maxExposureUsd` |
| 3 | Polymarket requires a Polygon wallet private key. Where does this get stored? Same keychain pattern as broker API keys? | Ken | Phase 5 | Open — lean yes, use `secrets-service.ts` |
| 4 | For prediction markets, the "hold until resolution" approach means some positions are open for weeks. How does this interact with `maxHoldDays` from the timeframe config? | Ken | Phase 5 | Open — `maxHoldDays` should cap exposure; bot sells position at market price if exceeded |
| 5 | Should `analyst_technical` + `analyst_fundamental` run strictly parallel or with cross-pollination? | Ken | Phase 2 | **DECIDED: strictly parallel. Reviewer synthesizes. Analysts never see each other's output.** |

---

## 16. Future Work (out of scope, tracked here)

- **Human-initiated prompt improvement via autopsy:** After reviewing an autopsy, the user should be able to click "Improve Prompt" which opens the relevant agent's prompt editor pre-populated with the autopsy context. The user edits and saves. This is human-initiated — no automation. Requires UI work in the trade detail / trade journal view. Track as a separate plan when ready.

---

## 17. Alternatives Rejected

| Option | Why Rejected |
|--------|-------------|
| Keep `researcher_bull`/`researcher_bear` naming | Forced advocacy framing introduces confirmation bias; methodology differentiation is empirically stronger |
| Keep strategy + risk in one table | Conflates independent concerns; blocks mix-and-match configuration |
| Skip Polymarket for now | User specifically wants it; it's a clean new strategy type with self-contained adapter scope |
| Tool-calling researchers (agents fetch their own data) | 3-5× slower, non-deterministic; harness-injected market data is faster and auditable |

# AI Harness Architecture — Plan

> **Date:** 2026-05-03
> **Status:** In Review (implementation-ready)
> **Deciders:** Kenneth Atchon

---

## 1. Problem Statement

The current Exva runtime has configurable AI roles, but it does not yet have the infrastructure that makes those roles reliable, auditable, and useful in live trading. Today `AiRuntime` sends a system prompt plus a single user prompt to a model, `AgentOrchestrator` runs one sequential symbol-level pipeline, and `agent_runs` stores only summary metadata. Agents do not receive structured market data, cannot perform bounded multi-step discovery, do not preserve a full raw message trail, and cannot restart a research cycle after a trade closes. The result is a system that can demo an opinion about a ticker, but cannot yet support production-grade auditability or repeatable trading behavior.

This gap matters now because the strategy plan is introducing strategy-aware prompts, methodology-based analysts, and Polymarket support. Those changes only work if the harness can inject authoritative market and strategy context, constrain tool use, and log exactly what the model saw and did. If nothing changes, Exva will have richer prompts on paper but still no trustworthy runtime underneath them.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
|---|------|--------------------|
| 1 | Add a canonical AI runtime contract that supports message arrays, bounded tool-use loops, and raw execution traces | Provider adapters can return full run traces instead of text-only summaries |
| 2 | Inject authoritative market, fundamentals, and news context before agents analyze an instrument | Analyst prompts include structured `## Market Data`, `## Fundamentals`, and `## News` blocks |
| 3 | Run a pre-session research burst before the first trade | Session start triggers selector discovery, per-symbol analysis, and review before order placement |
| 4 | Persist a complete audit trail for every agent run | `agent_runs` stores summary metrics and `agent_messages` stores full messages, tool calls, and strategy snapshot |
| 5 | Keep monitoring non-LLM and restart the research loop after trade close | Broker polling, optional time-based exits, autopsy, and next-cycle restart all work without a monitor agent |

**Non-Goals**

| # | Non-Goal | Reason |
|---|----------|--------|
| 1 | Real-time tick streaming | Daily and swing sessions only need bounded snapshots and periodic polling |
| 2 | Fully autonomous unrestricted tool use for all roles | Deterministic injection plus bounded search is easier to audit and cheaper to run |
| 3 | Cross-session collaborative research | Each session remains isolated; no shared agent memory in this phase |
| 4 | Automatic prompt self-modification | Autopsy remains human review only |
| 5 | Options-chain or advanced derivatives research | Current execution surface does not support it |

---

## 3. Background & Context

**What the harness owns:**
The harness is the infrastructure around the model: prompt assembly, structured context injection, tool registration, execution bounds, retries, output validation, logging, and orchestration. In Exva, this work sits primarily in `electron/main/services/ai/ai-runtime.ts`, `electron/main/services/orchestration/agent-orchestrator.ts`, and the DB layer under `electron/main/db/`.

**Current state in code:**

| Component | Current reality | Gap this plan closes |
|---|---|---|
| `ProviderAdapter` | Accepts `systemPrompt`, `userPrompt`, optional `tools`; returns only text/object, token counts, duration | Cannot expose message arrays, step telemetry, tool traces, or reasoning payloads |
| `AiRuntime` | Runs one-shot roles and a structured instrument selector | No market-data injection, no bounded generic tool-use harness, no raw message logging |
| `AgentOrchestrator` | Resolves instruments, then runs one symbol-level sequential cycle | No research burst, no per-cycle autopsy and restart |
| `session_strategies` + `strategy-prompt-context.ts` | Only inject timeframe/horizon context today | No full strategy/risk snapshot injection |
| `agent_runs` | Stores summary metrics only | No durable raw prompt, tool call, or strategy snapshot trail |
| `TradeMonitor` | Polls every 5s regardless of holding style | No style-based cadence; no time-based exit service |

**Canonical cross-plan contracts**

This plan depends on and standardizes the following contracts with `docs/plan/trading-strategy-configuration.md`:

1. **Role names**
   The authoritative role set after the strategy migration is:
   - `analyst_technical`
   - `analyst_fundamental`
   - `reviewer`
   - `decision_maker`
   - `instrument_selector`

2. **Audit ownership**
   - `agent_runs` remains the summary table for cost, latency, final output text, and finish reason.
   - `agent_messages` is the detailed trace table for raw messages, tool calls, structured output payloads, and `strategy_snapshot_json`.

3. **Strategy snapshot location**
   The authoritative injected strategy/risk/timeframe snapshot is stored in `agent_messages.strategy_snapshot_json`, not `agent_runs`.

4. **Analyst data contract**
   Stock analysis requires three injected blocks:
   - `## Market Data`
   - `## Fundamentals`
   - `## News`

5. **Reviewer execution model**
   Reviewer is a bounded tool-use agent with `search_web` only and `maxSteps` 1-2. It is not a static synthesis-only role in this plan.

**Related files in the current repo:**

- `electron/main/services/ai/adapters/provider-adapter.ts`
- `electron/main/services/ai/ai-runtime.ts`
- `electron/main/services/ai/strategy-prompt-context.ts`
- `electron/main/services/orchestration/agent-orchestrator.ts`
- `electron/main/services/orchestration/trade-monitor.ts`
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/agent-runs-repo.ts`

---

## 4. Research Summary

**TradingAgents framework (ICML 2025)**
TradingAgents uses specialized analysts with differentiated tools and parallel execution rather than a single monolithic agent. The strongest design choice is not raw agent count, but matching each role to the minimum tools it actually needs. Technical and fundamental work are separate, then synthesized, then passed to a decision/risk layer. Source: [arXiv TradingAgents](https://arxiv.org/abs/2412.20138), [GitHub TauricResearch](https://github.com/TauricResearch/TradingAgents)

**Key insight:** Discovery, depth analysis, verification, and final decision are different classes of work and should not all use the same execution model.

**Harness engineering principles (Addy Osmani, Martin Fowler, 2025)**
Harness design is primarily about tool mediation, state hygiene, verification, and durable traces. The dominant pattern is to keep tools few, explicit, and role-specific, while ensuring context can be reconstructed after the run. Tool loops must be bounded and observable; otherwise costs and failure modes become opaque. Source: [Addy Osmani](https://addyosmani.com/blog/agent-harness-engineering/), [Martin Fowler](https://martinfowler.com/articles/harness-engineering.html)

**Key insight:** Exva needs a first-class runtime contract for step telemetry and raw messages before it can safely add more tool-using roles.

**Yahoo Finance / yfinance data availability**
yfinance can provide bars, quote-like data, company info, earnings dates, and ratings, but it is scraper-based and brittle. Broker-native or exchange-native feeds are preferable for live quotes, while Yahoo remains acceptable as a metadata and fallback source. Source: [yfinance GitHub](https://github.com/ranaroussi/yfinance), [AlgoTrading101 guide](https://algotrading101.com/learn/yahoo-finance-api-guide/)

**Key insight:** `MarketDataService` must abstract the source and declare whether a snapshot is good enough for a given role rather than silently injecting partial junk.

**AI decision audit trails**
Modern AI audit guidance converges on preserving input context, raw output, model identity, timing, and the action taken. For agent systems, one row per run with an embedded message array is easier to replay than a normalized per-message table, while a lightweight summary table remains useful for dashboards and cost queries. Source: [Streamkap decision traces](https://streamkap.com/resources-and-guides/decision-traces-ai-agents), [LoginRadius agent logging](https://www.loginradius.com/blog/engineering/auditing-and-logging-ai-agent-activity), [IETF Agent Audit Trail draft](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/)

**Key insight:** Exva should keep `agent_runs` for fast summary reads and add a separate `agent_messages` table for replay-quality traces.

---

## 5. Options Considered

### The Monitor Bot Question

The direct question was whether Exva needs a long-running AI monitor for open positions once a stop-loss is placed.

**Answer:** No. Monitoring is operational state sync, not reasoning. The broker already enforces server-side stop-loss, take-profit, and trailing-stop behavior when those order types are supported. Exva only needs to detect state transitions, enforce time-based exits, and restart the next research cycle.

### Option A: Minimal context injection only

Add a market-data snapshot to analyst prompts, keep the current sequential pipeline, and do no research burst or trace overhaul.

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Performance | Minimal latency increase |
| Reliability | Few moving parts, but still little observability |
| Cost | Low engineering cost |
| Reversibility | High |
| Stack fit | Good |
| Team readiness | High |

Risks:
- Does not solve discovery quality.
- Leaves auditing incomplete.
- Still depends on one-shot prompts that cannot explain how the selector found a symbol.

### Option B: Static data injection plus full detailed logging

Add market/fundamentals/news injection and persist full traces, but keep all roles single-shot.

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Performance | Acceptable |
| Reliability | Better auditing, but discovery still weak |
| Cost | Moderate |
| Reversibility | High |
| Stack fit | Good |
| Team readiness | High |

Risks:
- Universe discovery remains constrained.
- Reviewer cannot independently verify claims.
- Strategy plan’s “Universe Researcher” concept remains undersized.

### Option C: Full unrestricted tool-calling for every role

Every role gets tools and runs unconstrained ReAct-style loops.

| Dimension | Assessment |
|---|---|
| Complexity | Very high |
| Performance | Slowest and least predictable |
| Reliability | Highest risk of loops and budget blowouts |
| Cost | High |
| Reversibility | Low |
| Stack fit | Poor for the current repo |
| Team readiness | Low |

Risks:
- Hard to audit and test.
- Too much behavioral surface area changes at once.
- Decision maker gains tools it does not need.

### Option D: Hybrid bounded harness (RECOMMENDED)

Use role-differentiated execution models:

| Agent | Tools | `maxSteps` | Execution model |
|---|---|---:|---|
| `instrument_selector` | `search_web`, `get_quote`, `get_ohlcv`, `get_news` | 5 / 10 / 15 | Discovery loop |
| `analyst_technical` | `search_web`, `get_news` | 2 / 3 / 5 | Depth loop on injected structured data |
| `analyst_fundamental` | `search_web`, `get_news` | 2 / 3 / 5 | Depth loop on injected structured data |
| `reviewer` | `search_web` | 1 / 1 / 2 | Spot-check verification + synthesis |
| `decision_maker` | none | — | Single-shot structured decision |

| Dimension | Assessment |
|---|---|
| Complexity | Medium-high |
| Performance | Acceptable for a pre-session research burst |
| Reliability | Bounded, observable, and reversible per role |
| Cost | Higher than static injection, lower than full unrestricted tool use |
| Reversibility | High |
| Stack fit | Best match for current architecture |
| Team readiness | Good |

Risks:
- Requires an AI runtime contract upgrade before feature work.
- Requires strict source readiness checks for the fundamental analyst.
- Adds more orchestration complexity than the current single cycle.

---

## 6. Recommendation

**We recommend Option D: Hybrid bounded harness.**

Option A is too small: it improves prompts without fixing discovery or observability. Option B fixes observability but still leaves the most valuable role, the universe researcher, underpowered. Option C over-corrects and would force a graph-runtime style architecture the repo does not currently have.

Option D gives each role only the capabilities it needs. The selector discovers, analysts deepen, reviewer verifies, and decision maker decides. Combined with a canonical audit model and strategy-aware context injection, this is the smallest architecture that satisfies both the harness and strategy plans.

**Conditions that would change the recommendation:**

1. If the provider stack cannot expose bounded tool-step telemetry, we should stop at Option B.
2. If research burst latency proves unacceptable in real use, we should keep the burst but lower `researchDepth` defaults rather than abandoning the model.
3. If broker-native market data proves unavailable for a routed instrument class, that class should be start-blocked rather than silently downgraded.

---

## 7. Session Loop Design

The target lifecycle is:

```text
SESSION START
  Phase 0: PREFLIGHT
    - provider credentials
    - broker reachability
    - capital pool check
    - market-data capability check for requested instrument classes

  Phase 1: RESEARCH BURST
    - Universe Researcher discovers candidates
    - Market-hours / 24x7 check filters shortlist
    - For each surviving symbol:
      - inject Market Data + Fundamentals + News
      - Technical Analyst runs bounded search loop
      - Fundamental Analyst runs bounded search loop
      - Reviewer runs bounded spot-check loop and synthesis
    - cache research briefs for the cycle

  Phase 2: TRADE CYCLE
    - Decision Maker consumes pre-warmed research brief
    - Risk engine validates
    - optional human approval
    - broker order placement

  Phase 3: MONITORING
    - TradeMonitor polls at cadence derived from holding style
    - optional PositionManagerService daily check enforces max hold / time-based exits
    - emit trade_closed when broker confirms close or time-based exit resolves

  Phase 4: AUTOPSY + RESTART
    - load agent_messages for the closed trade
    - summarize with a cheap non-tool model
    - persist session event / trade journal entry
    - if limits still allow trading, restart from Research Burst
```

**Notes:**

- The research burst is per cycle, not once per app lifetime.
- Monitoring remains deterministic and non-LLM.
- The next cycle always starts with fresh market data.

---

## 8. Implementation Plan

### Phase 0: AI Runtime Contract + Unified Audit Model

**Goal:** Add the runtime and persistence contract that all later harness work depends on.

**Done criteria:** A provider adapter can execute a bounded tool-use run and return a canonical trace envelope that `AiRuntime` can persist without role-specific hacks.

**Canonical runtime contract**

```ts
type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
};

type ToolCallRecord = {
  step: number;
  tool: string;
  argsJson: string;
  resultPreview: string;
  latencyMs: number;
  error?: string;
  skippedReason?: string;
};

type RunTrace<T = undefined> = {
  assistantText: string;
  structuredOutput?: T;
  messages: AgentMessage[];
  thinkingText?: string | null;
  toolCalls: ToolCallRecord[];
  finishReason: "stop" | "length" | "tool_budget" | "timeout" | "error";
  parseFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};
```

**Unified persistence model**

`agent_runs` remains the fast summary table and gains additive summary fields only:

```sql
ALTER TABLE agent_runs ADD COLUMN provider_key TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE agent_runs ADD COLUMN finish_reason TEXT NOT NULL DEFAULT 'stop';
```

Add `agent_messages` as the durable replay table:

```sql
CREATE TABLE agent_messages (
  id                     TEXT PRIMARY KEY,
  agent_run_id           TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trade_id               TEXT REFERENCES trades(id) ON DELETE CASCADE,
  role                   TEXT NOT NULL,
  provider_key           TEXT NOT NULL,
  model_id               TEXT NOT NULL,
  messages_json          TEXT NOT NULL,
  thinking_json          TEXT,
  tool_calls_json        TEXT,
  output_json            TEXT,
  output_schema_name     TEXT,
  parse_fallback         INTEGER NOT NULL DEFAULT 0,
  strategy_snapshot_json TEXT NOT NULL,
  market_snapshot_json   TEXT,
  created_at             TEXT NOT NULL
);
```

**Deliverables:**

- `electron/main/services/ai/adapters/provider-adapter.ts`
  - accept `messages`, `maxSteps`, `abortSignal`, and step callbacks
  - return canonical `RunTrace`
- `electron/main/services/ai/adapters/*.ts`
  - adapt Anthropic/OpenAI/OpenRouter implementations to the new contract
- `electron/main/services/ai/ai-runtime-types.ts`
  - add shared trace types
- `electron/main/services/ai/ai-runtime.ts`
  - one internal `runAgent()` path used by single-shot and tool-use roles
- `electron/main/db/schema.ts` + migration
  - add `provider_key` / `finish_reason` to `agent_runs`
  - create `agent_messages`
- `electron/main/db/repositories/agent-messages-repo.ts`
- `TradeDetail.tsx` / `DevPanel.tsx`
  - message trace viewer powered by `agent_messages`

**Dependencies:** None

**Risks in this phase:**

- Adapter APIs differ in how they expose tool steps and reasoning.
- Cancellation may not be equally supported across providers.

**Detection:**

- Trace unit tests for each provider adapter.
- One replay fixture per provider showing consistent `RunTrace` shape.

**Rollback:**

- Keep `agent_runs` summary writes intact.
- Guard detailed trace persistence behind a feature flag until adapters are stable.

---

### Phase 1: Market Data / Fundamentals / News Snapshot Injection

**Goal:** Build a role-aware snapshot service that injects authoritative data blocks before analysis.

**Done criteria:** For a stock symbol, analyst prompts include three blocks built from one cached snapshot: `## Market Data`, `## Fundamentals`, and `## News`.

**Canonical snapshot shape**

```ts
type MarketDataSnapshot = {
  symbol: string;
  instrumentClass: "stock" | "crypto" | "futures" | "prediction_market";
  asOf: string;
  source: string;
  quote: {
    price: number;
    dayChangePct: number | null;
    volume: number | null;
    volumeRatio: number | null;
    spreadBps: number | null;
  };
  ohlcv: Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number | null }>;
  technicals: {
    return20d: number | null;
    atr14: number | null;
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
  };
  fundamentals: null | {
    marketCap: number | null;
    sector: string | null;
    industry: string | null;
    peRatio: number | null;
    revenueGrowthPct: number | null;
    earningsDate: string | null;
    analystConsensus: string | null;
  };
  news: Array<{ headline: string; source: string; publishedAt: string; url?: string }>;
};
```

**Role-readiness rules**

| Role | Required snapshot fields | If unavailable |
|---|---|---|
| `instrument_selector` | quote OR searchable news | continue with available sources |
| `analyst_technical` | quote + OHLCV + technicals + news | symbol is dropped from this cycle with warning event |
| `analyst_fundamental` on stock | fundamentals + news | symbol is dropped from this cycle with warning event |
| `analyst_fundamental` on crypto/futures | news, plus `## Fundamentals (not applicable)` | continue |
| `reviewer` | analyst briefs only | continue |

**Example injected blocks**

```markdown
## Market Data — AAPL (as of 2026-05-03 14:32 ET)
- Price: $189.42 | Day change: +1.2% | Volume: 42.1M (1.3x avg)
- 20d return: +4.1% | ATR(14): 3.21 | RSI(14): 58.4
- SMA(20): 186.7 | SMA(50): 182.5 | SMA(200): 175.8

## Fundamentals — AAPL
- Market cap: $2.9T | Sector: Technology | Industry: Consumer Electronics
- P/E: 29.4x | Revenue growth: +6.2% YoY
- Next earnings: 2026-07-24 | Analyst consensus: Moderate Buy

## News — AAPL
1. Apple reports record services revenue — Reuters, 2026-05-02
2. AAPL upgraded to Buy by Goldman Sachs — MarketWatch, 2026-05-01
3. Vision Pro sales disappoint analysts — The Verge, 2026-04-28
```

**Deliverables:**

- `electron/main/services/market-data/market-data-service.ts`
- adapters:
  - `alpaca-market-data-adapter.ts`
  - `coinbase-market-data-adapter.ts`
  - `tradovate-market-data-adapter.ts` or explicit `MARKET_DATA_UNAVAILABLE` preflight path
  - `yfinance-metadata-adapter.ts`
- `market-data-context-builder.ts`
- `news-service.ts`
- `snapshot-readiness.ts`
- `AiRuntime`
  - inject structured blocks for analyst roles
  - attach the exact snapshot payload to `agent_messages.market_snapshot_json`
- cycle-level cache keyed by `(sessionId, symbol, cycleId)`

**Dependencies:** Phase 0 and strategy plan Phase 4 (strategy context builder)

**Risks in this phase:**

- Broker-native data may not be available for every routed class.
- Yahoo metadata fields may be missing or delayed.

**Detection:**

- Per-source readiness metrics.
- Unit tests for snapshot-building and degraded-path behavior.

**Rollback:**

- Leave the snapshot service in place but stop injecting it into prompts.
- Preflight-block unsupported instrument classes rather than running with half-broken analyst context.

---

### Phase 2: Research Burst + Tool-Use Harness

**Goal:** Replace one-shot instrument resolution with a bounded research burst that discovers, analyzes, verifies, and caches per-symbol briefs before order placement.

**Done criteria:** Session start performs selector discovery, per-symbol analyst runs, reviewer synthesis, and stores reusable research briefs for the cycle.

**Research burst flow**

1. `instrument_selector` runs a bounded discovery loop.
2. `MarketHoursService` filters the shortlist.
3. For each surviving symbol, `MarketDataService` builds the cycle snapshot.
4. `analyst_technical` and `analyst_fundamental` run in parallel with independent tool logs.
5. `reviewer` runs a bounded `search_web` spot-check and synthesis pass.
6. `decision_maker` later consumes the cached research brief in the trade cycle.

**Deliverables:**

- shared `tool-use-harness.ts`
  - role-specific tools
  - `maxSteps`
  - watchdog timeout
  - spend guard
  - loop detection
- `instrument-selector-harness.ts`
- `research-burst-service.ts`
- `market-hours-service.ts`
- `session_instrument_cache`
  - add `research_briefs_json TEXT`
  - add `research_generated_at TEXT`
  - do **not** duplicate tool calls here; they already live in `agent_messages`
- `AgentOrchestrator.start()`
  - invoke research burst before queueing trade cycles
- UI progress events:
  - `research_phase_started`
  - `research_phase_step`
  - `research_phase_complete`
  - `research_phase_failed`

**Role tool matrix**

| Role | Tools | `light` | `balanced` | `deep` | Timeout |
|---|---|---:|---:|---:|---|
| `instrument_selector` | `search_web`, `get_quote`, `get_ohlcv`, `get_news` | 5 | 10 | 15 | 60s / 120s / 180s |
| `analyst_technical` | `search_web`, `get_news` | 2 | 3 | 5 | 20s / 30s / 45s |
| `analyst_fundamental` | `search_web`, `get_news` | 2 | 3 | 5 | 20s / 30s / 45s |
| `reviewer` | `search_web` | 1 | 1 | 2 | 10s / 10s / 15s |

**Safeguards**

1. Hard `maxSteps` per role.
2. Per-tool spend guard against `session_risk_config.max_ai_spend_usd`.
3. Loop detection on repeated identical `(tool, args)`.
4. Per-role watchdog timeout.
5. Structured output validation only for roles whose output feeds automation directly:
   - `instrument_selector`
   - `decision_maker`

Analyst and reviewer outputs remain markdown/text and are passed downstream unchanged.

**Dependencies:** Phases 0-1 and strategy plan Phase 2 (role rename) plus Phase 5 (full strategy context injection)

**Risks in this phase:**

- Research burst latency can become noisy under provider rate limits.
- Reviewer can accidentally re-do analyst work if step budget is not enforced.

**Detection:**

- Burst duration histogram.
- Per-role step-count metrics.
- Selector cache hit rate.

**Rollback:**

- Feature-flag the burst and fall back to current manual/selector resolution.
- Keep tool-use harness code isolated so single-shot role execution still works.

---

### Phase 3: Monitoring Cadence, Autopsy, and Cycle Restart

**Goal:** Keep open-position handling deterministic and restartable without adding a monitor agent.

**Done criteria:** When a trade closes, Exva writes an autopsy summary and either restarts the next research burst or stops cleanly based on limits.

**Deliverables:**

- `TradeMonitor`
  - cadence by holding style:
    - `intraday_flat`: 5-10s
    - `multi_day_swing`: 60s
    - `weeks_position`: 5m
    - `prediction_market`: 5m
- `PositionManagerService.dailyCheck()`
  - enforce `maxHoldDays`
  - prediction-market max-hold exits sell at market price if exposure cap is exceeded
- `TradeAutopsyService.summarize(tradeId)`
- `AgentOrchestrator`
  - subscribe to `trade_closed`
  - trigger autopsy
  - re-enter research burst if daily loss, profit target, AI spend, and exposure caps still allow trading
- UI
  - session cycle state
  - autopsy entry in trade detail / journal

**Dependencies:** Phase 2

**Risks in this phase:**

- Restart loops can re-trigger too aggressively after a close.
- Time-based exits can conflict with broker-side closes.

**Detection:**

- Duplicate-close guard tests.
- Session event sequence assertions in integration tests.

**Rollback:**

- Keep autopsy writes but disable automatic restart.
- Fall back to current single-cycle session behavior.

---

## 9. Market Data Source Policy

Exva should resolve market-data sources by `instrumentClass + routed broker account`, not by a single global provider switch.

| Instrument class | Primary source | Fallback | Policy |
|---|---|---|---|
| `stock` | Alpaca Data API | Yahoo metadata for fundamentals only | Live quote and bars must be broker-native or exchange-grade |
| `crypto` | Coinbase Advanced public candles/spot when routed there | No live-quote fallback; Yahoo may be used for delayed chart metadata only | If live quote is unavailable, technical analysis for that symbol is skipped |
| `futures` | Broker-native / Tradovate market data if available | None | If required snapshot fields cannot be produced, preflight blocks futures research for that session |
| `prediction_market` | Polymarket CLOB + Gamma market metadata | None | Enabled only with the strategy plan’s prediction-market domain changes |

**Implications:**

- There is no silent fallback from live quotes to stale scraped data for live decision-making.
- Unsupported classes fail preflight clearly.
- Fundamental metadata is a separate concern from live quote reliability.

---

## 10. Monitor Bot Final Decision

**Do not build a long-running AI monitor agent.**

| Concern | Needs AI monitor? | Solution |
|---|---|---|
| Stop-loss / take-profit enforcement | No | Broker-native orders when supported |
| Trailing stop enforcement | No | Broker-native trailing stop or deterministic non-LLM order manager |
| Detect broker close | No | `TradeMonitor` polling |
| Time-based exits | No | `PositionManagerService.dailyCheck()` |
| Prediction-market max-hold / max-exposure exits | No | Deterministic daily or 5-minute check, depending on market |
| In-trade re-analysis | No | Next research cycle happens after close |

The LLM adds value in research and decision. Once an order is open, monitoring is state synchronization and rule enforcement.

---

## 11. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | Provider adapters cannot expose consistent step telemetry | Medium | High | Phase 0 first; if this fails, stop at Option B |
| 2 | Fundamental analyst receives incomplete stock data and produces bad-quality output | Medium | High | Snapshot readiness gating; drop symbol from cycle instead of injecting partial fundamentals |
| 3 | Research burst exceeds AI budget | Medium | Medium | Per-tool spend guard, lower `researchDepth`, selector cache |
| 4 | Tool-use loops repeat uselessly | Medium | Medium | Loop detection + hard `maxSteps` + reviewer tool cap |
| 5 | `agent_messages` grows quickly | High | Low | Retention/archival policy after audit needs are met |
| 6 | Futures data support lags behind stock/crypto | Medium | Medium | Preflight block unsupported classes rather than silently degrading |
| 7 | Automatic cycle restart can churn in sideways markets | Medium | Medium | Session-level stop conditions and cooldown event hooks |

---

## 12. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
|---|---|---|---|---|
| Runtime contract upgrade | % provider adapters returning canonical `RunTrace` | 0% | 100% | Adapter tests |
| Market-data injection | % analyst runs with non-empty `market_snapshot_json` | 0% | 100% for supported classes | DB query on `agent_messages` |
| Detailed audit coverage | % `agent_runs` with matching `agent_messages` row | 0% | 100% | DB join |
| Research burst adoption | % sessions that complete burst before first trade | 0% | 90% | Session events |
| Monitoring correctness | % closed trades followed by exactly one autopsy event | 0% | 95% | Session event sequence |
| Cost control | Average AI spend per research cycle | Unknown | <$0.50 | `agent_runs.cost_usd` aggregation |

---

## 13. Open Questions

No implementation-blocking open questions remain in this plan. The remaining unknowns are tuning questions to revisit after paper-trading data exists:

| # | Question | Owner | Needed By | Status |
|---|----------|-------|-----------|--------|
| 1 | Should `waitForOpenThreshold` remain 0.80 after the first 25 real research bursts? | Ken | Post-launch tuning | Open |
| 2 | Should `weeks_position` monitoring use 5m or 15m polling by default? | Ken | Post-launch tuning | Open |
| 3 | How many days of detailed `agent_messages` traces should remain hot before archival? | Ken | Post-launch tuning | Open |

---

## 14. Alternatives Rejected

| Option | Why Rejected |
|--------|-------------|
| Store raw messages directly on `agent_runs` | Bloats the summary table and mixes dashboard concerns with replay-quality traces |
| Static reviewer with no search | Cannot independently verify analyst claims before synthesis |
| Uniform unrestricted tool use for all roles | Too expensive, too nondeterministic, and unnecessary for decision maker |
| AI monitor bot | Polling and rule enforcement are deterministic system work, not reasoning work |
| Silent fallback to incomplete market data | Produces low-trust analysis and hides operational gaps |

---

## 15. Future Work

- Human-initiated prompt improvement from autopsy history
- Cross-cycle comparative analytics for selector quality
- Shared research cache across sessions, if isolation rules later allow it
- Richer replay tooling for prompt/trace diffing between profitable and unprofitable trades

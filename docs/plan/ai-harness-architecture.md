# AI Harness Architecture — Plan

> **Date:** 2026-05-03
> **Status:** Draft
> **Deciders:** Kenneth Atchon

---

## 1. Problem Statement

The current Exva system has AI agent *roles* (bull researcher, bear researcher, reviewer, decision maker) but no *harness* — the infrastructure layer that coordinates agents, feeds them market data, manages their context windows, logs every message, and closes the loop back to execution.

Today's pipeline (`agent-orchestrator.ts`) calls four AI roles sequentially for a single pre-selected symbol. It does not:3

- Fetch live market data for the agent (price, volume, OHLCV, news, technicals)
- Run a pre-session "research burst" where agents investigate multiple candidates before committing to a symbol
- Log raw AI messages and thinking text to the database for post-trade autopsy
- Answer the question: is a long-running monitor bot needed, or can exit logic be fully automated via broker-side stops?

The harness is the difference between a toy demo and a production trading system. A weak harness means the AI has no real data to reason about, its decisions can't be audited, and the system can't learn from its mistakes. A strong harness makes the AI maximally effective by giving it the right information at the right time, in the right format, with full observability.

This plan designs that harness.

---

## 2. Goals & Non-Goals

**Goals**


| #   | Goal                                                                                                                         | Success Looks Like                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Market data layer: agents receive OHLCV, quote, news, and basic technicals injected into their context                       | Researcher prompts include structured `## Market Data` block with real numbers           |
| 2   | Pre-session research burst (10-20 min): instrument selector and researchers analyze candidates before any trade is committed | Session start triggers a research phase; first trade only after research phase completes |
| 3   | Full AI message logging: every agent call stores input messages, output text, thinking text, token counts, and cost in DB    | `agent_runs` has `messages_json`, `thinking_json`, `input_tokens`, `output_tokens`       |
| 4   | Answered question: monitor bot design — automated stop-loss-only vs. polling loop                                            | Architecture decision documented and implemented                                         |
| 5   | Session loop: research → trade → wait → autopsy → repeat                                                                     | Orchestrator restarts the cycle after trade closes                                       |


**Non-Goals**


| #   | Non-Goal                                                 | Reason                                                                      |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Real-time tick-level data streaming                      | Current use case is daily/swing trading; OHLCV snapshots are sufficient     |
| 2   | Options chain data                                       | Broker adapter doesn't support options yet                                  |
| 3   | Proprietary data sources (Bloomberg terminal, Refinitiv) | Too expensive for current phase; Yahoo Finance + search is sufficient       |
| 4   | Multi-session parallel research coordination             | Each session's harness is independent; cross-session data sharing is future |


---

## 3. Background & Context

**What a harness is:**  
Agent = Model + Harness. The harness is everything *except* the model weights: tool registration, context assembly, system prompt injection, data fetching, inter-agent message routing, output validation, retry logic, and logging. Claude Code and OpenCode are harnesses. The quality of the harness determines the quality of the AI behavior.

**Current state:**


| Component               | Status                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `AiRuntime`             | Calls provider adapters with system + user prompt. No market data injection.                                                        |
| `agent-orchestrator.ts` | Sequential 4-step pipeline per symbol. No pre-session research burst.                                                               |
| `agent_runs` table      | Stores `role`, `model_id`, `input_tokens`, `output_tokens`, `cost_usd`, `latency_ms`. Does NOT store raw messages or thinking text. |
| `TradeMonitor`          | Polls broker every 5s for order status. No AI involvement in monitoring.                                                            |
| Search adapters         | Brave + Tavily available but only injected if `webSearchEnabled = true` per role. No dedicated market data tool.                    |
| Yahoo Finance           | Not integrated. No OHLCV, no quote, no technicals.                                                                                  |


**Critical gap:** Agents currently receive a prompt like `Instrument: AAPL\nContext: None`. There is no price data, no moving averages, no recent news, no earnings date. The AI is reasoning about a ticker symbol in a vacuum.

**Related files:**

- `electron/main/services/ai/ai-runtime.ts` — agent call dispatch
- `electron/main/services/orchestration/agent-orchestrator.ts` — session loop
- `electron/main/services/orchestration/trade-monitor.ts` — post-trade monitoring
- `electron/main/db/schema.ts` — `agent_runs` table definition

---

## 4. Research Summary

**TradingAgents framework (ICML 2025)**  
The leading academic multi-agent trading framework uses 7 specialized roles running concurrently in a team structure: 4 analysts (fundamental, sentiment, news, technical) + research team + trader + risk manager. Each analyst has dedicated tools tailored to their function. The technical analyst can execute code and calculate indicators. News gathered from Bloomberg, Yahoo, EODHD, FinnHub, and Reddit. The framework achieved superior Sharpe ratio and lower max drawdown vs. all baselines. Key design: analysts run in parallel, results fed to a discussion-based research team, then to trader, then risk manager veto, then fund manager approval. Source: [arxiv TradingAgents](https://arxiv.org/abs/2412.20138), [GitHub TauricResearch](https://github.com/TauricResearch/TradingAgents)

**Key insight:** The most impactful thing in TradingAgents is not the agent count but the tool specialization. A technical analyst with a code-execution tool that computes RSI from raw price data is dramatically more effective than one that receives a text description of the chart.

**Harness engineering principles (Addy Osmani, Martin Fowler 2025)**  
A harness manages: (1) tool mediation — each tool's description lands in the prompt; ten focused tools > fifty overlapping ones; (2) context window hygiene — state must be persisted across context boundaries; (3) verification — agent output must be validated before acting on it; (4) durable state — harness must survive restarts. The "dual-LLM pattern" is strongest for security: a privileged LLM has tools but never reads untrusted content; a quarantined LLM reads untrusted content but cannot act. Source: [Addyosmani harness engineering](https://addyosmani.com/blog/agent-harness-engineering/), [Martinfowler harness engineering](https://martinfowler.com/articles/harness-engineering.html)

**Key insight:** The harness should inject market data as a *structured block* in the user prompt (not as a tool the agent calls in real-time), because it reduces latency, is auditable, and eliminates the risk of the agent making multiple redundant data fetches.

**Yahoo Finance / yfinance data availability**  
yfinance provides: OHLCV history (1m to 1mo intervals), live quote (bid/ask/price/volume), company info (PE ratio, market cap, earnings date, sector), analyst recommendations, and options chains. It is a scraper of Yahoo's public site — rate limits apply and it can break when Yahoo changes its front-end. For production, Alpaca's market data API (already integrated) and Polygon.io are more reliable alternatives for OHLCV. Finnhub provides free news with reasonable rate limits. Source: [yfinance GitHub](https://github.com/ranaroussi/yfinance), [AlgoTrading101 Yahoo guide](https://algotrading101.com/learn/yahoo-finance-api-guide/)

**Key insight:** Yahoo Finance is good for bootstrapping but brittle. The harness should abstract behind a `MarketDataService` interface so the underlying data source can swap without touching agent prompts.

**AI decision audit trails**  
SEC Rule 17a-4 and FINRA require broker-dealers to retain records of all order decisions. For AI-driven trading, the practical standard emerging is: store input context + output + reasoning + model version + timestamp for every decision. The IETF Agent Audit Trail (AAT) draft specifies a JSON record with agent identity, action classification, outcome tracking, and trust level. OpenTelemetry is becoming the standard instrumentation layer. For Exva's scale, a simple append-only `agent_messages` table is sufficient. Source: [Streamkap decision traces](https://streamkap.com/resources-and-guides/decision-traces-ai-agents), [LoginRadius agent logging](https://www.loginradius.com/blog/engineering/auditing-and-logging-ai-agent-activity), [IETF AAT draft](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/)

**Key insight:** Store messages as JSONB-like column, not as separate rows per message. One row per agent run containing the full `[{role, content}]` array is much easier to query for autopsy than normalized message tables.

---

## 5. Options Considered

### The Monitor Bot Question (answered explicitly)

The user asked: "Do we need a long-running checker bot that monitors open positions, given that stop-loss is set at trade placement?"

**Answer: No, a monitor bot is not required for basic operation, but it has a specific role for non-exchange-native stops.**

Here is why:

**Broker-native stops (Alpaca, Tradovate):** When a trade is placed with a stop-loss price, the broker holds the stop order server-side. If the stop is breached, the broker closes the position automatically regardless of whether Exva is running. The `TradeMonitor` polling loop only exists to *detect* when the broker has closed the position, so Exva can update its DB state (`status = closed`, `final_pnl_usd`). This is a DB sync concern, not a risk management concern.

**When a monitor bot adds real value:**

1. Dynamic trailing stops: if the strategy calls for a trailing stop that moves with price, the bot must periodically update the stop price at the broker. Broker-side trailing stops exist (Alpaca supports them) but are configured at order placement — they don't require polling from Exva.
2. Time-based exits: if a session has `maxHoldDays` configured, something must check daily whether held positions have exceeded the max hold time and place exit orders.
3. Instrument conflict resolution: if a second session tries to trade the same symbol, the monitor must detect the conflict.

**Conclusion: The current `TradeMonitor` polling every 5 seconds is correct and sufficient for the basic case. The polling interval can be relaxed to 60 seconds for multi-day swing positions. A separate "position manager" agent that runs daily is the right shape for time-based exits — not a continuous polling loop.**

---

### Option A: Minimal harness — inject static market snapshot, no pre-session research burst

Fetch a market data snapshot (OHLCV, quote, basic technicals) once per symbol, inject into researcher prompt. Keep sequential pipeline. No research burst.


| Dimension      | Assessment                                                      |
| -------------- | --------------------------------------------------------------- |
| Complexity     | Low — add `MarketDataService`, update `AiRuntime.runResearcher` |
| Performance    | Small latency increase from data fetch (100-500ms)              |
| Reliability    | Data fetch can fail; need fallback to empty context             |
| Cost           | ~1 day engineering                                              |
| Reversibility  | Fully reversible                                                |
| Stack fit      | Natural extension of current prompt injection pattern           |
| Team readiness | Yes                                                             |


**Risks:** Without a research burst, the AI still analyzes whatever symbols the user pre-loaded, not the best symbols from a broader universe. No qualitative improvement in stock picking.

---

### Option B: Full harness — pre-session research burst + market data injection + full message logging (RECOMMENDED)

Three major additions: (1) `MarketDataService` fetches and caches OHLCV+quote+news per symbol; (2) pre-session research burst runs instrument-selector and researchers across a broader candidate set before the first trade; (3) `agent_messages` table stores full input/output/thinking per run.


| Dimension      | Assessment                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Complexity     | High — 3 new subsystems, phased carefully                                                             |
| Performance    | Pre-session burst adds 10-20min latency before first trade; acceptable given the user's stated intent |
| Reliability    | Market data fetcher must be fault-tolerant; agent burst must not block session indefinitely           |
| Cost           | ~5-7 days engineering across phases                                                                   |
| Reversibility  | Each phase is independently additive                                                                  |
| Stack fit      | Extends existing `AiRuntime`, `orchestrator`, and schema cleanly                                      |
| Team readiness | Partial — market data integration is new territory                                                    |


**Risks:** Market data API downtime blocks agents; pre-session burst may stall if LLM rate limits are hit.

---

### Option C: Tool-calling harness — agents fetch their own data via tools

Agents receive a tool set: `get_price(symbol)`, `get_ohlcv(symbol, interval, n_bars)`, `search_news(query)`, `calculate_indicator(type, data)`. Agents call these tools autonomously in a ReAct loop.


| Dimension      | Assessment                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------ |
| Complexity     | Very high — requires LLM tool-use loop, tool definitions, output parsing, loop termination |
| Performance    | 3-5× slower — multi-turn tool calls per agent                                              |
| Reliability    | Much harder to audit; tool call failures can cause infinite loops                          |
| Cost           | ~10+ days; fundamental architecture change                                                 |
| Reversibility  | Low — changes provider adapter contract                                                    |
| Stack fit      | Poor for current sequential pipeline; would require LangGraph-style graph runtime          |
| Team readiness | No                                                                                         |


**Risks:** Tool-use loops are non-deterministic. An agent that calls `get_ohlcv` 10 times before answering costs 10× the tokens and takes 10× the time. The current `generateText` / `generateObject` pattern is synchronous and predictable; tool loops are not.

---

## 6. Recommendation

**We recommend Option B: Full harness, phased.**

Option A is too shallow — without real market data, agent quality is fundamentally limited regardless of prompt quality. Option C is architecturally expensive and introduces non-determinism we don't need.

Option B delivers the two highest-value improvements first (market data injection, message logging) and adds the research burst in Phase 2 once the data layer is stable.

**On the monitor bot question:** Do not build a dedicated "monitor AI agent" for trade watching. The `TradeMonitor` polling loop is the right shape. Add a daily "position manager" function (not an LLM) that enforces time-based exit rules. Reserve LLM involvement for the research and decision phases — not the monitoring phase. The LLM's value is in analysis, not in polling a broker API every minute.

**Key assumptions:**

- Alpaca's market data API (already partially integrated) provides sufficient OHLCV + quote data for stock sessions
- 10-20 minute pre-session research burst is acceptable UX; surfaced as a progress UI in the session panel

---

## 7. Session Loop Design

The full session lifecycle, as designed:

```
┌─────────────────────────────────────────────────────────────────┐
│ SESSION START                                                     │
│                                                                   │
│  Phase 0: PREFLIGHT (existing)                                    │
│  ├── broker reachability                                          │
│  ├── provider credentials                                         │
│  └── capital pool check                                           │
│                                                                   │
│  Phase 1: RESEARCH BURST (10-20 min) ← NEW                       │
│  ├── Universe Researcher: web search discovery — what is moving  │
│  │   right now and why, scored against session strategy type     │
│  │   (if user provided symbol list: constrain, still use search) │
│  ├── Market hours check (see §10 below):                         │
│  │   ├── Shortlisted instrument trades 24/7 → proceed           │
│  │   ├── Market closed + weak pick → find something else        │
│  │   └── Market closed + strong pick → wait for open            │
│  ├── For each shortlisted symbol (parallel, max 3):              │
│  │   ├── Technical Analyst + MarketData injection                │
│  │   └── Fundamental Analyst + MarketData injection             │
│  ├── Reviewer: synthesize per-symbol (analysts stay independent) │
│  └── Output: ranked instrument list + per-symbol brief           │
│                                                                   │
│  Phase 2: TRADE CYCLE (per instrument)                           │
│  ├── DecisionMaker: receives research briefs + market data       │
│  ├── RiskEngine: validates decision                              │
│  ├── [optional] Human approval                                   │
│  └── BrokerService: place order with stop-loss                   │
│                                                                   │
│  Phase 3: MONITORING (TradeMonitor polling — interval by style)  │
│  ├── intraday: 5-10s | swing: 60s | Polymarket: 5min            │
│  ├── [optional] Time-based exit check (maxHoldDays)              │
│  └── Emit trade_closed when broker confirms close                │
│                                                                   │
│  Phase 4: AUTOPSY + LOOP                                         │
│  ├── AutopsyService: load agent_messages for the closed trade    │
│  ├── Generate human-readable summary (haiku model, no tools)     │
│  ├── Store as session event — human review only, not fed back    │
│  ├── Emit cycle_complete event                                    │
│  └── → Return to Phase 1 (repeat, with fresh market data)        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Implementation Plan

### Phase 1: Market Data Service + Context Injection

**Goal:** Agents receive a structured `## Market Data` block with real OHLCV, quote, and news for the instrument they are analyzing.

**Done criteria:** `AiRuntime.runResearcher` includes price, 20-day return, ATR, and up to 3 recent news headlines in the user prompt. Unit test mocks `MarketDataService` and asserts correct injection.

**Data block format (injected into researcher user prompt):**

```markdown
## Market Data — AAPL (as of 2026-05-03 14:32 ET)
- Price: $189.42 | Day change: +1.2% | Volume: 42.1M (1.3× avg)
- OHLCV (last 5 sessions, 1d): 185.20, 186.80, 187.40, 188.10, 189.42
- 20-day return: +4.1% | ATR(14): 3.21 | RSI(14): 58.4
- 50MA: 182.50 | 200MA: 175.80 (price above both MAs)
- Next earnings: 2026-07-24 (est.)
- Recent news:
  1. "Apple reports record services revenue" — Reuters, 2026-05-02
  2. "AAPL upgraded to Buy by Goldman Sachs" — MarketWatch, 2026-05-01
  3. "Vision Pro sales disappoint analysts" — The Verge, 2026-04-28
```

**Deliverables:**

- `electron/main/services/market-data/market-data-service.ts` — `MarketDataService` interface
- `electron/main/services/market-data/alpaca-market-data-adapter.ts` — uses Alpaca data API for OHLCV + quote
- `electron/main/services/market-data/yfinance-market-data-adapter.ts` — fallback for non-Alpaca sessions (calls a local Python subprocess or HTTP shim)
- `electron/main/services/market-data/market-data-context-builder.ts` — `buildMarketDataBlock(snapshot) → string`
- Update `AiRuntime.runResearcher` + `runInstrumentSelector` to accept + inject market data block
- Cache market data snapshot per (symbol, sessionId) for the duration of one research cycle — avoid duplicate fetches
- Graceful degradation: if fetch fails, inject `## Market Data\n(unavailable)` and continue

**Dependencies:** None (new service)

**Rollback:** Remove market data injection from `runResearcher`; no DB changes.

---

### Phase 2: Full Message Logging

**Goal:** Every agent call stores the complete message array (system, user, assistant) and extended cost data in a new `agent_messages` table. This is the autopsy foundation.

**Done criteria:** After a trade cycle, querying `SELECT * FROM agent_messages WHERE trade_id = ?` returns the full LLM conversation for every agent that ran for that trade. Including thinking/reasoning text if the model provides it.

**Schema addition:**

```sql
CREATE TABLE agent_messages (
  id           TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL,
  trade_id     TEXT,                 -- null for instrument_selector runs
  role         TEXT NOT NULL,        -- 'researcher_bull' | 'researcher_bear' | etc.
  messages_json TEXT NOT NULL,       -- [{role: 'system'|'user'|'assistant', content: string}]
  thinking_json TEXT,                -- reasoning/thinking text if model provides it (Claude 3.7+)
  model_id     TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  strategy_snapshot_json TEXT,       -- brief injected at call time (from Phase 1 of strategy plan)
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  latency_ms    INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
```

**Deliverables:**

- Migration: create `agent_messages` table
- `agent-messages-repo.ts` — `insert(run: AgentRun, messages: Message[], thinking?: string): void`
- Update `AiRuntime` provider adapters — return full `messages` array alongside output
- Update all `runRole` paths in `AiRuntime` to call `agentMessagesRepo.insert()`
- Update `DevPanel` UI — "View messages" expandable per agent run in trade detail
- `TradeDetail.tsx` — link to message log viewer

**Dependencies:** Phase 1 (market data is part of messages; logging is more valuable when messages contain real data)

**Rollback:** Drop `agent_messages` table; remove repo calls from `AiRuntime`.

---

### Phase 3: Pre-Session Research Burst

**Goal:** Session start runs a research burst where the Universe Researcher *discovers* what to trade via web search, then technical and fundamental analysts do deep analysis on the shortlist. No pre-supplied symbol list required — the AI finds the opportunities itself.

**Session start flow change:**

```
Current:  PREFLIGHT → instrument resolution (cached or selector) → trade cycle
Proposed: PREFLIGHT → RESEARCH BURST → market hours check → instrument lock → trade cycle
```

**Research burst steps:**

1. `UniverseResearcher.run(strategyBrief, instrumentClasses)` — web search discovery, returns ranked shortlist of N symbols with confidence scores. If session has a user-provided symbol scope, discovery is constrained to those symbols.
2. **Market hours check** (see §10 below) — for each shortlisted symbol, determine if its market is currently open. Handle closed markets per configured policy.
3. For each shortlisted symbol that clears the market hours check (parallel):
  - `TechnicalAnalyst.run(symbol + market_data)` → analysis brief
  - `FundamentalAnalyst.run(symbol + market_data)` → analysis brief
  - (analysts are strictly independent — neither sees the other's output)
4. `Reviewer.run(symbol + technical_brief + fundamental_brief)` → synthesis per symbol
5. Emit `research_burst_complete` event → UI shows "Research complete, starting trading"
6. First trade cycle begins with pre-warmed per-symbol briefs passed directly to decision maker

**Burst time estimate:** Universe researcher (web-heavy, 15-30s) + 3 symbols × (2 analysts parallel + 1 reviewer) × 5s/call = ~60-90 seconds total. Deeper research depth (`researchDepth = deep`) = more web queries by the universe researcher = 3-5 minutes. This maps well to `researchDepth` config: `light` (fast scan, fewer candidates), `balanced` (default), `deep` (thorough, wide search, longer).

**Deliverables:**

- `research-burst-service.ts` — orchestrates burst, emits events, stores results in `instrument_cache` with research briefs
- Update `session_instrument_cache` schema — add `research_briefs_json TEXT` column
- `AgentOrchestrator.start()` — invoke research burst before entering trade cycle queue
- Emit `research_phase_started` / `research_phase_complete` / `research_phase_failed` events
- UI: `SessionsPage` shows research phase progress (spinner with "Researching X symbols...")
- Research briefs are passed to `DecisionMaker` instead of re-running researchers per trade

**Dependencies:** Phases 1 + 2

**Rollback:** Skip burst in `AgentOrchestrator.start()` — falls back to current symbol resolution path.

---

### Phase 4: Session Loop (Autopsy + Repeat)

**Goal:** After a trade closes, the session automatically runs an autopsy (summary of what the AI decided and why) and restarts the cycle.

**Autopsy:**

- Triggered by `trade_closed` event
- Loads all `agent_messages` for the trade
- Runs a lightweight summarizer (haiku model hardcoded, no tools) — 3-5 sentences: what the AI saw, what it decided, what happened
- Stores summary as a session event (`agent_type: 'orchestrator'`, level: `INFO`)
- **Human review only** — autopsy is NOT fed back into future cycle prompts (avoid compounding bias)
- **Future / out of scope:** human-initiated "Improve Prompt" flow — user reviews autopsy, clicks to open the relevant agent prompt editor with autopsy as context, edits and saves. This is human-initiated only, not automated.

**Loop restart:**

- After autopsy, check if session limits are still within bounds (daily loss, profit target, API spend)
- If within bounds: emit `cycle_complete`, restart from Phase 3 (Research Burst) with fresh market data
- If limit reached: stop session gracefully, emit session-level summary

**Deliverables:**

- `TradeAutopsyService.summarize(tradeId) → string`
- `AgentOrchestrator` — hook into `trade_closed` event, call autopsy, then restart cycle
- `SessionService` — enforce loop termination conditions before restart
- Emit `session_cycle_complete` event with cycle number and cumulative stats
- UI: Dashboard shows "Cycle N — researching / trading / waiting" state

**Dependencies:** Phase 3

**Rollback:** Remove autopsy call + loop restart from orchestrator; session runs single cycle only (current behavior).

---

## 9. Market Data Tool Recommendations

**Primary (stocks via Alpaca broker):** Alpaca Data API v2 — already partially integrated. Provides bars (OHLCV), latest quote, and latest trade. Free tier with 200 req/min. Use this for any session with Alpaca as the broker.

**Fallback / supplementary (Yahoo Finance):** yfinance via a lightweight local Python subprocess (or HTTP wrapper). Provides: history, info (PE, market cap, earnings date, analyst ratings), and options chain. Use when Alpaca is not the broker or for non-US instruments. **Do not use Yahoo as primary** — it's a scraper and breaks without warning.

**News:** Brave Search API (already integrated) is the primary news source. For structured financial news, add Finnhub's free news endpoint (`/news?category=general&minId=0`) — returns timestamped articles with sentiment labels at no cost.

**Technicals:** Do not use a third-party technical indicator service. Compute in-process from OHLCV data:

- RSI(14), ATR(14), SMA(20), SMA(50), SMA(200), volume ratio
- Use `technicalindicators` npm package (already in JS ecosystem) — 2KB bundle
- Computing from raw OHLCV is faster, cheaper, and auditable

**Data injection priority matrix:**


| Data type           | Source                   | Inject into                              | Priority |
| ------------------- | ------------------------ | ---------------------------------------- | -------- |
| OHLCV + quote       | Alpaca / yfinance        | Researcher user prompt                   | Required |
| Computed technicals | In-process from OHLCV    | Researcher user prompt                   | Required |
| Recent news         | Brave search             | Researcher user prompt (top 3 headlines) | Required |
| Analyst ratings     | yfinance info            | Researcher user prompt                   | Optional |
| Earnings date       | yfinance info            | Researcher user prompt                   | Optional |
| Full news articles  | Brave search (full text) | Web search tool (if enabled per role)    | Optional |
| Options flow        | Not yet                  | —                                        | Future   |


---

## 10. Monitor Bot: Final Design Decision

**Question:** Do we need a long-running AI agent that monitors open positions?

**Answer: No. Here is the exact breakdown:**


| Concern                       | Needs AI monitor?             | Solution                                                                                                                             |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Stop-loss enforcement         | **No**                        | Broker holds server-side stop order. Alpaca GTC stops survive app restarts.                                                          |
| Take-profit enforcement       | **No**                        | Broker holds server-side take-profit (limit) order.                                                                                  |
| Trailing stop enforcement     | **No**                        | Alpaca supports server-side trailing stops set at order placement.                                                                   |
| DB sync (detect broker close) | **No**                        | `TradeMonitor` polling loop (non-AI, 30-60s) updates `trades.status`.                                                                |
| Time-based exit (maxHoldDays) | **No, but needs daily check** | A `PositionManagerService.dailyCheck()` function (non-AI) inspects open positions vs. `maxHoldDays`, places close order if exceeded. |
| Dynamic position adjustment   | **Not now**                   | In-trade adjustments (adding to winners, reducing losers) are a future feature. Deferred — do not design for this.                   |
| Intra-trade re-analysis       | **No**                        | Once a trade is open, the decision is made. The AI re-runs when the *next* cycle starts.                                             |


**Key insight:** The AI's value is in the research and decision phases. Once a trade is placed with a broker-native stop, the AI has nothing to do until the position closes. Polling is sufficient. A "dumb model that just monitors the situation" would waste tokens checking what the broker already knows.

**Implementation:** Relax `TradeMonitor` polling from 5s to 60s for multi-day swing sessions. Add `PositionManagerService.dailyCheck()` that runs once per day (triggered by a timer at market open) to enforce `maxHoldDays`.

---

## 10b. Market Hours Logic

After the universe researcher returns its shortlist, the harness must handle cases where the chosen instrument's market is closed.

**The decision depends on what was picked:**

```
For each shortlisted instrument:
  ├── Market is open now → proceed immediately
  ├── Market is closed:
  │   ├── Instrument is crypto or Polymarket (24/7) → always open, proceed
  │   ├── Stock/futures (has trading hours):
  │   │   ├── Confidence score ≥ 0.80 ("strong deal") → wait for market open
  │   │   │   ├── Schedule trade cycle to fire at next market open time
  │   │   │   └── Emit "waiting for market open" event → UI shows countdown
  │   │   └── Confidence score < 0.80 → skip, ask universe researcher for
  │   │       something else (crypto, Polymarket, or another stock session)
  │   └── If no alternatives available → session waits for market open
```

**Confidence threshold for waiting** (`waitForOpenThreshold`) is configurable in `session_risk_config`, default 0.80. Users with 24/7 crypto sessions never hit this path. Users with stock-only sessions that start at night will frequently hit it — the bot should naturally gravitate toward finding a 24/7 instrument unless the stock setup is compelling enough to wait.

**Implementation:** `MarketHoursService.nextOpen(symbol, instrumentClass) → Date | null`. If null = 24/7. The session loop checks this after research burst, before kicking off analyst runs.

---

## 11. Risk Register


| #   | Risk                                                                              | Likelihood       | Impact | Mitigation                                                                                               |
| --- | --------------------------------------------------------------------------------- | ---------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Yahoo Finance scraper breaks without warning                                      | High             | Medium | Abstract behind `MarketDataService` interface; Alpaca data is primary                                    |
| 2   | Research burst exceeds token budget (`maxAiSpendUsd`)                             | Medium           | Medium | Check API spend budget before each burst step; abort and fall back to manual shortlist                   |
| 3   | Pre-session burst stalls on LLM rate limit                                        | Medium           | High   | Timeout per agent call (existing 60s); burst failure falls back to manual shortlist with a warning event |
| 4   | `agent_messages` table grows unbounded                                            | High (long-term) | Low    | Retention policy: archive messages older than 30 days; linked to trade record                            |
| 5   | Broker-native stop not supported for all asset classes                            | Medium           | High   | Futures and crypto may require Exva-side stop management; `TradeMonitor` must handle both cases          |
| 6   | Research burst runs agents on symbols that don't qualify (wrong instrument class) | Low              | Low    | Filter before burst, same as current `resolveInstruments` path                                           |


---

## 12. Success Criteria


| Goal                     | Metric                                                | Baseline | Target | How Measured                         |
| ------------------------ | ----------------------------------------------------- | -------- | ------ | ------------------------------------ |
| Market data injection    | % of agent runs with non-empty market data block      | 0%       | 100%   | Query `agent_messages.messages_json` |
| Message logging coverage | % of agent runs with `agent_messages` row             | 0%       | 100%   | DB join                              |
| Research burst adoption  | % sessions that complete burst before first trade     | 0%       | 90%    | Session events                       |
| Autopsy coverage         | % closed trades with autopsy summary event            | 0%       | 95%    | Session events                       |
| Cost per cycle           | Average USD AI spend per research burst + trade cycle | Unknown  | <$0.50 | `agent_runs.cost_usd` sum            |
| Cycle loop               | % sessions that restart cycle after trade close       | 0%       | 80%    | Session event sequence               |


---

## 14. Open Questions


| #   | Question                                                                                                                                                  | Owner | Needed By | Status                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | -------------------------------------------------------------------------------------- |
| 1   | `researchDepth` (`light/balanced/deep`) maps to universe researcher search breadth — confirm this mapping replaces the old "candidate pool size" approach | Ken   | Phase 3   | **DECIDED: yes, researchDepth drives how thoroughly the universe researcher searches** |
| 2   | For crypto sessions (Coinbase adapter), what replaces Alpaca's market data API? Coinbase Advanced Trade API has OHLCV. Need to verify.                    | Ken   | Phase 1   | Open                                                                                   |
| 3   | Should autopsy summaries be surfaced in the UI as a "trade journal" view, or just in session events?                                                      | Ken   | Phase 4   | Open — lean trade journal tab                                                          |
| 4   | Poll interval for intraday vs. swing: intraday = 5-10s, swing = 60s, Polymarket = 5min                                                                    | Ken   | Phase 1   | **DECIDED: poll interval driven by `holdingStyle`**                                    |
| 5   | Autopsy uses haiku model regardless of session model config                                                                                               | Ken   | Phase 4   | **DECIDED: yes, hardcode haiku for autopsy**                                           |
| 6   | Human approval on Polymarket: viable given fast-moving edge windows?                                                                                      | Ken   | Phase 5   | **DECIDED: keep as option (`humanApprovalRequired`), iterate later**                   |
| 7   | Market hours `waitForOpenThreshold` default (0.80) — adjust after first real sessions                                                                     | Ken   | Phase 3   | Open — revisit after testing                                                           |


---

## 15. Future Work (out of scope)

- **Human-initiated prompt improvement via autopsy:** After reviewing a trade autopsy, user clicks "Improve Prompt" → opens agent prompt editor pre-populated with autopsy context → user edits + saves. Human-initiated only, no automation. Requires trade journal UI. Track as separate plan when ready.

---

## 16. Alternatives Rejected


| Option                                       | Why Rejected                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tool-calling harness (agents fetch own data) | 3-5× slower, non-deterministic, harder to audit                                      |
| Minimal harness (no market data, no logging) | Fundamentally limits AI quality; cannot do autopsy without logs                      |
| Long-running AI monitor bot                  | LLM has no value in monitoring; broker-native stops are more reliable                |
| Real-time streaming market data              | Over-engineered for daily/swing use case; adds infra complexity with no quality gain |
| Separate microservice for market data        | Overkill for a desktop Electron app; in-process service is sufficient                |



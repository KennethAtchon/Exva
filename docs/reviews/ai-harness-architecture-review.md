# AI Harness Architecture Plan — Review

> **Reviewer:** Claude
> **Date:** 2026-05-05
> **Document reviewed:** `docs/plan/ai-harness-architecture.md`

---

## Verdict

Architecturally sound. Option D is the right call. The phase ordering is correct. The audit model design is correct. Several gaps in the plan itself will cause implementation friction: one integration approach is technically infeasible in TypeScript, two contracts are internally contradictory, three deliverables are underspecified, and the tool-use loop design inverts the correct termination model.

---

## 1. What the Plan Gets Right

- **Option D over C.** Bounded per-role tool budgets are cheaper, more auditable, and easier to test than unrestricted ReAct loops. The role matrix is well-calibrated.
- **No monitor bot.** Correct. Polling + deterministic rule enforcement is the right model for open-position management. LLM monitoring adds latency, cost, and nondeterminism to a task that needs none of those.
- **`agent_messages` as a separate table.** Right call. Keeps the dashboard-query table (`agent_runs`) lean and separates replay-quality concerns from summary concerns. Consistent with how LangSmith, W&B, and Microsoft ADK structure agent observability.
- **Broker-native market data, no silent fallback.** Correct policy. Injecting stale scraped data into a live decision is worse than blocking.
- **Pre-session research burst.** Decoupling discovery/analysis from execution is the core insight from TradingAgents (arXiv 2412.20138). Sound.
- **Phase ordering.** Phase 0 (runtime contract) before Phase 1 (data injection) before Phase 2 (tool harness) is the correct dependency chain.

---

## 2. Critical Gaps

### 2.1 yfinance is not callable from TypeScript

The plan lists `yfinance-metadata-adapter.ts` as a deliverable and relies on yfinance for fundamentals. **yfinance is a Python scraper library.** It has no REST API — it scrapes Yahoo Finance's private internal endpoints and returns Python objects. You cannot call it from Electron's main process without:

- A bundled Python sidecar process (adds ~80MB to the app, complex lifecycle management), or
- A self-hosted FastAPI/Flask proxy wrapping yfinance (requires a running server), or
- Switching to a TypeScript-native provider.

The plan lists a `.ts` adapter file as if it works natively alongside the Alpaca and Coinbase adapters. It does not. This is implementation-blocking.

#### Provider alternatives

Exva already routes stocks through Alpaca. **Alpaca Data API v2** is already in the dependency tree and covers quotes + OHLCV for free with real-time data. The gap is **fundamentals and news** — yfinance's actual role. Here are the viable TypeScript-native options for that gap:

| Provider | Free tier | Paid entry | TS SDK | OHLCV | Fundamentals | News | Notes |
|---|---|---|---|---|---|---|---|
| **Financial Modeling Prep** | 250 calls/day, EOD, US only | ~$50–100/mo | REST only, no official SDK | Yes | Yes — P/E, market cap, earnings date, analyst consensus, income statements | Yes — stock news + general news APIs | Best all-in-one for fundamentals + news |
| **Alpha Vantage** | 25 calls/day (barely usable) | $49.99/mo | REST, community TS libs | Yes — NASDAQ-licensed, 20+ years | Yes — strong, earnings with surprise estimates | No | No news; need a second provider |
| **Twelve Data** | Unclear | $29/mo (starter fundamentals only) | REST + WebSocket, SDK unclear | Yes — real-time WebSocket | Yes — full on $99+/mo plan | Yes | Cheapest paid option; fundamentals depth requires upgrade |
| **Polygon.io** | 5 req/min, 15-min delayed | Per tier | Official `@polygon.io/client-js` TS SDK | Yes — excellent | **No** | **No** | Wrong tool — missing both fundamentals and news |
| **Tiingo** | 50 symbols/hour, 5yr fundamentals | Undocumented | Python SDK only, REST API | Yes | Yes — 5yr free, 15yr+ paid | Yes — dedicated news API | Python bias; no official TS SDK |
| **Alpaca Data API v2** | Free with Alpaca account | — | Official TS SDK | Yes — already in stack | **No** | **No** | Already covers quotes/OHLCV for stocks; not a fundamentals source |

#### Recommendation

**Split the role yfinance was filling into two providers, both already partially in the stack or trivially addable:**

1. **Alpaca Data API v2** — quotes + OHLCV for stocks (already present, broker-native, free, real-time)
2. **Financial Modeling Prep** — fundamentals + news (REST-only, no SDK needed, 250 free calls/day covers development, ~$50–100/month for production)

FMP covers every field in the plan's `MarketDataSnapshot.fundamentals` shape: `marketCap`, `sector`, `industry`, `peRatio`, `revenueGrowthPct`, `earningsDate`, `analystConsensus`. It also has a dedicated stock news API. One provider, pure REST, callable with `fetch` in TypeScript.

Polygon.io is not the right pick — it has no fundamentals or news and would require two additional providers to fill the yfinance gap.

**The plan must drop `yfinance-metadata-adapter.ts`, add a `fmp-metadata-adapter.ts`, and confirm Alpaca Data API v2 covers the OHLCV requirement before Phase 1 starts.**

### 2.2 `RunTrace` is missing per-step token counts

The canonical contract:

```ts
type RunTrace<T = undefined> = {
  assistantText: string;
  structuredOutput?: T;
  messages: AgentMessage[];
  toolCalls: ToolCallRecord[];
  finishReason: "stop" | "length" | "tool_budget" | "timeout" | "error";
  parseFallback: boolean;
  inputTokens: number;      // ← total across all steps
  outputTokens: number;     // ← total across all steps
  durationMs: number;
};
```

Vercel AI SDK's `generateText` returns `result.steps[]`, each with its own `usage`. The plan collapses per-step token counts into a single total. This means the spend guard (§8 Phase 2 safeguard #2) cannot enforce per-step budgets — only post-run totals. For bounded tool loops the spend guard needs to fire *during* execution, not after. `RunTrace` needs per-step cost or at minimum the plan needs to clarify how mid-loop spending is detected (it belongs in the adapter's `onStepFinish` callback, not in the trace shape).

### 2.3 `tool_budget` finish reason has no mechanism

`finishReason: "tool_budget"` is in the contract but the plan never describes what produces it. The Vercel AI SDK does not emit this natively. It must come from a custom `stopWhen` condition in the adapter. The plan should document what triggers `tool_budget` vs `stop` — otherwise adapters will implement it inconsistently.

The Vercel AI SDK pattern:

```ts
// ai package ≥ 4.x
const result = await generateText({
  model, messages, tools,
  maxSteps: roleMaxSteps,
  stopWhen: [stepCountIs(roleMaxSteps), spendGuard(budgetUsd)],
  onStepFinish: ({ toolCalls, usage }) => { /* capture ToolCallRecord */ },
});
// finishReason comes from result.finishReason, but "tool_budget" is custom
// — must be derived from stopWhen firing, not from the SDK directly
```

The plan's `finishReason` enum should either document that `tool_budget` is a Exva-internal value set when `stopWhen` fires on spend, or remove it and use `"stop"` with a separate `stoppedBySpendGuard: boolean` field.

### 2.4 `decision_maker` tool contradiction

§5 Option D table says `decision_maker` has **no tools**. §8 Phase 2 safeguards say "structured output validation only for roles whose output feeds automation directly: `instrument_selector`, `decision_maker`" — implicit that decision maker gets no tools. But the plan never explicitly prohibits `webSearchEnabled` for the decision maker role. The session AI roles config has a per-role `webSearchEnabled` flag. If a user enables it, the harness will pass `web_search` to the decision maker. The plan should state: "the harness ignores `webSearchEnabled` for `decision_maker` unconditionally."

### 2.5 `cycleId` not in the data model but required by cache design

§8 Phase 2 says: "cycle-level cache keyed by `(sessionId, symbol, cycleId)`." No `cycleId` concept exists in the plan's DB schema (§8 Phase 0, §8 Phase 2). The plan lists `session_instrument_cache` additions (`research_briefs_json`, `research_generated_at`) but adds no `cycleId` column. On a restart after trade close, the second research cycle on the same session+symbol will either:

- Reuse the first cycle's stale briefs (if hash-matched), or
- Overwrite them with no way to distinguish cycle 1 from cycle 2 in the audit trail.

The plan must add `cycleId` (or a `cycleNumber INTEGER`) to `session_instrument_cache` and to `agent_messages` before Phase 2 is implemented.

---

## 3. Underspecified Deliverables

### 3.1 Autopsy (Phase 3)

> "summarize with a cheap non-tool model"

**The plan's trigger is wrong.** Automatic autopsy on every `trade_closed` event means an LLM call fires on every close — including stop-loss hits, time-based exits, and rejected trades. That is unnecessary cost and noise. Autopsy should be user-initiated from the trade detail view, on demand.

Remaining gaps once the trigger is corrected:
- Which model? (Haiku 4.5? GPT-4o-mini?)
- What fields from `agent_messages` go into the autopsy prompt?
- Where is the output stored? New `trade_autopsies` table? A row in `agent_messages` with a special role?

Without fixing the trigger and answering these, Phase 3 has no valid done criteria for the autopsy deliverable.

### 3.2 Parallel analyst error handling (Phase 2)

The plan says analysts run in parallel. It does not specify what happens when one fails:

- Does the reviewer run on partial input (one analysis + one error message)?
- Is the symbol dropped from the cycle entirely?
- Does a failed fundamental analyst allow the technical analyst's output to still reach the decision maker?

The current sequential pipeline has an implicit fail-fast model. Parallel execution needs an explicit decision on partial failure — this is not a tuning question, it's a correctness question.

### 3.3 `get_quote`, `get_ohlcv`, `get_news` tool implementations

These are listed in the role tool matrix for `instrument_selector` but the plan never specifies:
- What underlying service they call (`MarketDataService`? Direct broker adapter?)
- What their return shape is
- Whether they share the same source policy as the `MarketDataSnapshot` (broker-native first)
- Whether a failed `get_quote` call causes the selector to skip the symbol or return an error result to the model

These are tools injected into a model prompt — their interface matters.

---

## 4. Search Tool Implementation — Industry Standard vs Plan

### What the plan specifies

The plan names Tavily and Brave as search providers and describes a `web_search` tool injected per-role. It says nothing about return shape, query handling, caching, rate-limit behavior, or URL attribution. These are implementation details — but they have correctness and compliance implications for a financial AI system.

### What industry standard looks like

**Return shape — structured array, not flat string**

Every production search integration (Claude API, OpenAI, Exa, LangChain, LlamaIndex) returns a structured array of result objects. The consensus fields:

```ts
type SearchResult = {
  url: string;
  title: string;
  snippet: string;       // extracted text, 500–2000 chars, not full HTML
  publishedDate?: string; // ISO format — critical for financial recency filtering
  score?: number;        // relevance score where available
};
```

The plan's current search adapters collapse this into a flat string:

```ts
// current normalize() in both adapters
lines.push(`${index + 1}. ${snippet}`);
return lines.join("\n");
// → "1. Apple reports record revenue — reuters.com/..."
```

URL, title, and content are concatenated and the structure is lost. The model cannot distinguish source from content. More importantly, the `api_call_log` table (§9 of this review) cannot record which URLs were accessed per tool call because the adapter discards them after formatting.

**Query sanitization — never pass raw model output directly**

FINOS AI Governance Framework and production harnesses all apply at minimum:
- Length check (most APIs reject queries >200 chars; models sometimes generate long natural-language queries)
- Strip explanation text (models often generate "I'll search for: ..." prefixes in low-temperature runs)
- XSS/injection character escaping before URL encoding

The plan has no mention of query preprocessing. Raw model query → search API is not production-safe.

**Session-level caching with TTL**

Production standard: in-memory cache keyed by normalized query hash, with data-type-aware TTL. For financial data specifically:
- News queries: 15–30 min TTL (prices move; stale news misleads)
- Fundamentals queries: 24h TTL (earnings dates don't change intraday)
- General queries: 1–4h TTL

Benefits: prevents duplicate API calls within a research burst (a selector and an analyst searching for the same company news would hit the cache on the second call), reduces credit spend, and speeds up the research loop.

The plan has no caching layer for search results. During a research burst on 3 symbols, the same news query may fire 3–6 times across selector + analysts + reviewer for the same company.

**Rate limit handling — retry with backoff, not immediate throw**

Both current adapters immediately throw on non-200:

```ts
if (!response.ok) {
  throw new AppError(`Tavily search failed with ${response.status}`, "PROVIDER_UNREACHABLE");
}
```

Production standard: exponential backoff with jitter on 429, up to 3–5 retries, then graceful degradation (skip search, continue with available context) rather than aborting the step. A single rate-limit hit should not kill a research burst.

**URL attribution — store separately, always**

Financial AI systems face growing compliance pressure around source attribution (SEC Investor Advisory Committee AI disclosure guidance, Dec 2025). Production pattern:

1. Pass URLs to the model (for reasoning — "Reuters reported X")
2. Store the full URL list accessed per tool call in `api_call_log` or `tool_calls_json`
3. Never strip URLs in the adapter's normalization step

The current adapters include URLs in the normalized string but then lose them — they are not stored anywhere in the audit trail. `tool_calls_json` is always `null` today, but when Phase 0 wires it up, the search tool's result must preserve structured URL data, not a formatted string.

### What the plan should add

**Provider selection** — Tavily + Brave is correct. Tavily for analyst depth loops (chunked content, `search_depth: "advanced"`), Brave for selector's wide discovery pass (independent index, fast, cheap). The plan should also specify per-role configuration:

| Role | Provider | `search_depth` | `time_range` | `include_domains` |
|---|---|---|---|---|
| `instrument_selector` | Brave | — | `week` | — |
| `analyst_technical` | Tavily | `advanced` | `month` | — |
| `analyst_fundamental` | Tavily | `advanced` | `year` | `["sec.gov", "reuters.com", "ft.com"]` |
| `reviewer` | Tavily | `basic` | `week` | — |

Without this, all roles get generic undirected search. A fundamental analyst querying SEC filings on basic depth with no domain focus will return noise. Exa (semantic search, `depth=deep-reasoning`, 1,200 domain filters) is a stronger optional adapter for `analyst_fundamental` on stocks — worth naming in the plan.

**Implementation contracts** — the plan must specify the search tool's return shape, not just its provider:

```ts
type SearchToolResult = {
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    publishedDate: string | null;
  }>;
  query: string;           // sanitized query actually sent
  provider: string;        // 'tavily' | 'brave'
  creditsUsed: number;     // for api_call_log
  cachedAt: string | null; // if served from session cache
};
```

This shape feeds `tool_calls_json` in `agent_messages` and `api_call_log` for cost tracking. The model receives `results`; the harness logs the rest.

---

## 5. Market Data Source Assessment

The source policy in §9 is sound. Broker-native first, no silent downgrade. The instrument class → source mapping is correct.

**Gaps in the policy:**

- **How many OHLCV bars?** The `MarketDataSnapshot` type has `ohlcv: Array<{...}>` with no specified length. For technical analysis (SMA200 requires 200+ bars, ATR14 requires 14+), the snapshot must cover at least 200 bars. The plan should specify the minimum bar count by role or by technical indicator requirement.

- **Technicals computed where?** The snapshot includes pre-computed `return20d`, `atr14`, `rsi14`, `sma20/50/200`. The plan never says who computes these. Options: computed in `MarketDataService` from raw OHLCV (correct, deterministic), or fetched from a provider that pre-computes them (source-dependent, harder to audit). The plan should specify that `MarketDataService` computes technicals from raw OHLCV so the computation is reproducible from the stored `market_snapshot_json`.

- **Snapshot TTL / freshness.** The plan says cache at `(sessionId, symbol, cycleId)` level. For a session running multiple cycles in one day, how old can a snapshot be before it must be refreshed? For intraday sessions, a 15-minute-old quote snapshot may be too stale for technical analysis. The plan does not define a freshness TTL.

---

## 6. `waitForOpenThreshold` Is a Dangling Concept

§13 lists `waitForOpenThreshold` (default 0.80) as an open question. It exists in `session_risk_config`. But the plan never explains what it gates. It appears in no session loop diagram, no preflight check, no phase deliverable. If it is meant to gate order placement (e.g., "only place an order if the model's confidence exceeds 0.80"), it should be in the risk engine contract. If it's a legacy field that the new plan supersedes, the plan should say "this field is deprecated" and remove it from the data model. A field with no defined behavior is a maintenance liability.

---

## 7. Risk Register Gap

§11 risk register is missing:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| yfinance is Python-only; TypeScript adapter is not feasible | High | High | Decide on Polygon.io or FMP before Phase 1 |
| Per-step token counts not in RunTrace; mid-loop spend guard cannot fire | High | Medium | Add per-step usage to RunTrace or document that spend guard is post-run only |
| Parallel analyst partial failure has no defined behavior | Medium | Medium | Specify fail policy before Phase 2 |
| Snapshot OHLCV bar count insufficient for SMA200 computation | Medium | Medium | Specify minimum 200 bars in MarketDataSnapshot contract |

---

## 8. Tool-Use Termination Model Is Inverted

The plan uses `maxSteps` as the **primary** termination mechanism with low per-role caps (1–2 for reviewer, 5 for selector). This is not how production harnesses work and will produce bad behavior.

**The correct model: self-termination with a safety cap.**

The model signals completion by stopping tool calls or calling a terminal tool. `maxSteps` fires only when the model is misbehaving — a loop, a runaway, a bug. If the cap fires on a normal run, the cap is too low.

Every major harness follows this pattern:

| Harness | Default cap | Primary stop signal |
|---|---|---|
| LangGraph | 25 (`recursion_limit`) | Model returns to a terminal node |
| LangChain agents | 15 (`max_iterations`) | Model stops calling tools |
| AutoGen | 10 (`max_consecutive_auto_reply`) | Model outputs a terminator string |
| CrewAI | 25 (`max_iter`) | Task completion signal |
| Vercel AI SDK | No default | `stopWhen` conditions + model self-stops |

The plan's reviewer cap of 1–2 steps means the model gets one search call then is forced to synthesize regardless of whether it has enough information. At 5 steps, the selector cannot do meaningful discovery across more than a few symbols. These caps don't give the model room to work — they give it room to fail quietly.

**Production data:** without caps, runaway agents loop 60+ rounds and cost $0.16 on what should be a $0.017 run. But those are genuinely broken loops, not legitimate discovery. The right guard for cost is a **spend guard in dollars**, not a step count. Step counts are a noisy proxy for cost that breaks as soon as tool calls vary in token usage.

**What the plan should use instead:**

1. **Primary stop:** model self-terminates (stops calling tools, or calls a `submit_candidates` terminal tool)
2. **Safety cap:** `maxSteps` set high enough that good-faith work completes — 20–25 for selector, 10–12 for analysts, 6–8 for reviewer
3. **True budget control:** per-role spend guard in USD against `session_risk_config.max_ai_spend_usd`

**Terminal tool pattern for `instrument_selector`:**

```ts
tools: {
  search_web: ...,
  get_quote: ...,
  get_ohlcv: ...,
  get_news: ...,
  submit_candidates: tool({
    description: "Submit the final instrument shortlist when research is complete.",
    inputSchema: instrumentSelectionSchema,
    execute: async (candidates) => candidates,
  }),
}
```

When the model calls `submit_candidates`, the harness knows it finished with conviction. When `maxSteps` fires instead, the harness knows something went wrong and can log `finishReason: "tool_budget"`. This distinction is currently undetectable under the plan's design because the cap *is* the exit path.

The role tool matrix in §5 Option D and §8 Phase 2 should be revised: replace the step counts with spend limits and raise the safety caps.

---

## 9. Cost Center — Track External API Spend Alongside AI Spend

The plan tracks AI cost via `agent_runs.cost_usd` and guards against overspend via `session_risk_config.max_ai_spend_usd`. Market data API calls (FMP, Alpaca Data, search providers) also cost money — per-call on FMP's free tier, per-request on Tavily, per-month amortized on paid plans — but the plan has no tracking or visibility for them. As the harness grows, market data calls will happen on every research burst per symbol. Without tracking, there is no way to know what a session actually costs end-to-end.

### What to add

**New table: `api_call_log`**

```sql
CREATE TABLE api_call_log (
  id            TEXT PRIMARY KEY,
  session_id    TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  trade_id      TEXT REFERENCES trades(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,   -- 'fmp' | 'alpaca_data' | 'tavily' | 'brave' | 'exa'
  endpoint      TEXT NOT NULL,   -- '/v3/profile' | '/snapshot' | '/search' etc.
  call_type     TEXT NOT NULL,   -- 'market_data' | 'search' | 'news' | 'fundamentals'
  cost_usd      REAL,            -- null if provider charges by subscription not per-call
  credits_used  INTEGER,         -- for credit-based APIs (FMP, Tavily)
  latency_ms    INTEGER NOT NULL,
  status        TEXT NOT NULL,   -- 'ok' | 'error' | 'rate_limited'
  created_at    TEXT NOT NULL
);
```

**New summary column: `session_risk_config.max_data_spend_usd`**

Parallel to `max_ai_spend_usd`. Guards the market data budget separately — AI spend and data spend have different cost structures and should be visible independently.

**Dashboard additions:**

The existing stats dashboard shows `ai_cost_usd` per session. Add:
- `data_calls_count` — total external API calls this session
- `data_credits_used` — total FMP/Tavily credits consumed
- A combined `total_session_cost_usd` = AI cost + amortized data cost

### Per-provider cost model

| Provider | Billing model | How to log |
|---|---|---|
| FMP free | 250 calls/day hard cap | Log `credits_used: 1` per call; no `cost_usd` |
| FMP paid (~$0.0003/call at $50/mo ÷ ~167k calls) | Subscription | Log amortized `cost_usd` or just `credits_used` |
| Tavily | Credit-based: basic=1 credit, advanced=2 credits | Log `credits_used`; map to USD via account rate |
| Brave | 2,000 free/mo then per-call | Log call count; compute cost only when over free tier |
| Alpaca Data API | Free with account | Log calls for rate-limit awareness; `cost_usd: 0` |

### Why this matters for the research burst

A `balanced` research burst on 3 symbols with 2 analysts + 1 reviewer each makes roughly:
- 3 × FMP fundamentals calls = 3 credits
- 3 × FMP news calls = 3 credits
- 3 × Alpaca snapshot calls = free
- ~6 Tavily searches (analyst depth loops) = 12 credits

At Tavily's published rate (~$0.015/advanced search), that's ~$0.18 in search costs per burst on top of the AI cost. Across 10 sessions a week, that's ~$1.80/week in search spend that is currently invisible. Small now, meaningful at scale.

### Scope note

This is additive infrastructure — it does not block any phase. `api_call_log` can be inserted wherever `MarketDataService` and the search adapters make their calls. The repo pattern (one repo class per table) already supports this cleanly. The right time to add it is Phase 1 alongside `MarketDataService`, not as a separate phase.

---

## 10. One Enhancement Worth Adding

The plan lists `search_web` as the only tool available to the reviewer. The reviewer's job is "spot-check verification + synthesis." Spot-checking a claim like "AAPL earnings beat by 12%" is a factual lookup — web search is adequate. But the plan's research brief architecture means the reviewer will also receive unverified analyst markdown. A second tool, `get_quote` (read-only price check), would let the reviewer verify price-level claims without needing to re-run a full market data fetch. Low cost, high signal. Worth adding to the role tool matrix at `maxSteps: 1`.

---

## Summary Table

| Issue | Severity | Blocks |
|---|---|---|
| yfinance not callable from TypeScript — replace with Alpaca Data API v2 (OHLCV) + FMP (fundamentals + news) | Critical | Phase 1 start |
| `cycleId` missing from data model | High | Phase 2 cache correctness |
| `tool_budget` finish reason has no mechanism | High | Phase 0 correctness |
| Per-step token counts absent from RunTrace | High | Spend guard during loops |
| Autopsy trigger wrong (auto on close = LLM on every trade) — must be user-initiated | High | Phase 3 cost/correctness |
| Autopsy model, prompt, storage unspecified | Medium | Phase 3 done criteria |
| Parallel analyst partial failure undefined | Medium | Phase 2 correctness |
| `get_quote`/`get_ohlcv`/`get_news` tool contracts missing | Medium | Phase 2 implementation |
| Search returns flat string — URL/date structure lost, breaks attribution audit | High | Phase 0 audit correctness |
| No query sanitization — raw model output sent to search API | Medium | Security + result quality |
| No session-level search result cache — duplicate calls in research burst | Medium | Cost + burst latency |
| No rate-limit retry on search adapters — single 429 kills burst | Medium | Research burst reliability |
| Search config not specified per role (depth, time range, domains) | Medium | Analyst output quality |
| OHLCV bar count not specified | Medium | SMA200/technicals correctness |
| Technicals computation ownership unspecified | Low | Audit reproducibility |
| Snapshot freshness TTL unspecified | Low | Intraday session correctness |
| `waitForOpenThreshold` purpose undefined | Low | Risk engine clarity |
| `decision_maker` tool prohibition not explicit | Low | Harness enforcement |
| `maxSteps` used as primary exit instead of safety cap | High | Analyst/selector output quality |
| No terminal tool for selector — forced exit vs intentional done undetectable | High | Research burst correctness |
| Step counts used as budget proxy instead of USD spend guard | Medium | Cost control accuracy |

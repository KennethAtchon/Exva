# AI Harness Architecture — Plan

> **Date:** 2026-05-05
> **Status:** Implementation-ready
> **Deciders:** Kenneth Atchon

---

## 0. Persistence Strategy (Greenfield Schema)

This harness introduces new SQLite tables and columns (`agent_messages.cycle_id`, `agent_runs.finish_reason`, `api_call_log`, `trade_autopsies`, `session_risk_config.max_data_spend_usd`, research columns on `session_instrument_cache`, etc.). **We do not ship incremental `ALTER TABLE` migrations for existing installs.**

**Operational rule:** Treat the database as greenfield for harness work: delete the on-disk DB **or** start the app once with `EXVA_DB_REBUILD_FROM_SCRATCH=true` (see `package.json` script `dev:rebuild-db`). `runMigrations()` then drops application tables and recreates them from the canonical DDL in `electron/main/db/migrations.ts`, matching `electron/main/db/schema.ts`.

Version upgrades from pre-harness databases are out of scope until a dedicated migration story is defined.

---

## 1. Problem Statement

Exva has configurable AI roles but lacks the infrastructure that makes them reliable, auditable, and useful in live trading. `AiRuntime` sends a one-shot system + user prompt pair to a model. `AgentOrchestrator` runs a single sequential symbol pipeline. `agent_runs` stores only summary metadata. Agents receive no structured market data, cannot perform multi-step discovery, preserve no raw message trail, and cannot restart a research cycle after a trade closes.

This matters now because the strategy plan introduces methodology-based analysts and Polymarket support. Those changes only work if the harness can inject authoritative market context, bound tool use safely, and log exactly what the model saw and did.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                                        | Success Looks Like                                                                          |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Canonical AI runtime contract: message arrays, self-terminating tool loops, per-step traces | Provider adapters return full `RunTrace` with step telemetry                                |
| 2   | Inject authoritative market, fundamentals, and news context before analysis                 | Analyst prompts include `## Market Data`, `## Fundamentals`, `## News` blocks               |
| 3   | Pre-session research burst before the first trade                                           | Session start triggers selector discovery, per-symbol analysis, and review                  |
| 4   | Complete audit trail for every agent run                                                    | `agent_runs` for summary; `agent_messages` for full messages, tool calls, strategy snapshot |
| 5   | Non-LLM monitoring with cycle restart after trade close                                     | Polling, time-based exits, and cycle restart all work deterministically                     |

**Non-Goals**

| #   | Non-Goal                              | Reason                                        |
| --- | ------------------------------------- | --------------------------------------------- |
| 1   | Real-time tick streaming              | Snapshots sufficient for daily/swing sessions |
| 2   | Unrestricted tool use for all roles   | Bounded search is cheaper and auditable       |
| 3   | Cross-session collaborative research  | Sessions remain isolated                      |
| 4   | Automatic autopsy on every trade      | Autopsy is user-initiated on demand           |
| 5   | Options-chain or derivatives research | Execution surface does not support it         |

---

## 3. Background & Context

**What the harness owns:**
Prompt assembly, structured context injection, tool registration, execution bounds, retries, output validation, logging, and orchestration. Primary files: `electron/main/services/llm/runtime.ts`, `electron/main/services/llm/harness-tools.ts`, `electron/main/services/orchestration/agent-orchestrator.ts`, `electron/main/db/`.

**Related files:**

- `electron/main/services/llm/adapters/provider-adapter.ts`
- `electron/main/services/llm/runtime.ts`
- `electron/main/services/llm/harness-tools.ts`
- `electron/main/services/pipeline/prompting/strategy-prompt-context.ts`
- `electron/main/services/orchestration/agent-orchestrator.ts`
- `electron/main/services/orchestration/trade-monitor.ts`
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/agent-runs-repo.ts`

**Canonical cross-plan contracts with `trading-strategy-configuration.md`:**

1. **Role names:** `analyst_technical`, `analyst_fundamental`, `reviewer`, `decision_maker`, `instrument_selector`
2. **Audit ownership:** `agent_runs` = summary. `agent_messages` = full replay trace.
3. **Strategy snapshot location:** `agent_messages.strategy_snapshot_json`
4. **Analyst data contract:** Three injected blocks per symbol: `## Market Data`, `## Fundamentals`, `## News`
5. **Reviewer execution model:** Bounded tool-use with `search_web` only

---

## 4. Recommendation

**Hybrid bounded harness with self-terminating tool loops.**

Each role uses a differentiated execution model. Tools are role-specific. The model self-terminates when it has enough information; safety caps and spend guards fire only when something goes wrong.

| Agent                 | Tools                                                                   | Safety cap | Budget limit | Execution model                                           |
| --------------------- | ----------------------------------------------------------------------- | ---------- | ------------ | --------------------------------------------------------- |
| `instrument_selector` | `search_web`, `get_quote`, `get_ohlcv`, `get_news`, `submit_candidates` | 25 steps   | $0.15/burst  | Discovery loop; terminates by calling `submit_candidates` |
| `analyst_technical`   | `search_web`, `get_news`                                                | 12 steps   | $0.08/run    | Depth loop on injected structured data                    |
| `analyst_fundamental` | `search_web`, `get_news`                                                | 12 steps   | $0.08/run    | Depth loop on injected structured data                    |
| `reviewer`            | `search_web`                                                            | 8 steps    | $0.05/run    | Spot-check verification + synthesis                       |
| `decision_maker`      | none                                                                    | 1 step     | $0.04/run    | Single-shot structured output (no tool loop)              |

Listed tools are **policy defaults** from `ROLE_TOOL_POLICY` in `electron/main/services/llm/ai-runtime-types.ts`. At runtime, `deriveHarnessToolAvailability` and `buildHarnessToolSet` (`harness-tools.ts`) intersect policy with infrastructure: a configured **search provider** is required for `search_web` and `get_news`; **broker routing + broker registry** on `AiRuntime` is required for quote/OHLCV/news market tools. The system prompt’s “Tool Policy For This Run” section reflects **effective** tools only (same predicates as the registered `ToolSet`).

---

## 5. Tool-Use Termination Model

**Self-termination is the primary exit. Safety caps and spend guards are runaway guards only.**

The model signals completion by stopping tool calls or calling a terminal tool (`submit_candidates` for the selector). The harness distinguishes intentional completion from forced exits via `finishReason`.

```
finishReason:
  "stop"        → model finished normally (self-terminated)
  "tool_budget" → stopWhen spend guard fired (abnormal — cap was hit)
  "length"      → hit maxTokens (abnormal)
  "timeout"     → watchdog fired (abnormal)
  "error"       → provider or tool error
```

If `tool_budget` fires on a normal run, the budget is too low — raise it. Step counts are a safety rail, not a timer.

**Terminal tool pattern for `instrument_selector`:**

```ts
submit_candidates: tool({
  description: "Submit the final shortlist when research is complete.",
  inputSchema: instrumentSelectionSchema,
  execute: async (candidates) => candidates,
});
```

When the model calls `submit_candidates`, the harness records `finishReason: "stop"`. When the step cap fires instead, the harness records `finishReason: "tool_budget"` and emits a warning event. These two outcomes are distinguishable in the audit trail.

**Spend guard pattern (Vercel AI SDK `stopWhen`):**

```ts
const spendGuard =
  (maxUsd: number, inputRate: number, outputRate: number): StopCondition =>
  ({ steps }) => {
    const inTok = steps.reduce((s, st) => s + (st.usage?.inputTokens ?? 0), 0);
    const outTok = steps.reduce(
      (s, st) => s + (st.usage?.outputTokens ?? 0),
      0,
    );
    return (
      (inTok / 1_000_000) * inputRate + (outTok / 1_000_000) * outputRate >
      maxUsd
    );
  };
```

**Loop detection (standard production pattern):**

```ts
const loopGuard =
  (): StopCondition =>
  ({ steps }) => {
    const recent = steps
      .slice(-3)
      .map(
        (s) =>
          s.toolCalls
            ?.map((tc) => `${tc.toolName}:${JSON.stringify(tc.args)}`)
            .join(",") ?? "",
      );
    return recent.length === 3 && new Set(recent).size === 1;
  };
```

All roles apply: `stopWhen: [stepCountIs(safetyCap), spendGuard(roleBudget, ...), loopGuard()]`.

---

## 6. Session Loop Design

```
SESSION START
  Phase 0: PREFLIGHT
    - provider credentials
    - broker reachability
    - capital pool check
    - market-data capability check per instrument class

  Phase 1: RESEARCH BURST
    - instrument_selector runs discovery loop, calls submit_candidates when done
    - MarketHoursService filters shortlist
    - For each surviving symbol:
        - MarketDataService builds cycle snapshot (parallel)
        - analyst_technical + analyst_fundamental run in parallel
          - On total failure of both: symbol dropped with warning event
          - On partial failure: reviewer receives available analysis + gap flag
        - reviewer runs spot-check + synthesis
    - Research briefs cached for the cycle

  Phase 2: TRADE CYCLE
    - decision_maker consumes pre-warmed research brief (no tools)
    - confidence_score checked against waitForOpenThreshold
      - if confidence < threshold: no_trade, brief logged
    - risk engine validates
    - optional human approval
    - broker order placement

  Phase 3: MONITORING
    - TradeMonitor polls at cadence derived from holding style
    - PositionManagerService.dailyCheck() enforces maxHoldDays + time-based exits
    - emit trade_closed when broker confirms close or time-based exit resolves

  Phase 4: CYCLE RESTART
    - if session limits still allow trading: restart from Research Burst with new cycleId
    - if not: stop cleanly

  AUTOPSY (user-initiated, on demand)
    - user triggers from trade detail UI
    - load agent_messages for the selected trade
    - summarize with claude-haiku-4-5-20251001 (no tools)
    - persist to trade_autopsies table
```

`**waitForOpenThreshold`:\*\* minimum `confidence_score` from `decision_maker` required before order placement proceeds. Default 0.80. If the model returns confidence below this value, the trade is logged as `no_trade` and the research brief is preserved. Checked in the risk engine after decision output validation.

---

## 7. Market Data Sources

Market data resolves by `instrumentClass + routed broker account`. No silent fallback from live data to stale scraped data.

| Instrument class    | Quote + OHLCV                             | Fundamentals                                        | News                  |
| ------------------- | ----------------------------------------- | --------------------------------------------------- | --------------------- |
| `stock`             | Alpaca Data API v2 (REST snapshots)       | Financial Modeling Prep (FMP) REST API              | FMP Stock News API    |
| `crypto`            | Coinbase Advanced public candles endpoint | Not applicable — `## Fundamentals (not applicable)` | FMP or search-derived |
| `futures`           | Broker-native / Tradovate                 | Not applicable                                      | Not applicable        |
| `prediction_market` | Polymarket CLOB + Gamma market metadata   | Not applicable                                      | Not applicable        |

**No yfinance.** yfinance is a Python scraper library with no REST API. It cannot be called from TypeScript without a Python sidecar process. FMP provides all fundamentals fields as a native REST API callable with `fetch`.

**Minimum OHLCV requirement:** 200 daily bars minimum. SMA200 requires 200 bars; ATR14 and RSI14 require at least 30. `MarketDataService` must validate bar count before returning a snapshot and emit a `WARN` event if the source cannot provide 200 bars for the requested symbol.

**Technicals computation:** `MarketDataService` computes all technical indicators (`return20d`, `atr14`, `rsi14`, `sma20`, `sma50`, `sma200`) from raw OHLCV in-process. Never fetched from a provider. This makes the computation reproducible from the stored `market_snapshot_json`.

**Snapshot freshness TTL:**

| Instrument class                 | TTL        |
| -------------------------------- | ---------- |
| `stock` (intraday session)       | 15 minutes |
| `stock` (swing/position session) | 4 hours    |
| `crypto`                         | 10 minutes |
| `prediction_market`              | 30 minutes |

A snapshot older than its TTL is refetched before use. The cycle cache key is `(sessionId, symbol, cycleId)` — a new cycle always starts with fresh data.

### Role-readiness rules

| Role                                    | Required snapshot fields                      | If unavailable                                      |
| --------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `instrument_selector`                   | quote OR searchable news                      | Continue with available sources                     |
| `analyst_technical`                     | quote + OHLCV (≥200 bars) + technicals + news | Symbol dropped from cycle with warning event        |
| `analyst_fundamental` on stock          | fundamentals + news                           | Symbol dropped from cycle with warning event        |
| `analyst_fundamental` on crypto/futures | news only                                     | Continue; inject `## Fundamentals (not applicable)` |
| `reviewer`                              | analyst briefs only                           | Continue                                            |

### Example injected blocks

```markdown
## Market Data — AAPL (as of 2026-05-05 14:32 ET, source: Alpaca)

- Price: $189.42 | Day change: +1.2% | Volume: 42.1M (1.3x avg)
- 20d return: +4.1% | ATR(14): 3.21 | RSI(14): 58.4
- SMA(20): 186.7 | SMA(50): 182.5 | SMA(200): 175.8

## Fundamentals — AAPL (source: FMP)

- Market cap: $2.9T | Sector: Technology | Industry: Consumer Electronics
- P/E: 29.4x | Revenue growth: +6.2% YoY
- Next earnings: 2026-07-24 | Analyst consensus: Moderate Buy

## News — AAPL (source: FMP, as of 2026-05-05)

1. Apple reports record services revenue — Reuters, 2026-05-02
2. AAPL upgraded to Buy by Goldman Sachs — MarketWatch, 2026-05-01
3. Vision Pro sales disappoint analysts — The Verge, 2026-04-28
```

---

## 8. Search Tool Contract

### Return shape

All search adapters return a structured object, never a flat string:

```ts
type SearchToolResult = {
  results: Array<{
    url: string;
    title: string;
    snippet: string; // extracted text, 500–2000 chars max per result
    publishedDate: string | null;
  }>;
  query: string; // sanitized query actually sent to provider
  provider: "tavily" | "brave" | "exa";
  creditsUsed: number;
  cachedAt: string | null; // ISO timestamp if served from session cache
};
```

URLs are preserved in the result and stored in `tool_calls_json` per step. The model receives the full structured results; the harness logs URL attribution for audit.

### Query sanitization

Every query is sanitized before reaching the provider:

1. Truncate to 200 characters (provider limit)
2. Strip leading explanation text ("I'll search for...", "Let me look up...")
3. Escape characters that break URL encoding

### Session-level caching

Search results are cached in-memory per session, keyed by normalized query hash (lowercased, punctuation stripped). TTL by content type:

| Query type              | TTL        |
| ----------------------- | ---------- |
| News / financial events | 20 minutes |
| Company fundamentals    | 4 hours    |
| General market context  | 1 hour     |

Before every search API call the harness checks the cache. A cache hit sets `cachedAt` in the result and skips the API call entirely. This prevents duplicate credit spend during research bursts where multiple roles may search for the same company.

### Rate limit handling

All search adapters retry on 429 with exponential backoff + jitter:

- Attempt 1: immediate
- Attempt 2: 1s + random(0–1s)
- Attempt 3: 2s + random(0–2s)
- Attempt 4: 4s + random(0–4s)
- After 4 failures: log error, return empty results, continue (do not abort the step)

A single rate-limit hit does not kill a research burst.

### Per-role search configuration

**Implementation (today):** `search_web` and search-backed `get_news` use whichever search account is selected as the session or workspace default (`Brave`, `Tavily`, etc.). There is **no** per-role routing in code yet.

**Design intent (not implemented):** differentiate adapters/parameters by role:

| --------------------- | -------- | -------------- | ------------ | ------------------------------------------------- |
| `instrument_selector` | Brave | — | `week` | — |
| `analyst_technical` | Tavily | `advanced` | `month` | — |
| `analyst_fundamental` | Tavily | `advanced` | `year` | `["sec.gov", "reuters.com", "ft.com", "wsj.com"]` |
| `reviewer` | Tavily | `basic` | `week` | — |

Tavily `advanced` depth (2 credits) is worth the cost for analyst roles. Brave is used for the selector's broad discovery pass. Exa is a future optional adapter for `analyst_fundamental` on stocks (`depth=deep-reasoning`, semantic search across SEC filings).

---

## 9. Implementation Plan

### Phase 0: AI Runtime Contract + Unified Audit Model

**Goal:** Replace the one-shot adapter interface with a contract that supports message arrays, self-terminating tool loops, per-step telemetry, and a canonical trace envelope.

**Done criteria:** A provider adapter executes a bounded tool-use run and returns a `RunTrace` that `AiRuntime` persists without role-specific hacks.

#### Canonical runtime types

```ts
type StepTrace = {
  step: number;
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

type ToolCallRecord = {
  step: number;
  tool: string;
  argsJson: string;
  resultJson: string; // structured SearchToolResult or market data result
  latencyMs: number;
  error?: string;
  fromCache?: boolean;
};

type RunTrace<T = undefined> = {
  assistantText: string;
  structuredOutput?: T;
  messages: AgentMessage[];
  steps: StepTrace[]; // per-step telemetry — drives spend guard accuracy
  thinkingText?: string | null;
  finishReason: "stop" | "length" | "tool_budget" | "timeout" | "error";
  parseFallback: boolean;
  inputTokens: number; // total across all steps
  outputTokens: number;
  durationMs: number;
};

type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
};
```

`steps[]` enables per-step cost tracking and powers the spend guard's mid-loop firing. It is stored as `tool_calls_json` in `agent_messages`.

#### Provider adapter contract

```ts
interface AgentRunOptions {
  messages: AgentMessage[]; // replaces systemPrompt + userPrompt strings
  tools?: ToolSet;
  maxSteps?: number; // safety cap only — not the expected exit
  spendLimitUsd?: number; // primary budget control via stopWhen
  abortSignal?: AbortSignal;
  onStep?: (step: StepTrace) => void;
}

interface ProviderAdapter {
  readonly providerType: ProviderType;
  runAgent<T>(
    opts: AgentRunOptions & { schema?: z.ZodType<T> },
  ): Promise<RunTrace<T>>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
```

Single `runAgent()` path for both text and structured-output roles. Schema presence determines output mode.

#### Cost estimation

Per-model pricing table keyed by model ID prefix. Never hardcoded to a single model's rates. Maintained in `electron/main/services/llm/model-pricing.ts`:

```ts
const MODEL_PRICING: Array<{
  prefix: string;
  inputPer1M: number;
  outputPer1M: number;
}> = [
  { prefix: "claude-opus", inputPer1M: 15, outputPer1M: 75 },
  { prefix: "claude-sonnet", inputPer1M: 3, outputPer1M: 15 },
  { prefix: "claude-haiku", inputPer1M: 0.8, outputPer1M: 4 },
  { prefix: "gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
  { prefix: "gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
  // add models as needed
];
```

#### DB changes

Canonical DDL lives in `electron/main/db/migrations.ts` (greenfield rebuild path). New installs use:

```sql
ALTER TABLE agent_runs ADD COLUMN provider_key TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE agent_runs ADD COLUMN finish_reason TEXT NOT NULL DEFAULT 'stop';

CREATE TABLE agent_messages (
  id                     TEXT PRIMARY KEY,
  agent_run_id           TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trade_id               TEXT REFERENCES trades(id) ON DELETE CASCADE,
  cycle_id               TEXT,   -- set during research burst; null for legacy-style runs
  role                   TEXT NOT NULL,
  provider_key           TEXT NOT NULL,
  model_id               TEXT NOT NULL,
  messages_json          TEXT NOT NULL,
  thinking_json          TEXT,
  tool_calls_json        TEXT,   -- JSON array of StepTrace[]
  output_json            TEXT,
  output_schema_name     TEXT,
  parse_fallback         INTEGER NOT NULL DEFAULT 0,
  strategy_snapshot_json TEXT NOT NULL,
  market_snapshot_json   TEXT,
  created_at             TEXT NOT NULL
);
```

#### Deliverables

- `electron/main/services/llm/adapters/provider-adapter.ts` — new `runAgent()` contract
- `electron/main/services/llm/adapters/anthropic-adapter.ts` — implement `runAgent()` with `onStepFinish`, `stopWhen`
- `electron/main/services/llm/adapters/openai-adapter.ts` — same
- `electron/main/services/llm/adapters/openrouter-adapter.ts` — same
- `electron/main/services/llm/ai-runtime-types.ts` — `RunTrace`, `StepTrace`, `ToolCallRecord`, `AgentMessage`
- `electron/main/services/llm/model-pricing.ts` — per-model cost table
- `electron/main/services/llm/runtime.ts` — unified tool assembly via `harness-tools.ts`; `decision_maker` uses structured output with no tools in `runDecisionRole`
- `electron/main/db/schema.ts` + migrations DDL — `provider_key`, `finish_reason` on `agent_runs`; `agent_messages` with `cycle_id`
- `electron/main/db/repositories/agent-messages-repo.ts`
- `TradeDetail.tsx` — message trace viewer
- `DevPanel.tsx` — message trace viewer

**Dependencies:** None

**Rollback:** Keep `agent_runs` summary writes intact. Guard `agent_messages` writes behind feature flag until adapters are stable.

---

### Phase 1: Market Data + News Injection + API Cost Tracking

**Goal:** Inject authoritative data blocks into analyst prompts and track all external API call costs.

**Done criteria:** Analyst prompts include `## Market Data`, `## Fundamentals`, and `## News` built from one cached snapshot. All market data and search API calls are logged to `api_call_log`.

#### API cost tracking table

```sql
CREATE TABLE api_call_log (
  id           TEXT PRIMARY KEY,
  session_id   TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  trade_id     TEXT REFERENCES trades(id) ON DELETE CASCADE,
  cycle_id     TEXT,
  provider     TEXT NOT NULL,    -- 'fmp' | 'alpaca_data' | 'tavily' | 'brave' | 'coinbase_data'
  endpoint     TEXT NOT NULL,    -- '/v3/profile' | '/snapshot' | '/search' etc.
  call_type    TEXT NOT NULL,    -- 'market_data' | 'search' | 'news' | 'fundamentals'
  credits_used INTEGER,          -- for credit-based providers (FMP, Tavily)
  cost_usd     REAL,             -- null for subscription-based providers
  latency_ms   INTEGER NOT NULL,
  status       TEXT NOT NULL,    -- 'ok' | 'error' | 'rate_limited'
  from_cache   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
```

Add to `session_risk_config`:

```sql
ALTER TABLE session_risk_config ADD COLUMN max_data_spend_usd REAL DEFAULT 5.0;
```

#### Market data snapshot type

```ts
type MarketDataSnapshot = {
  symbol: string;
  instrumentClass: "stock" | "crypto" | "futures" | "prediction_market";
  asOf: string;
  source: string;
  barCount: number; // actual bars returned — validated ≥ 200 for technical roles
  quote: {
    price: number;
    dayChangePct: number | null;
    volume: number | null;
    volumeRatio: number | null;
    spreadBps: number | null;
  };
  ohlcv: Array<{
    ts: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  }>;
  technicals: {
    // computed by MarketDataService from ohlcv — never fetched
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
  news: Array<{
    headline: string;
    source: string;
    publishedAt: string;
    url: string;
  }>;
};
```

#### Deliverables

- `electron/main/services/market-data/market-data-service.ts`
- `electron/main/services/market-data/adapters/alpaca-market-data-adapter.ts` — quotes + OHLCV for stocks
- `electron/main/services/market-data/adapters/fmp-metadata-adapter.ts` — fundamentals + news via Financial Modeling Prep REST API
- `electron/main/services/market-data/adapters/coinbase-market-data-adapter.ts` — candles for crypto
- `electron/main/services/market-data/market-data-context-builder.ts` — builds markdown blocks from snapshot
- `electron/main/services/market-data/snapshot-readiness.ts` — role-readiness checks
- `electron/main/services/market-data/technicals.ts` — computes ATR, RSI, SMAs from raw OHLCV
- `electron/main/services/session/preflight/market-data-capability-check.ts`
- `electron/main/db/schema.ts` + migration — `api_call_log`, `max_data_spend_usd`
- `electron/main/db/repositories/api-call-log-repo.ts`
- `AiRuntime` — inject snapshot blocks for analyst roles; attach `market_snapshot_json`
- Search adapters — update to return `SearchToolResult` (structured, not flat string); add session cache; add retry backoff

**Dependencies:** Phase 0

**Rollback:** Leave snapshot service in place but stop injecting into prompts. Preflight-block unsupported classes.

---

### Phase 2: Research Burst + Tool-Use Harness

**Goal:** Replace one-shot instrument resolution with a bounded research burst that discovers, analyzes, verifies, and caches per-symbol briefs before order placement.

**Done criteria:** Session start performs selector discovery via `submit_candidates` terminal tool, parallel per-symbol analyst runs, reviewer synthesis, and stores research briefs keyed by `(sessionId, symbol, cycleId)`.

#### `session_instrument_cache` additions

```sql
ALTER TABLE session_instrument_cache ADD COLUMN cycle_id TEXT NOT NULL DEFAULT '';
ALTER TABLE session_instrument_cache ADD COLUMN research_briefs_json TEXT;
ALTER TABLE session_instrument_cache ADD COLUMN research_generated_at TEXT;
```

`cycle_id` is a UUID generated at the start of each research burst. It is stored on `session_instrument_cache` and threaded through to `agent_messages.cycle_id` for all runs in that burst. Restart after trade close generates a new `cycle_id`.

#### Research burst flow

1. Generate `cycleId = crypto.randomUUID()`.
2. `instrument_selector` runs with `submit_candidates` terminal tool. On completion, `cycleId` attached to its `agent_messages` row.
3. `MarketHoursService` filters shortlist.
4. For each surviving symbol, `MarketDataService.buildSnapshot()` runs in parallel.
5. `analyst_technical` and `analyst_fundamental` run in parallel per symbol, each with independent tool logs.

- If both fail: symbol dropped, `WARN` event emitted, cycle continues.
- If one fails: reviewer receives available analysis + explicit gap flag ("Fundamental analysis unavailable: {reason}").

6. `reviewer` runs spot-check and synthesis.
7. Research brief (reviewer output + snapshot summary) cached in `session_instrument_cache.research_briefs_json`.

#### Tool-use harness

`tool-use-harness.ts` exposes `executeToolUseHarness`, a thin wrapper over `ProviderAdapter.runAgent` (messages, optional tools, step cap, spend guard). Role-specific tool assembly lives in `ai-runtime/harness-tools.ts` and `runtime.ts`.

Harness applies: `stopWhen: [stepCountIs(safetyCapSteps), spendGuard(spendLimitUsd), loopGuard()]`.

`instrument_selector` gets `submit_candidates` plus optional discovery tools from `buildHarnessToolSet`. Tool calls are logged to `api_call_log` and included in `tool_calls_json` via `StepTrace[]`.

#### `get_quote`, `get_ohlcv`, `get_news` tool contracts

These tools are attached **only** for `instrument_selector` in today’s harness (analyst roles get `get_news` when policy + infra allow; they do not get quote/OHLCV). Implementations live in `electron/main/services/tools/market-tools.ts`: they resolve a **broker account** by instrument class and call `BrokerRegistry` adapters; OHLCV is synthetic-from-snapshot in this build; `get_news` issues a **search** query via the configured search provider (same backend family as `search_web`), not a dedicated news REST API.

```ts
// Behavioral summary (see market-tools.ts for exact schemas)
get_quote: broker-backed snapshot for symbol + instrumentClass
get_ohlcv: synthetic daily bars from latest snapshot
get_news: search-backed headlines query for symbol
```

#### Deliverables

- `electron/main/services/pipeline/execution/tool-use-harness.ts`
- `electron/main/services/tools/market-tools.ts` — `get_quote`, `get_ohlcv`, `get_news`
- `electron/main/services/tools/search-tool.ts` — `search_web` with cache + sanitization + retry
- `electron/main/services/orchestration/research-burst-service.ts`
- `electron/main/services/orchestration/market-hours-service.ts`
- `electron/main/db/schema.ts` + migration — `cycle_id`, `research_briefs_json`, `research_generated_at` on `session_instrument_cache`
- `AgentOrchestrator.start()` — invoke research burst before queueing trade cycles
- UI progress events: `research_phase_started`, `research_phase_step`, `research_phase_complete`, `research_phase_failed`

**Dependencies:** Phases 0–1

**Rollback:** Feature-flag the burst; fall back to current selector resolution. Tool-use harness is isolated from single-shot role execution.

---

### Phase 3: Monitoring Cadence + Cycle Restart

**Goal:** Keep open-position handling deterministic and restartable.

**Done criteria:** Trade close triggers cycle restart. `TradeMonitor` polls at a cadence matching holding style. User-initiated autopsy available from trade detail.

#### `TradeMonitor` cadence

```ts
const POLL_INTERVAL_MS: Record<HoldingStyle, number> = {
  intraday_flat: 5_000,
  multi_day_swing: 60_000,
  weeks_position: 300_000,
  custom: 300_000,
};
```

Timer is restarted with the correct interval when the session starts, not hardcoded.

#### `PositionManagerService.dailyCheck()`

Enforces `maxHoldDays` for all instrument classes (not just prediction markets). Called once per day at session open:

- If `trade.opened_at` + `maxHoldDays` ≤ today: close at market
- Prediction-market max-exposure cap: closes oldest trades first until under cap

#### Cycle restart

`AgentOrchestrator` subscribes to `trade_closed`. On receipt:

1. Check session limits: daily loss, profit target, AI spend, data spend, exposure caps.
2. If all limits allow: generate new `cycleId`, restart Research Burst.
3. If any limit is hit: emit `session_stopped` event, stop cleanly.

#### Autopsy (user-initiated)

Triggered from trade detail UI only. `TradeAutopsyService.summarize(tradeId)`:

1. Load all `agent_messages` rows for `trade_id`.
2. Build autopsy prompt: decision reasoning, reviewer synthesis, analyst briefs, final PnL.
3. Call `claude-haiku-4-5-20251001` with no tools (`maxTokens: 1024`).
4. Persist result to `trade_autopsies` table.

```sql
CREATE TABLE trade_autopsies (
  id          TEXT PRIMARY KEY,
  trade_id    TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,
  summary     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL DEFAULT 'user'
);
```

#### Deliverables

- `TradeMonitor` — holding-style cadence
- `electron/main/services/orchestration/position-manager-service.ts`
- `electron/main/services/orchestration/trade-autopsy-service.ts`
- `electron/main/db/schema.ts` + migration — `trade_autopsies`
- `AgentOrchestrator` — `trade_closed` subscription + cycle restart with new `cycleId`
- UI — session cycle state, autopsy button + result in trade detail

**Dependencies:** Phase 2

**Rollback:** Keep autopsy writes but disable automatic restart. Fall back to single-cycle session behavior.

---

## 10. Risk Register

| #   | Risk                                                            | Likelihood | Impact | Mitigation                                                                    |
| --- | --------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------- |
| 1   | Provider adapters expose step telemetry inconsistently          | Medium     | High   | Phase 0 adapter tests with replay fixtures per provider                       |
| 2   | FMP free tier (250 calls/day) exhausted during development      | Medium     | Low    | Use session cache aggressively; upgrade to starter plan for testing           |
| 3   | Fundamental analyst receives incomplete stock data              | Medium     | High   | Snapshot readiness gating; drop symbol rather than inject partial data        |
| 4   | Research burst exceeds AI budget                                | Medium     | Medium | Per-role spend guard in USD; selector `submit_candidates` terminal tool       |
| 5   | Tool-use loops repeat uselessly                                 | Medium     | Medium | `loopGuard()` stopWhen condition detects repeated `(tool, args)` fingerprints |
| 6   | `agent_messages` grows quickly                                  | High       | Low    | Retention policy: archive rows older than 90 days                             |
| 7   | Alpaca Data API v2 unavailable for a symbol (OTC, foreign)      | Medium     | Medium | Drop symbol from cycle with preflight warning                                 |
| 8   | Parallel analyst errors collapse reviewer with incomplete input | Medium     | Low    | Reviewer receives gap flag; decision maker can still proceed                  |
| 9   | Cycle restart loops in sideways markets                         | Medium     | Medium | Session-level stop conditions + cooldown between cycles                       |
| 10  | FMP news freshness insufficient for intraday sessions           | Low        | Medium | Fall back to search-derived news for intraday                                 |

---

## 11. Success Criteria

| Goal                      | Metric                                                   | Target                     | How Measured                    |
| ------------------------- | -------------------------------------------------------- | -------------------------- | ------------------------------- |
| Runtime contract          | % adapters returning canonical `RunTrace` with `steps[]` | 100%                       | Adapter tests                   |
| Market data injection     | % analyst runs with non-null `market_snapshot_json`      | 100% for supported classes | DB query                        |
| Audit coverage            | % `agent_runs` with matching `agent_messages` row        | 100%                       | DB join                         |
| Research burst adoption   | % sessions completing burst before first trade           | 90%                        | Session events                  |
| Selector self-termination | % selector runs ending via `submit_candidates` vs cap    | >85%                       | `finish_reason` in `agent_runs` |
| Cost control (AI)         | Average AI spend per research cycle                      | <$0.50                     | `agent_runs.cost_usd`           |
| Cost control (data)       | Average data API spend per research cycle                | <$0.20                     | `api_call_log`                  |
| Monitoring correctness    | % closed trades followed by cycle restart or clean stop  | 95%                        | Session event sequence          |

---

## 12. Open Questions

| #   | Question                                                                           | Owner | Needed By          |
| --- | ---------------------------------------------------------------------------------- | ----- | ------------------ |
| 1   | Should `waitForOpenThreshold` default stay at 0.80 after first 25 research bursts? | Ken   | Post-launch tuning |
| 2   | Should `weeks_position` polling use 5m or 15m by default?                          | Ken   | Post-launch tuning |
| 3   | How many days of `agent_messages` traces stay hot before archival?                 | Ken   | Post-launch tuning |
| 4   | Should Exa be added as a third search adapter for `analyst_fundamental`?           | Ken   | Phase 2 planning   |

---

## 13. Future Work

- Human-initiated prompt improvement from autopsy history
- Cross-cycle comparative analytics for selector quality
- Exa adapter for fundamental research on public companies
- Richer replay tooling for prompt/trace diffing between profitable and unprofitable trades
- Search result deduplication across roles in the same research burst (shared session cache partially addresses this)

# Trading Bot Observability & Function — Deep Plan

> **Date:** 2026-05-10
> **Status:** Draft
> **Owner:** Kenneth Atchon
> **Audience:** Solo developer (Kenneth)
> **Scope:** All 7 items in `docs/TODO.md` — root-caused and sequenced for implementation

---

## 1. Executive Summary

The trading bot is currently running without producing any trades in mock/sandbox mode. On the surface this looks like a bug, but a deeper read of the logs (`docs/hello.json`) reveals the AI pipeline is working correctly — it is rejecting instruments because the mock data actively signals no-trade conditions. The mock OHLCV generates a deterministic sideways-to-declining pattern. The mock news returns identical neutral headlines for every symbol. When combined, a momentum strategy correctly sees no setup and submits an empty candidate list.

This is the core of TODO item #4, and it cascades into all the other debugging frustrations: if the bot never trades, you can never validate that the pipeline, risk engine, and DevPanel work end-to-end. Once mock data is fixed, the remaining items — observability gaps, truncated logs, missing role context in logs, and weak DevPanel signal — become the next layer of work.

The plan sequences fixes so that each phase leaves the system in a testable, valid state. Phase 1 fixes mock data so trades actually happen. Phase 2 removes all truncation and adds role context to logs so you can see exactly what happened. Phase 3 enriches the DevPanel with decision context so you can read a "why did/didn't this trade" answer without digging into raw JSON. Phase 4 addresses search quality by making the search result payload more useful to the AI.

What makes this work non-trivial is that several of these items interact: the DevPanel "External" tab is a dead stub, the `run-agent-execute` adapter logs the role as `undefined`, the `RunCard` in the DevPanel truncates AI output to 500 chars, and the mock scenario is hardcoded to "sideways" which genuinely has zero momentum signal for a momentum-only strategy. Fixing one without the others gives partial observability.

---

## 2. Problem Statement

### 2.1 Bot never produces trades in mock mode (TODO #4)

**Root cause confirmed from logs + code:**

`MockBrokerAdapter.getMockOhlcv()` uses `bias: "sideways"` as default with `SCENARIO_DRIFT["sideways"] = 0.0`. The price generation formula starts from `base * exp(-drift * barCount)` which equals `base * 1` for zero drift, then adds noise via `seededNormal`. The noise is tiny (`dailyVol = 0.015`) and the seeded RNG produces consistent small-negative results. Net effect: 30 bars of gentle decline. NVDA mock price goes from 347 → ~342 over 30 days.

`DEFAULT_MOCK_NEWS` returns three identical headlines for every symbol — all neutral ("markets steady", "no significant news"). The AI receives the same news for NVDA, TSLA, SOL, BTC, and PLTR.

The AI (correctly) reads this data and finds no momentum breakout. It calls `submit_candidates` with `{"instruments":[]}` on every cycle. The `validateSelectorOutput` function never runs because there are no candidates to validate.

**Evidence:** Both log cycles in `hello.json` show step 7 and step 6 as `submit_candidates` with `{"instruments":[]}` after full search + quote + OHLCV + news cycles.

### 2.2 Search returns snippets only, AI cannot read content (TODO #1, #3)

The `DuckDuckGoAdapter.search()` fetches HTML and regex-parses result blocks. It returns up to 5 results, each with a URL, title, and a snippet clamped to 2000 chars. The snippet is extracted from the `result__snippet` class in DDG HTML — often just the meta description or a page blurb.

The AI receives title+snippet but cannot navigate to URLs. For a momentum strategy looking for "current breakout setups", getting back "Best Swing Trading Stocks List (US and CAD) - Updated Regularly" as a snippet provides zero actionable signal — no symbol names, no price levels, no catalyst descriptions.

Additionally: the `resultPreview` logged in `run-agent-execute.ts` is sliced to 200 chars, making the full 5-result response invisible in logs. This contributes to the perception that only one URL was returned (TODO #3) — the full result object does have multiple URLs.

### 2.3 AI output is truncated in DevPanel (TODO #5)

Two distinct truncation layers:

1. **Log layer** (`run-agent-execute.ts:127,251`): `userPromptPreview: prompt.slice(0, 300)` and `responsePreview: result.text.slice(0, 500)`. Tool-call logs also emit truncated `argsPreview` and `resultPreview`. These are log-entry-only preview field names with truncated payloads — the DB storage is already untruncated — but they make the common log file incomplete for debugging and need to be upgraded to full-value fields.

2. **DevPanel UI layer** (`DevPanel.tsx:687`): `RunCard` renders `run.output_text.slice(0, 500)` with a trailing `…`. No expand button. The `JsonBlock` component truncates to 2000 chars with a "show full" toggle. Both cap analysis output that can easily exceed 2,000 tokens.

The database (`agent_runs.output_text`, `agent_messages.output_json`) stores full content. The truncation is purely in UI rendering.

### 2.4 Role name absent from `run-agent-execute` logs (TODO #6)

`executeRunAgent()` in `run-agent-execute.ts` logs `modelId` but does not receive or log the agent `role`. When reading logs, entries from scope `"run-agent-execute"` show which model ran but not which pipeline stage (selector vs technical analyst vs decision maker). With 5 roles per cycle this is a significant observability gap.

The `role` is available in `runtime.ts` at all call sites but is not passed through `RunAgentExecuteParams`.

### 2.5 DevPanel doesn't explain trade decisions (TODO #7)

When clicking an event row with no `trade_id` (all `instrument_selector` events, orchestrator events), the Inspector panel shows zero useful data in the Runs and Trace tabs. The "External" tab is a static stub that always returns "No external calls recorded for this selection."

When a trade does exist, clicking it shows Runs + Trace, but neither tab explains the decision narrative — specifically: why did the decision maker say no_trade? What was the confidence? What did the reviewer flag? The `output_json` for the decision maker contains `reasoning` and `confidence`, but these are buried in collapsed JSON.

---

## 3. Goals, Non-Goals, and Invariants

### Goals

| # | Goal | Success Looks Like |
|---|------|--------------------|
| G1 | Mock mode produces actual trades | Session in mock mode starts, runs through selector → analyst → reviewer → decision maker, and places at least one mock trade without changes to the configured strategy |
| G2 | AI output never truncated in DevPanel | RunCard shows full output text, JsonBlock shows full JSON, no `…` cut-offs |
| G3 | Role name in all logs | Every `run-agent-execute` log line includes the agent role; grep on `"instrument_selector"` finds adapter-level logs |
| G4 | DevPanel shows decision context | Clicking any session event shows: which instruments were considered, why they passed/failed validation, what reasoning the decision maker gave, and what the final decision was |
| G5 | Search results logged fully | Full search result JSON visible in DevPanel external calls tab or trace for debugging |
| G6 | Mock news is bias-aligned | Mock news content reflects the configured scenario bias (bullish news for bullish scenario) |

### Non-Goals

| # | Non-Goal | Why It Is Out Of Scope |
|---|----------|------------------------|
| N1 | Real market data integration | Requires broker API credentials; separate initiative |
| N2 | Replacing DuckDuckGo with Brave/Tavily for search quality | Separate cost decision; fixing mock mode unblocks testing without it |
| N3 | Full-page content fetching from search URLs | Significant complexity; not needed to unblock mock testing |
| N4 | AI model swap | Model quality is not the blocking issue; mock data is |
| N5 | New DevPanel pages or navigation redesign | Scope is enriching existing inspector panel only |

### Invariants

| # | Invariant | Why It Must Hold |
|---|-----------|------------------|
| I1 | DB storage is never truncated | AI output in `agent_runs.output_text` and `agent_messages.output_json` must remain full — these are the audit trail |
| I2 | Mock mode isolation does not affect live sessions | Changes to `MockBrokerAdapter` or mock news must not bleed into real broker sessions |
| I3 | `validateSelectorOutput` gate stays intact | The quote/news/rationale validation in `agent-orchestrator.ts:480-510` is a safety check; do not weaken it to force trades |
| I4 | Pino redact rules unchanged | `log.ts` redacts `api_key`, `secret_key`, etc. — do not bypass for any debugging feature |
| I5 | Search tool spend guard active | `maxDataSpendUsd` limit in `createSearchTool` must remain enforced |

---

## 4. Current State

### 4.1 Architecture: How a Trade Cycle Works

```
Session start → AgentOrchestrator.start()
  → resolveInstruments()  [checks cache, runs AI selector if needed]
    → runInstrumentSelector()  [AiRuntime]
      → buildHarnessToolSet()  [submit_candidates, search_web, get_quote, get_ohlcv, get_news]
      → adapter.runAgent()     [executeRunAgent() in run-agent-execute.ts]
      → parseInstrumentSelection(trace)
      → validateSelectorOutput()  [quote + news + rationale + strategy filter]
  → enqueueTradeCycles(instruments)
    → for each instrument: runTradeCycle()
      → runAiPipeline()
        → runAnalyst(technical)   [AiRuntime.runAnalyst]
        → runAnalyst(fundamental) [AiRuntime.runAnalyst]
        → runReviewer()           [AiRuntime.runReviewer]
        → runDecisionMaker()      [AiRuntime.runDecisionRole]
      → createTradeFromDecision()
      → riskEngine.validateDecision()
      → placeRoutedOrder()  → BrokerAdapter
```

### 4.2 Mock Data Layer

**File:** `electron/main/services/broker/adapters/mock-adapter.ts`

`MockBrokerAdapter` is a fully in-memory broker. `getMockOhlcv(symbol, barCount=30)` generates bars using a seeded LCG RNG. The price seed is `symbolSeed(symbol)` — a sum of character codes. For "NVDA" this produces 347. Prices are stable across runs (deterministic by symbol string).

The `MockScenario` defaults to `{}` which resolves to `bias: "sideways"`. The `SCENARIO_DRIFT` table maps sideways to 0.0 daily drift. The RNG noise produces slightly negative moves on average given the seeded distribution.

**File:** `electron/main/services/ai/tools/market-tools.ts`

`DEFAULT_MOCK_NEWS` is a module-level constant: 3 headlines, all neutral, returned identically for every symbol query.

**Who instantiates the mock adapter:**
`broker-registry.ts` creates adapters from stored `BrokerAccount` rows. The `MockBrokerAdapter` is constructed with `scenario: {}` — no bias is passed from the session or strategy. There is no mechanism to configure the mock scenario from the UI.

### 4.3 Search Layer

**Files:** `search/adapters/duckduckgo-adapter.ts`, `tools/search-tool.ts`

DuckDuckGo: regex-parses HTML from `https://html.duckduckgo.com/html/`. Returns up to 5 results. Snippets clamped to 2000 chars. The `search_web` tool wraps `adapter.search()` and returns the full `SearchToolResult` to the AI. The AI sees: `{results: [{url, title, snippet, publishedDate},...], query, provider}`.

The `sanitizeSearchQuery` strips injected content. The tool description is: `"Search the web for current information."` — extremely generic.

**Observed search quality:** Queries like "top momentum stocks current breakouts NASDAQ NYSE 2024 2025 swing trading" return index pages and listing sites ("Best Swing Trading Stocks List - Updated Regularly") rather than specific stock names with catalysts. The AI receives URLs but no list of actual symbols from the page content.

### 4.4 Logging Layer

**File:** `electron/main/services/infra/log.ts`

Pino logger, multi-stream (stdout + daily file in `~/.exva/logs/`). `createLogger(scope)` creates a child logger with a `scope` field. Scopes in use: `"main"`, `"app-services"`, `"ai-runtime"`, `"run-agent-execute"`, `"secrets-service"`, `"broker-routing-service"`.

`run-agent-execute.ts` logs at start: `modelId, temperature, hasTools, toolNames, systemChars, promptChars` — no role. At complete: `finishReason, steps, inputTokens, outputTokens, durationMs, totalCostUsd` — no role.

### 4.5 DevPanel

**File:** `src/pages/DevPanel.tsx`

Four diagnostic cards (Runtime Identity, AI Role Matrix, Execution, Stream) + EventTimeline + InspectorPanel.

InspectorPanel has 5 tabs:
- **Event**: shows event metadata, message
- **Runs**: loads `api.getAgentTraces(tradeId)` — requires `trade_id` on the selected event
- **Trace**: loads `api.getTradeDetail(tradeId)` — requires `trade_id`
- **External**: static stub ("No external calls recorded")
- **Raw**: raw JSON of event row

**Problems:**
1. `selRuns`/`selMessages` only load when `sel?.trade_id` is present. Selector events have no `trade_id`, so Runs/Trace tabs are always empty for those.
2. `RunCard` renders `run.output_text.slice(0, 500)` — hardcoded truncation.
3. `ExternalCallsTab` is a static stub.
4. Decision context (reasoning, confidence, no_trade rationale) is buried in `output_json` JsonBlock.
5. `validateSelectorOutput` rejection reasons are never persisted or surfaced — an instrument can pass DuckDuckGo search, get a quote, and still fail the `hasDiscoveryEvidence` or `contradictsStrategy` check silently.

### 4.6 Observed Pain Points Summary

| Pain Point | Root Cause | File |
|------------|------------|------|
| Zero trades in mock | Sideways OHLCV + neutral news → AI correctly passes on everything | `mock-adapter.ts:118`, `market-tools.ts:27` |
| Can't see why selector rejected | `validateSelectorOutput` results not logged or stored | `agent-orchestrator.ts:480` |
| AI output truncated in UI | `RunCard` slices to 500 chars | `DevPanel.tsx:687` |
| Role absent from adapter logs | `RunAgentExecuteParams` has no `role` field | `run-agent-execute.ts:10` |
| External tab is dead | `ExternalCallsTab` returns static text | `DevPanel.tsx:749` |
| Selector trace not inspectable | Inspector requires `trade_id`; selector runs lack one | `DevPanel.tsx:916-932` |

---

## 5. Desired End State

### 5.1 Mock Mode

`MockBrokerAdapter` is constructed with a `MockScenario` that reflects the session's strategy type. For momentum strategies: `bias: "bullish"`. For mean-reversion: `bias: "volatile"`. The bias is derivable from `WorkspacePrefs` or a hardcoded dev override. Bullish OHLCV generates a rising 30-day trend (drift = +0.005/day) with clear upward structure.

`DEFAULT_MOCK_NEWS` is replaced with scenario-specific content. Bullish scenario news references catalysts, earnings beats, volume surges. Different symbols receive different news with specific instrument mentions.

Result: the AI instrument selector sees a rising trend + bullish news for multiple candidates and submits at least 1-3 instruments. The trade pipeline executes fully in mock mode.

### 5.2 Logging

`RunAgentExecuteParams` gains a `role?: AgentRole` field. All start/step/complete log lines in `run-agent-execute.ts` emit `role` when present. The `ai-runtime.ts` call sites pass `role` through. Grepping `"instrument_selector"` in logs returns all adapter-level log lines for that role.

Common log file entries stop using preview-style field names and truncated values for AI inputs/outputs and tool-call payloads. `userPromptPreview`, `responsePreview`, `argsPreview`, and `resultPreview` are renamed to full-value fields such as `userPrompt`, `responseText`, `toolArgs`, and `toolResult`, and each field logs the complete untruncated payload so the shared log file is a complete debugging source without having to cross-reference the DB.

### 5.3 DevPanel

**RunCard:** Renders full `output_text`. An inline "collapse/expand" toggle hides text beyond 800 chars by default but shows a character count and expand button. No hard truncation.

**Selector event inspection:** When the selected event has no `trade_id` but has a `cycle_id`, the DevPanel loads agent runs and messages by `cycle_id` instead. The Runs and Trace tabs populate for selector runs.

**Decision context panel:** A dedicated "Decision" tab (or enriched Event tab) shows:
- Instrument considered
- Decision: TRADE or NO_TRADE
- Confidence score
- Reasoning text (full, scrollable)
- Which validation gates passed/failed (for selector)

**Selector rejection log:** `validateSelectorOutput` emits a structured log for each rejected instrument: which gate failed and why. This is emitted as an orchestrator `DEBUG` event and stored in `events` table.

**External calls tab:** Populated from `api_call_log` for the current session/cycle. Shows each search call: provider, query, latency, credits, status, result count.

### 5.4 Search

Search tool description updated to be more specific about expected query format and what useful output looks like. No structural change to adapters.

---

## 6. Gap Analysis

| Area | Current State | Target State | Required Change |
|------|---------------|--------------|-----------------|
| Mock OHLCV | Sideways bias, deterministic decline | Bullish bias with clear uptrend for momentum | `MockBrokerAdapter` constructor accepts strategy-derived scenario |
| Mock news | 3 neutral identical headlines for every symbol | Bullish, symbol-specific headlines that mention the instrument | Replace `DEFAULT_MOCK_NEWS` with scenario-aware factory |
| Mock scenario wiring | Hardcoded `scenario: {}` in registry | Registry reads from a mock config or session strategy | `broker-registry.ts` passes scenario to `MockBrokerAdapter` |
| Role in logs | Missing from `run-agent-execute` logs and payload fields are preview-truncated | Present on all log lines in adapter with full payload fields | Add `role` param to `RunAgentExecuteParams`, thread through, rename preview fields to full-value names, and log full payloads |
| UI truncation | `RunCard` cuts at 500 chars, `JsonBlock` at 2000 | Full text with collapse toggle | Remove hard slice, add expand in `RunCard` |
| Selector inspection | Requires `trade_id`; selector has none | Load by `cycle_id` when no `trade_id` | DevPanel `useEffect` checks `cycle_id` fallback |
| Decision context | Buried in `output_json` JsonBlock | Dedicated rendered section | Parse decision fields and render as `DataRow` cards |
| Selector rejections | Silent | DEBUG events per rejection | Emit event in `validateSelectorOutput` |
| External calls tab | Static stub | Live `api_call_log` data | Wire IPC handler + fetch by `cycle_id`/`session_id` |
| Search tool description | Generic | Strategy-aware hints | Update string in `search-tool.ts` |

**Hard gaps and coupling risks:**

- The `cycle_id` on `agent_messages` is stored but the DevPanel load path only checks `trade_id`. The IPC handler for `getAgentTraces` likely filters by `trade_id`. Need to verify and add a `cycle_id` path.
- `MockBrokerAdapter` is constructed in `broker-registry.ts` with no scenario. The scenario needs to come from somewhere — simplest is a dev override env var or a hardcoded "bullish" for mock sessions.
- The `validateSelectorOutput` loop emits nothing — adding debug events here requires `eventsRepo` and `sessionId` to be accessible inside the orchestrator private method (they already are via `this.deps`).

---

## 7. Options Considered

### Option A: Fix mock data only (minimal)

Make mock OHLCV bullish by defaulting `MockBrokerAdapter` to `bias: "bullish"`. Replace mock news with bullish headlines.

| Dimension | Assessment |
|-----------|------------|
| Build complexity | Low — 2-3 file changes |
| Migration risk | None — mock only |
| Runtime risk | None — no production path |
| Reversibility | High — trivially revertible |
| Team fit | Easy |
| Testability | Unblocks trade pipeline end-to-end |
| Maintainability | Leaves no framework for configuring scenarios; hardcoded bullish is a hack |

Downside: `"bullish"` hardcoded globally means a mean-reversion session can't test its logic. No scenario configurability. The fix works for now but creates a new assumption.

### Option B: Scenario-aware mock with strategy derivation (recommended)

`MockBrokerAdapter` is constructed with a `MockScenario`. `BrokerRegistry` reads a `mockScenario` field from workspace prefs or a simple config. A default "bullish with momentum" scenario is provided for stock/crypto mock accounts. The `DEFAULT_MOCK_NEWS` constant becomes a `scenarioMockNews(scenario)` factory that returns symbol-appropriate headlines.

| Dimension | Assessment |
|-----------|------------|
| Build complexity | Medium — 4-5 files, scenario factory, registry wiring |
| Migration risk | Low |
| Runtime risk | None |
| Reversibility | High |
| Team fit | Moderate — small API surface change |
| Testability | Excellent — can test bullish/bearish/volatile pipelines |
| Maintainability | Clean — scenario is explicit and testable |

### Option C: Connect real broker for testing (overkill)

Use a real paper trading account (Alpaca paper mode).

| Dimension | Assessment |
|-----------|------------|
| Build complexity | High — credential setup, API compliance |
| Migration risk | Medium — external dependency |
| Runtime risk | API rate limits, data costs |
| Reversibility | Medium |
| Team fit | Low for solo dev without credentials configured |
| Testability | Good for real market data; bad for repeatable test scenarios |
| Maintainability | Depends on external API stability |

### Option D: Status quo

Don't fix mock data; manually configure a `manual_shortlist` session with specific instruments and skip the AI selector.

| Dimension | Assessment |
|-----------|------------|
| Build complexity | None |
| Migration risk | None |
| Runtime risk | None |
| Reversibility | N/A |
| Team fit | Easy workaround |
| Testability | Limited — bypasses the AI selector you want to test |
| Maintainability | Doesn't fix the actual problem |

---

## 8. Recommendation

**Implement Option B** (scenario-aware mock) for mock data, combined with all observability items in parallel phases.

Option A is too brittle — hardcoding bullish globally will cause confusion when testing non-momentum strategies. Option B adds ~30 lines of code and makes the intent explicit. Option C is premature. Option D deliberately avoids the problem.

For observability: all items (TODO #5, #6, #7) are independent low-risk changes. They don't interact and can be parallelized within a phase.

**Key assumption:** The `broker-registry.ts` constructs `MockBrokerAdapter` at registration time and can receive a scenario. If the registry is stateless/singleton this is straightforward. If adapters are reconstructed per-request, scenario passing is still the same shape.

**What would change this recommendation:** If real Alpaca paper trading credentials exist and are already configured, Option C becomes viable and would provide much higher-quality test data.

---

## 9. Detailed Design

### 9.1 Phase 1: Mock Data Fix

#### 9.1.1 MockBrokerAdapter — Bullish Scenario Default

**File:** `electron/main/services/broker/adapters/mock-adapter.ts`

Change the default constructor scenario from `{}` to a bullish preset:

```ts
const DEFAULT_MOCK_SCENARIO: MockScenario = {
  bias: "bullish",
  volatilityPct: 0.018,
  trendPctPerDay: 0.006,
};

constructor(private readonly scenario: MockScenario = DEFAULT_MOCK_SCENARIO) {}
```

With `trendPctPerDay: 0.006`, a $100 base price rises to ~$120 over 30 bars — a clear uptrend any momentum AI will recognize.

#### 9.1.2 Scenario-Aware Mock News

**File:** `electron/main/services/ai/tools/market-tools.ts`

Replace the flat constant with a factory:

```ts
export const MOCK_NEWS_BY_SCENARIO: Record<MockScenarioBias, MockNewsItem[]> = {
  bullish: [
    {
      title: "Momentum surge: breakout candidates showing relative strength vs. market",
      snippet: "Several liquid names are posting multi-week highs on above-average volume. Sector rotation into growth continues as institutional positioning shifts.",
      url: "https://mock.local/news/bullish-1",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Technical setup: flag continuation patterns emerging across growth names",
      snippet: "Chart structures showing tight consolidation after recent breakouts. RSI holding above 50 with MACD crossover in progress on multiple instruments.",
      url: "https://mock.local/news/bullish-2",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Volume confirms breakout: institutional accumulation detected in select names",
      snippet: "On-balance volume indicators trending up. Block trades visible in recent tape. Risk-on sentiment supporting momentum entries.",
      url: "https://mock.local/news/bullish-3",
      publishedAt: new Date().toISOString(),
    },
  ],
  bearish: [
    {
      title: "Distribution phase: high-volume selling in recent sessions",
      snippet: "Broad distribution visible across major indices. Key support levels being tested. Short-side setups emerging in overextended names.",
      url: "https://mock.local/news/bearish-1",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Market breadth weakening: new highs collapse as selling broadens",
      snippet: "Advance/decline line diverging from index price. Risk-off sentiment; defensive positioning increasing.",
      url: "https://mock.local/news/bearish-2",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Failed breakouts: momentum names reversing sharply on earnings misses",
      snippet: "Multiple growth names failing at resistance. Short-side momentum building as longs capitulate.",
      url: "https://mock.local/news/bearish-3",
      publishedAt: new Date().toISOString(),
    },
  ],
  sideways: [
    /* keep current neutral headlines */
    ...DEFAULT_MOCK_NEWS,
  ],
  volatile: [
    {
      title: "Volatility spike: intraday swings expanding across asset classes",
      snippet: "VIX elevated. Rapid mean-reversion moves creating short-term setups. Wide bid/ask spreads in some names.",
      url: "https://mock.local/news/volatile-1",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Choppy tape: both sides active as market digests macro uncertainty",
      snippet: "No clear directional trend. Oscillating between support and resistance. Both breakout and mean-reversion setups active.",
      url: "https://mock.local/news/volatile-2",
      publishedAt: new Date().toISOString(),
    },
    {
      title: "Range-bound leaders: sector rotation creating inter-day reversions",
      snippet: "Sector ETF spreads widening intraday. Oversold bounces and overbought fade setups visible in liquid names.",
      url: "https://mock.local/news/volatile-3",
      publishedAt: new Date().toISOString(),
    },
  ],
};

export function scenarioMockNews(bias: MockScenarioBias = "bullish"): MockNewsItem[] {
  return MOCK_NEWS_BY_SCENARIO[bias];
}

// Keep for backwards compat (used in harness-tools and runtime):
export const DEFAULT_MOCK_NEWS = MOCK_NEWS_BY_SCENARIO.bullish;
```

**File:** `electron/main/services/ai/ai-runtime/runtime.ts`

Update `getMockContext()` to pass the mock adapter's scenario bias:

```ts
private async getMockContext(sessionId: string): Promise<{...}> {
  const mockAdapter = await this.resolveMockAdapter(sessionId);
  if (!mockAdapter) return { isMock: false, getMockOhlcv: undefined, mockNewsData: undefined };
  const bias = mockAdapter.getScenarioBias(); // new accessor
  return {
    isMock: true,
    getMockOhlcv: (symbol: string) => mockAdapter.getMockOhlcv(symbol),
    mockNewsData: scenarioMockNews(bias),
  };
}
```

Add to `MockBrokerAdapter`:

```ts
getScenarioBias(): MockScenarioBias {
  return this.scenario.bias ?? "bullish";
}
```

#### 9.1.3 Broker Registry Wiring

**File:** `electron/main/services/broker/broker-registry.ts`

When constructing a `MockBrokerAdapter`, pass the default scenario explicitly rather than `{}`. This is already resolved by the `DEFAULT_MOCK_SCENARIO` change above — no registry change required if the default is the right one.

If scenario configurability per-session is needed later, it can be stored in `WorkspacePrefs` and read here. Out of scope for now.

### 9.2 Phase 2: Logging — Role in Adapter Logs

**File:** `electron/main/services/ai/adapters/run-agent-execute.ts`

Add `role` to `RunAgentExecuteParams`:

```ts
export interface RunAgentExecuteParams<T> {
  // ...existing fields...
  role?: string;  // AgentRole — optional for backward compat
}
```

Thread into all logger calls and rename preview fields to full-value fields in the common log file:

```ts
logger.info(
  {
    role: params.role ?? null,
    modelId: params.modelId,
    userPrompt: prompt,
    // ...rest unchanged
  },
  "execute run agent start",
);
```

```ts
logger.info(
  {
    role: params.role ?? null,
    modelId: params.modelId,
    step: stepIndex + 1,
    tool: String(tc.toolName),
    toolArgs: tc.input,
    toolResult: result,
  },
  "agent tool call",
);
```

```ts
logger.info(
  {
    role: params.role ?? null,
    modelId: params.modelId,
    // ...existing complete fields
  },
  "execute run agent complete",
);
```

**Files:** `electron/main/services/ai/adapters/anthropic-adapter.ts`, `openai-adapter.ts`, `openrouter-adapter.ts`

Each adapter's `runAgent()` call passes `role` through to `executeRunAgent()`. The adapters receive `role` from `AiRuntime.runRole()` / `runDecisionRole()` / `runInstrumentSelector()` which already have access to `role`.

In `runtime.ts`, all three `withProviderRetry(() => adapter.runAgent({...}))` calls add `role`:

```ts
adapter.runAgent({
  role,  // add this
  model: config.modelId,
  messages,
  // ...
})
```

The `RunAgentInput` type (or equivalent in each adapter) is extended to include `role?: string`.

The same change applies to start/complete entries that currently log `userPromptPreview` and `responsePreview`: rename them to `userPrompt` and `responseText` and log the full prompt/response text instead of sliced previews so the file logger captures the complete exchange.

### 9.3 Phase 3: DevPanel Observability

#### 9.3.1 Remove RunCard Truncation

**File:** `src/pages/DevPanel.tsx`, `RunCard` component (line 687):

```tsx
// Before:
{run.output_text ? `"${run.output_text.slice(0, 500)}${run.output_text.length > 500 ? "…" : ""}"` : "No output text"}

// After:
<CollapsibleText text={run.output_text} collapseAt={800} />
```

Add `CollapsibleText` component:

```tsx
const CollapsibleText = ({ text, collapseAt = 800 }: { text: string | null; collapseAt?: number }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span style={{ color: "var(--text3)", fontFamily: "var(--font-mono)", fontSize: 10 }}>No output text</span>;
  const needsCollapse = text.length > collapseAt;
  const displayed = needsCollapse && !expanded ? text.slice(0, collapseAt) : text;
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {displayed}{needsCollapse && !expanded && "…"}
      </div>
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ marginTop: 4, background: "transparent", border: "none", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", cursor: "pointer" }}
        >
          {expanded ? "collapse" : `show full (${(text.length / 1000).toFixed(1)}k chars)`}
        </button>
      )}
    </div>
  );
};
```

Also update `JsonBlock` component: the `2000` char preview cap is reasonable for JSON display. Keep but increase to `4000` so analysis outputs (which run 1-3k chars) aren't cut by default.

#### 9.3.2 Selector Event Inspection via cycle_id

**File:** `src/pages/DevPanel.tsx`

The current `useEffect` for loading inspector data:

```tsx
// Before:
useEffect(() => {
  if (!sel?.trade_id) {
    setSelRuns([]);
    setSelMessages([]);
    return;
  }
  // load by trade_id
}, [sel?.trade_id]);

// After:
useEffect(() => {
  const tradeId = sel?.trade_id;
  const cycleId = (sel as ExtEventRow)?.cycle_id;
  
  if (!tradeId && !cycleId) {
    setSelRuns([]);
    setSelMessages([]);
    return;
  }
  
  setRunsLoading(true);
  setMessagesLoading(true);
  
  if (tradeId) {
    api.getAgentTraces(tradeId)
      .then(runs => setSelRuns(runs as ExtAgentRun[]))
      .catch(() => setSelRuns([]))
      .finally(() => setRunsLoading(false));
    api.getTradeDetail(tradeId)
      .then(detail => setSelMessages(detail.messages ?? []))
      .catch(() => setSelMessages([]))
      .finally(() => setMessagesLoading(false));
  } else if (cycleId) {
    // Load by cycle_id — selector runs
    api.getAgentTracesByCycle(cycleId)
      .then(runs => setSelRuns(runs as ExtAgentRun[]))
      .catch(() => setSelRuns([]))
      .finally(() => setRunsLoading(false));
    api.getMessagesByCycle(cycleId)
      .then(msgs => setSelMessages(msgs))
      .catch(() => setSelMessages([]))
      .finally(() => setMessagesLoading(false));
  }
}, [sel?.trade_id, (sel as ExtEventRow)?.cycle_id]);
```

This requires two new IPC handlers:

**File:** `electron/main/ipc/trades.ts` (or appropriate handler):

```ts
// getAgentTracesByCycle
handle("getAgentTracesByCycle", async (_, cycleId: string) => {
  return agentRunsRepo.findByCycleId(cycleId);
});

// getMessagesByCycle  
handle("getMessagesByCycle", async (_, cycleId: string) => {
  return agentMessagesRepo.findByCycleId(cycleId);
});
```

**File:** `electron/main/db/repositories/agent-runs-repo.ts` and `agent-messages-repo.ts`:

Add `findByCycleId(cycleId: string)` to both repos. The `cycle_id` column exists on both tables (from schema and confirmed in `buildTraceMessage`).

#### 9.3.3 Decision Context Section

**File:** `src/pages/DevPanel.tsx`, `MessageTraceTab` component

Add a parsed decision summary section at the top of each message card when `output_schema_name === "tradeDecision"`:

```tsx
function DecisionSummary({ outputJson }: { outputJson: string | null }) {
  const d = parseJsonSafe(outputJson) as {
    action?: string;
    reasoning?: string;
    confidence?: number;
    side?: string;
    sizeUsd?: number;
  } | null;
  if (!d) return null;
  const isNo = d.action === "no_trade";
  return (
    <div style={{
      background: isNo ? "rgba(255,71,87,0.06)" : "rgba(0,229,160,0.06)",
      border: `1px solid ${isNo ? "rgba(255,71,87,0.2)" : "rgba(0,229,160,0.2)"}`,
      borderRadius: 7, padding: "10px 12px", marginBottom: 10,
    }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 800, color: isNo ? "#ff4757" : "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
        {isNo ? "NO TRADE" : `TRADE — ${d.side}`}
        {d.confidence != null && <span style={{ marginLeft: 8, opacity: 0.7 }}>confidence: {(d.confidence * 100).toFixed(0)}%</span>}
        {d.sizeUsd != null && <span style={{ marginLeft: 8, opacity: 0.7 }}>${d.sizeUsd}</span>}
      </div>
      {d.reasoning && (
        <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.6 }}>{d.reasoning}</div>
      )}
    </div>
  );
}
```

Insert this into the message card for decision_maker messages:

```tsx
{m.output_schema_name === "tradeDecision" && <DecisionSummary outputJson={m.output_json} />}
```

#### 9.3.4 Selector Rejection Events

**File:** `electron/main/services/orchestration/agent-orchestrator.ts`, `validateSelectorOutput` method

After each rejection, emit a debug event:

```ts
for (const instrument of instruments) {
  if (!session.instrumentClasses.includes(instrument.instrumentClass)) {
    this.emitEvent("DEBUG", null, `[selector-filter] ${instrument.symbol}: rejected — class ${instrument.instrumentClass} not in session`);
    continue;
  }
  if (!instrument.rationale?.trim()) {
    this.emitEvent("DEBUG", null, `[selector-filter] ${instrument.symbol}: rejected — no rationale`);
    continue;
  }
  if (!this.hasSuccessfulQuote(traces, instrument)) {
    this.emitEvent("DEBUG", null, `[selector-filter] ${instrument.symbol}: rejected — no successful quote call`);
    continue;
  }
  if (!this.hasDiscoveryEvidence(traces, instrument, hadSearch)) {
    this.emitEvent("DEBUG", null, `[selector-filter] ${instrument.symbol}: rejected — no discovery evidence (news or search)`);
    continue;
  }
  if (this.contradictsStrategy(strategy.sideBias, instrument.rationale)) {
    this.emitEvent("DEBUG", null, `[selector-filter] ${instrument.symbol}: rejected — rationale contradicts ${strategy.sideBias} bias`);
    continue;
  }
  // passed
  valid.push(/* ... */);
}
```

These events appear in the DevPanel timeline and are filterable by DEBUG level.

#### 9.3.5 External Calls Tab

**File:** `src/pages/DevPanel.tsx`, `ExternalCallsTab`

Replace the stub with a live data component. Load `api_call_log` rows for the current session filtered by `cycle_id` when available:

```tsx
const ExternalCallsTab = ({ sessionId, cycleId }: { sessionId: string | null; cycleId: string | null }) => {
  const [calls, setCalls] = useState<ApiCallLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api.getApiCallLog({ sessionId, cycleId })
      .then(setCalls)
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [sessionId, cycleId]);
  
  if (loading) return <div style={emptyStyle}>loading…</div>;
  if (!calls.length) return <div style={emptyStyle}>No external API calls for this selection</div>;
  
  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      {calls.map(call => (
        <div key={call.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: call.status === "ok" ? "#00e5a0" : "#ff4757" }}>
              {call.status.toUpperCase()}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>{call.provider}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>{call.latency_ms}ms</span>
            {call.credits_used != null && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>{call.credits_used} credits</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
```

This requires a new IPC handler `getApiCallLog` that accepts `{sessionId, cycleId}` and queries `api_call_log`.

### 9.4 Phase 4: Search Quality (Lower Priority)

The search tool description in `search-tool.ts` is generic. Update to guide the AI toward financial-specific queries:

```ts
description: "Search the web and social media sources for current financial news, market data, trending themes, and asset-specific information. Use it to discover interesting instruments, including symbols gaining attention on social platforms, but only choose instruments that still meet the strategy and validation checks. Use specific symbol names, company names, or asset names combined with terms like 'stock momentum', 'breakout', 'earnings', 'price catalyst', 'trending', 'social sentiment', or 'market news'. For best results, include the current timeframe in queries.",
```

This is a prompt-engineering change that costs nothing and may improve query specificity. It won't solve the fundamental issue of snippet-only content from DDG, but it's directionally correct.

No structural change to DuckDuckGo adapter. Full-page content fetching is out of scope.

---

## 10. Migration / Implementation Plan

### Phase 1 — Mock Data Fix (Priority: Critical, Est: 2-3 hours)

Status: Partially implemented on 2026-05-10. Default bullish mock scenario, scenario-aware mock news, and targeted unit verification are complete; end-to-end mock trade execution is still pending runtime verification.

**Objective:** Get the bot to produce at least one trade in mock mode end-to-end.

**Checklist:**
- [x] `mock-adapter.ts`: Define `DEFAULT_MOCK_SCENARIO = { bias: "bullish", volatilityPct: 0.018, trendPctPerDay: 0.006 }`, use as constructor default
- [x] `mock-adapter.ts`: Add `getScenarioBias(): MockScenarioBias` accessor
- [x] `market-tools.ts`: Add `MOCK_NEWS_BY_SCENARIO` with bullish/bearish/volatile/sideways arrays, add `scenarioMockNews()` factory, update `DEFAULT_MOCK_NEWS` to point to bullish
- [x] `runtime.ts`: Update `getMockContext()` to call `mockAdapter.getScenarioBias()` and pass to `scenarioMockNews()`
- [x] Targeted unit tests: verify default mock bars trend upward and scenario-aware mock news is bullish plus symbol-aware
- [ ] Run the bot in mock mode, confirm selector submits ≥1 candidate
- [ ] Confirm trade pipeline runs through to a placed mock order

**Validation:** Look for `submit_candidates` with non-empty instruments in logs. Look for "trade opened" log message.

**Rollback:** Revert `DEFAULT_MOCK_SCENARIO` to `{}` (sideways). No DB changes.

**Done criteria:** One mock trade executed and logged.

---

### Phase 2 — Role in Logs (Priority: High, Est: 1 hour)

Status: Partially implemented on 2026-05-10. Code wiring and targeted unit verification are complete; live log-output verification is still pending.

**Objective:** All `run-agent-execute` log lines include the agent role and emit full payloads under non-preview field names in the common log file.

**Checklist:**
- [x] `run-agent-execute.ts`: Add `role?: string` to `RunAgentExecuteParams`
- [x] `run-agent-execute.ts`: Add `role: params.role ?? null` to start, tool-call, and complete log entries
- [x] `run-agent-execute.ts`: Rename `userPromptPreview`, `responsePreview`, `argsPreview`, and `resultPreview` to full-value field names such as `userPrompt`, `responseText`, `toolArgs`, and `toolResult`
- [x] `run-agent-execute.ts`: Log complete untruncated prompt/response/tool payloads in those renamed fields
- [x] Each adapter (`anthropic-adapter.ts`, `openai-adapter.ts`, `openrouter-adapter.ts`): Thread `role` from `RunAgentInput` into `executeRunAgent` params
- [x] `runtime.ts`: Pass `role` when calling `adapter.runAgent()` at all 3 call sites (`runRole`, `runDecisionRole`, `runInstrumentSelector`)
- [x] Targeted unit test: verify `executeRunAgent` emits `role`, `userPrompt`, `toolArgs`, `toolResult`, and `responseText` without preview truncation
- [ ] Verify logs show `"role": "instrument_selector"` in adapter-level entries
- [ ] Verify tool-call log entries contain full `toolArgs` and `toolResult` objects, not preview strings

**Validation:** Search log file for `"agent tool call"` — all entries must have a `role` field, must use the renamed full-value fields, and must not contain preview-only truncation fields.

**Rollback:** Remove `role` param (backward compatible — it's optional).

**Done criteria:** `grep '"agent tool call"' <logfile> | grep -v '"role"'` returns zero results, no `userPromptPreview`, `responsePreview`, `argsPreview`, or `resultPreview` fields remain in `run-agent-execute` log output, and the replacement fields contain full prompt/response/tool payloads.

---

### Phase 3 — DevPanel Observability (Priority: High, Est: 4-6 hours)

Status: Partially implemented on 2026-05-10. Code wiring for cycle-based inspection, decision summaries, selector rejection breadcrumbs, and live external-call visibility is complete; renderer/runtime manual verification is still pending.

**Objective:** DevPanel shows full AI output, selector event traces, decision context, rejection reasons, and external calls.

**Checklist:**
- [x] `DevPanel.tsx`: Add `CollapsibleText` component
- [x] `DevPanel.tsx`: Replace `RunCard` text slice with `CollapsibleText`
- [x] `DevPanel.tsx`: Increase `JsonBlock` preview from 2000 to 4000 chars
- [x] `agent-runs-repo.ts`: Add cycle-based run lookup (implemented via `agent_messages` join because `agent_runs` has no `cycle_id` column)
- [x] `agent-messages-repo.ts`: Add `listByCycle(cycleId: string)` method
- [x] IPC: Add `getAgentTracesByCycle` and `getMessagesByCycle` handlers
- [x] `src/lib/exva.ts` (API client): Add `getAgentTracesByCycle` and `getMessagesByCycle` functions
- [x] `DevPanel.tsx`: Update inspector `useEffect` to try `cycle_id` when `trade_id` is absent
- [x] `DevPanel.tsx`: Add `DecisionSummary` component for decision maker messages
- [x] `agent-orchestrator.ts`: Add per-instrument `emitEvent("DEBUG", ...)` calls in `validateSelectorOutput`
- [x] IPC: Add `getApiCallLog` handler accepting `{sessionId, cycleId}`
- [x] `DevPanel.tsx`: Replace `ExternalCallsTab` stub with live component
- [x] Pass `sessionId`, `cycleId`, and `tradeId` from `InspectorPanel` down to `ExternalCallsTab`
- [x] Add persisted `events.cycle_id` support so selector/debug events can be reloaded with cycle context

**Validation:**
1. Click an `instrument_selector` event in DevPanel → Runs tab shows selector agent run → Trace tab shows messages
2. Click a decision_maker event → Trace tab shows DecisionSummary with reasoning text
3. Look for `[selector-filter]` DEBUG events in timeline when selector rejects instruments
4. External tab shows search calls when a cycle_id event is selected

**Rollback:** All changes are additive UI + read-only IPC queries. No state mutations. Safe to revert any individual change.

**Done criteria:** Full trade cycle visible end-to-end in DevPanel without reading raw logs.

---

### Phase 4 — Search Tool Description (Priority: Low, Est: 15 minutes)

Status: Implemented on 2026-05-10.

**Checklist:**
- [x] `tools/search-tool.ts`: Update tool description string to be financial-specific
- [ ] Optional: update `sanitize-search-query.ts` to preserve financial terms that might be incorrectly stripped

**Done criteria:** Qualitative — next AI search run produces more specific queries with symbol names.

---

## 11. Testing and Verification Strategy

### Unit Tests

**Mock data correctness:**

```ts
// mock-adapter.test.ts
it("bullish scenario produces uptrend over 30 bars", () => {
  const adapter = new MockBrokerAdapter({ bias: "bullish", trendPctPerDay: 0.005 });
  const bars = adapter.getMockOhlcv("NVDA", 30);
  const first = bars[0].close;
  const last = bars[bars.length - 1].close;
  expect(last).toBeGreaterThan(first); // net positive trend
});
```

**Scenario news factory:**

```ts
it("bullish news contains momentum keywords", () => {
  const news = scenarioMockNews("bullish");
  const combined = news.map(n => n.title + n.snippet).join(" ").toLowerCase();
  expect(combined).toMatch(/breakout|momentum|strength/);
});

it("each scenario returns 3 items", () => {
  for (const bias of ["bullish", "bearish", "sideways", "volatile"] as const) {
    expect(scenarioMockNews(bias).length).toBe(3);
  }
});
```

**Selector rejection logging:**

```ts
it("emits DEBUG event for each rejected instrument", () => {
  const emittedEvents: string[] = [];
  // mock eventsRepo.insert to capture
  // run validateSelectorOutput with an instrument missing a quote
  // assert DEBUG event contains "[selector-filter]" + symbol name + reason
});
```

### Integration Verification

1. Start bot in mock mode with momentum strategy
2. Verify selector runs and submits ≥1 candidate (check logs)
3. Verify trade pipeline executes through to mock order placement
4. Open DevPanel, click selector cycle event → Runs tab loads
5. Click trade event → Trace tab shows DecisionSummary with reasoning
6. Filter to DEBUG level → see `[selector-filter]` events
7. External tab shows search call log

### Log Verification Commands

```bash
# Confirm role in adapter logs
grep -A5 '"agent tool call"' ~/.exva/logs/exva-$(date +%Y-%m-%d).log | grep '"role"'

# Confirm non-empty candidates
grep '"submit_candidates"' ~/.exva/logs/exva-$(date +%Y-%m-%d).log | grep -v '"instruments":\[\]'

# Confirm mock trade placed
grep '"trade opened"' ~/.exva/logs/exva-$(date +%Y-%m-%d).log
```

---

## 12. Risks and Failure Modes

| # | Risk | Likelihood | Impact | Detection | Mitigation | Rollback |
|---|------|------------|--------|-----------|------------|----------|
| R1 | Bullish mock OHLCV still fails `validateSelectorOutput` (quote check) | Low | High | No `[selector-filter]` PASSED events visible | Add verbose logging to pass cases too; check quote tool returns non-error | Revert to manual_shortlist for testing |
| R2 | `cycle_id` not present on events emitted before the fix | Low | Medium | Inspector shows empty Runs tab for old events | Filter: only try cycle_id if event has it | N/A — new events will have it |
| R3 | `findByCycleId` queries are slow on large tables | Very Low | Low | DevPanel takes >500ms to load | Add index on `cycle_id` in migrations if needed | Paginate results |
| R4 | Agent reasoning text absent (model doesn't fill reasoning field) | Low | Low | `thinking_json` null in trace | Verify with model that supports thinking; no fix needed for non-thinking models | N/A |
| R5 | DuckDuckGo HTML structure changes break parsing | Medium | Medium | `search_web` returns 0 results | Detect in `parseResults` returning empty; already throws `AppError` | Switch to Brave or Tavily |

### R1 in detail

Even with bullish OHLCV, `validateSelectorOutput` requires `hasSuccessfulQuote` — the AI must actually call `get_quote` for the instrument it's submitting. If the AI searches, decides on NVDA, then calls `submit_candidates` without calling `get_quote` first, validation rejects it. The system prompt says "Use `get_quote` after discovery" — the Gemma model generally follows this. But if the model skips quote validation, instruments are silently filtered. The new `[selector-filter]` debug events (§9.3.4) will make this immediately visible.

---

## 13. Operational Rollout

All changes are local (Electron desktop app). No deployment coordination needed.

**Order of operations:**
1. Phase 1 first — unblocks all other testing
2. Phase 2 and Phase 3 can overlap (no dependencies between them)
3. Phase 4 last — lowest priority, qualitative

**Monitoring during each phase:** After each phase, run the session for one full cycle and check:
- Logs at `~/.exva/logs/exva-YYYY-MM-DD.log`
- DevPanel event timeline
- Mock trade record in TradesPage

No feature flags needed. No external services affected.

---

## 14. Open Questions

| # | Question | Why It Matters | Owner | Resolution Needed By |
|---|----------|----------------|-------|----------------------|
| Q1 | Does `broker-registry.ts` construct `MockBrokerAdapter` with `new MockBrokerAdapter()` (no args) or does it pass a scenario? | Determines if Phase 1 default change propagates automatically | Kenneth | Before Phase 1 implementation |
| Q2 | Is `cycle_id` present on all events emitted by the orchestrator today, or only on some? | Determines which events will get inspector data after Phase 3 | Kenneth | Before Phase 3 implementation |
| Q3 | Do `agent_runs` and `agent_messages` have DB indexes on `cycle_id`? | Performance of `findByCycleId` queries | Kenneth | Before Phase 3 IPC handlers |
| Q4 | Should mock news be symbol-specific (e.g., mention "NVDA" by name in the headline)? | Would increase AI confidence in specific candidates | Kenneth | Phase 1 refinement |
| Q5 | Should the `validateSelectorOutput` gate be temporarily relaxed for mock testing, or is the real issue just the data? | Determines if Phase 1 alone is sufficient | Kenneth | After Phase 1 runs once |

---

## 15. Appendix

### A. Log Evidence — Root Cause Confirmation

From `docs/hello.json`, both cycles:
- Step 7 (cycle 1), Step 6 (cycle 2): `submit_candidates` called with `{"instruments":[]}`
- Preceding steps: `get_quote` returns deterministic prices (NVDA=347, flat every time)
- Preceding steps: `get_news` returns identical mock headlines for all symbols
- OHLCV bars: gentle declining series from open to close

This is not an AI failure. It's correct behavior given the inputs.

### B. Mock Price Derivation

`symbolSeed("NVDA") = 78+86+68+65 = 297`. `50 + (297 % 350) = 347`. This explains why NVDA always has price 347 regardless of run.

### C. Why `validateSelectorOutput` Requires Both Quote + Discovery

`hasSuccessfulQuote`: Ensures the AI verified the instrument can be traded (a non-error quote response). Without this, the AI could submit symbols it hallucinated or that don't exist in the broker.

`hasDiscoveryEvidence`: Ensures the AI found some market signal for the instrument — either news or search. Without this, the AI could pick instruments from memory rather than from live research.

Both gates are correct. The problem is the data quality provided by mock, not the gates.

### D. File Locations Summary

```
electron/main/services/broker/adapters/mock-adapter.ts         — Phase 1
electron/main/services/ai/tools/market-tools.ts                — Phase 1
electron/main/services/ai/ai-runtime/runtime.ts                — Phase 1
electron/main/services/ai/adapters/run-agent-execute.ts        — Phase 2
electron/main/services/ai/adapters/anthropic-adapter.ts        — Phase 2
electron/main/services/ai/adapters/openai-adapter.ts           — Phase 2
electron/main/services/ai/adapters/openrouter-adapter.ts       — Phase 2
electron/main/services/orchestration/agent-orchestrator.ts     — Phase 3
electron/main/db/repositories/agent-runs-repo.ts               — Phase 3
electron/main/db/repositories/agent-messages-repo.ts           — Phase 3
electron/main/ipc/trades.ts (or devtools.ts)                   — Phase 3
src/pages/DevPanel.tsx                                         — Phase 3
src/lib/exva.ts                                                — Phase 3
electron/main/services/ai/tools/search-tool.ts                 — Phase 4
```

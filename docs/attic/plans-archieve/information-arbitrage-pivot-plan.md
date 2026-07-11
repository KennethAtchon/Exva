# Information Arbitrage Pivot — Implementation Plan

> **Date:** 2026-05-27
> **Status:** Draft
> **Deciders:** Kenneth Atchon
> **Related:** `docs/NEXT.md`, `docs/TODO.md`

---

## 1. Problem Statement

The system was built on a day-trading thesis: find moving stocks, run technical analysis (chart patterns, RSI/MACD momentum), assess fundamentals via web search, and trade. That thesis has no durable edge.

The correct thesis (stated in `docs/TODO.md`) is **information arbitrage**: find text-form information the market hasn't priced in yet, extract a structured signal from it, and trade faster than humans can read the same document.

The current pipeline actively works against this thesis:

- The **technical phase** runs pure TA (chart patterns, RSI/MACD) on OHLCV bars — explicitly no-edge per `TODO.md`
- The **fundamental phase** runs `search_web` for earnings/catalyst/sentiment — returns SEO content already indexed and priced in
- The **selector** uses `get_trending_symbols` (what's already moving) and web search (already indexed) — by definition chasing priced-in information
- The **orchestrator** triggers on a polling schedule, not when a catalyst event occurs

`catalyst_scan` exists as a `ResearchDiscoveryMode` type in `electron/shared/domain/enums.ts` but has no workers, no trigger, and no data source wired to it.

---

## 2. Target State

```
SEC EDGAR RSS / Earnings Calendar
        ↓
CatalystWatcherService (polls, deduplicates, emits)
        ↓
AgentOrchestrator ← catalyst_event (EventBus)
        ↓ triggers pinned selector cycle
SelectorPhase [catalyst_scan mode]
  └─ catalyst-feed-scout: fetch_url → full document text → extract ticker + rationale
        ↓
FundamentalPhase [catalyst_scan mode]
  └─ document-extractor: fetch_url → full filing text → structured signal extraction
  └─ market-reaction-checker: get_quote + get_ohlcv → "has stock already moved?"
        ↓
TechnicalPhase [stripped to liquidity-only]
  └─ volume-profile (keep — liquidity context)
  └─ price-reaction-checker (new — staleness gate, not TA)
  [chart-pattern removed, momentum-indicator removed]
        ↓
ReviewPhase → DecisionPhase → RiskGate → Broker
```

The LLM is never asked to predict price direction from price data. It reads documents, extracts structured signals from text, and the system acts on the gap between what the document says and what the market price reflects.

---

## 3. Current State Audit

### 3.1 Technical Phase — Pure TA, No Edge

**File:** `electron/main/services/pipeline/definitions/technical.phase.ts`
**File:** `electron/main/services/pipeline/worker-prompts.ts`

| Worker                        | Tools                    | What it does                                              | Verdict                                   |
| ----------------------------- | ------------------------ | --------------------------------------------------------- | ----------------------------------------- |
| `chart-pattern`               | `get_ohlcv`              | Bull flags, triangles, support/resistance from OHLCV bars | **Remove**                                |
| `momentum-indicator`          | `get_ohlcv`, `get_quote` | RSI/MACD-style momentum                                   | **Remove**                                |
| `volume-profile`              | `get_ohlcv`              | Volume relative to history                                | **Keep** — liquidity context              |
| `implied-probability` (event) | `get_quote`, `get_ohlcv` | Contract mid vs historical range                          | **Keep** — valid for prediction markets   |
| `price-drift` (event)         | `get_ohlcv`, `get_quote` | Short-horizon drift                                       | **Keep** — not TA, it's a staleness check |
| `event-liquidity` (event)     | `get_ohlcv`, `get_quote` | Spread/depth proxy                                        | **Keep**                                  |

**New worker to add:** `price-reaction-checker` — calls `get_quote` + recent OHLCV (30min window), checks if stock moved >N% since catalyst dropped. If yes → signal is stale, skip. This is NOT TA — it's a staleness gate.

### 3.2 Fundamental Phase — Web Search Returns Stale Indexed Content

**File:** `electron/main/services/pipeline/definitions/fundamental.phase.ts`

| Worker              | Tools        | What it does             | Verdict                                            |
| ------------------- | ------------ | ------------------------ | -------------------------------------------------- |
| `earnings-context`  | `search_web` | Search for earnings news | **Replace** with `document-extractor`              |
| `catalyst-context`  | `search_web` | Search for catalyst news | **Replace** with `market-reaction-checker`         |
| `sentiment-context` | `search_web` | Web sentiment            | **Remove** — TODO.md explicitly says this is noise |

`fetch_url` already exists as a tool and can fetch full document text (8000 chars, stripped HTML). The issue is the phase has no way to know WHICH URL to fetch — that comes from the catalyst watcher.

### 3.3 Selector — Discovery via Trending and Web Search

**File:** `electron/main/services/pipeline/definitions/selector.phase.ts`

| Worker                   | Tools                                | What it does                    | Verdict                                   |
| ------------------------ | ------------------------------------ | ------------------------------- | ----------------------------------------- |
| `web-scout`              | `search_web`, `fetch_url`            | Find candidates from web search | **Keep for non-catalyst modes**           |
| `trend-scout`            | `get_trending_symbols`, `search_web` | Find trending stocks            | **Remove** — trending = already priced in |
| `event-web-scout`        | `search_web`, `fetch_url`            | Prediction market candidates    | **Keep for event_contract_scan**          |
| `event-prediction-scout` | `search_web`, `get_trending_symbols` | Prediction contracts            | **Keep for event_contract_scan**          |

**New worker for `catalyst_scan`:** `catalyst-feed-scout` — receives catalyst event data (ticker + document URL) injected into the task input, fetches the document, confirms it's a real catalyst. No web search. Discovery is done — the catalyst watcher already found the instrument.

### 3.4 Orchestrator — Time-Driven, Not Event-Driven

**File:** `electron/main/services/orchestration/cycle/agent-orchestrator.ts`

Current triggers:

1. Session start → initial selector cycle
2. Trade closed → `attachTradeClosedListener` → new selector cycle
3. No-instrument retry timer → scheduled retry

Missing trigger: 4. **Catalyst event** → pinned selector cycle for the triggered ticker

The `scheduleSelectorCycle` private method exists and is callable. Adding a catalyst trigger is wiring `EventBus.on('catalyst_event', ...)` to call `schedulePinnedSelectorCycle(ticker, documentUrl)`.

### 3.5 `catalyst_scan` Mode — Type Exists, Nothing Implemented

`ResearchDiscoveryMode` in `electron/shared/domain/enums.ts` includes `"catalyst_scan"`. No selector workers, no fundamental workers, no trigger, and no data source are wired to it. It's a stub.

---

## 4. New Service: CatalystWatcherService

### 4.1 What It Does

Runs as a background service in the Electron main process. Polls two sources:

1. **SEC EDGAR real-time 8-K RSS** — free, no API key, updated continuously
2. **Earnings calendar** (optional second phase) — earnings dates + release times

When a new, unseen filing appears for a tracked ticker class, it emits a `catalyst_event` to EventBus. The `AgentOrchestrator` for any active sessions consuming that instrument class picks it up and queues a pinned selector cycle.

### 4.2 Data Sources

**SEC EDGAR 8-K RSS (Phase 1 — implement first)**

```
GET https://efts.sec.gov/LATEST/search-index?q=%228-K%22&dateRange=custom&startdt={YYYY-MM-DD}&forms=8-K&hits.hits._source=period_of_report,entity_name,file_num,period_of_report,file_date,form_type,biz_location,inc_states
```

Or the Atom feed:

```
GET https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom
```

Returns Atom XML. Each entry has: company name, CIK, date filed, filing URL, form type.

The filing page URL pattern: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=8-K&dateb=&owner=include&count=1`

The actual 8-K document URL: found inside the filing index. Pattern:
`https://www.sec.gov/Archives/edgar/data/{cik}/{filing-id}/{filename}.htm`

**Important:** The `fetch_url` tool already handles fetching arbitrary URLs and stripping HTML to text. The CatalystWatcher can use `node:fetch` directly (it's a Node.js service, not an AI worker tool).

**Earnings Calendar (Phase 2 — implement after EDGAR works)**

Free options (no paid key):

- Alpha Vantage free tier: earnings calendar endpoint
- Yahoo Finance unofficial endpoint (fragile, avoid for production)
- Financial Modeling Prep free tier: `/v3/earning_calendar?from={date}&to={date}`

### 4.3 Files to Create

```
electron/main/services/catalyst/
  catalyst-watcher-service.ts     # main service class
  catalyst-dedup-store.ts         # in-memory + SQLite dedup of seen filings
  edgar-rss-client.ts             # fetch + parse EDGAR Atom feed
  catalyst-types.ts               # CatalystEvent type
```

### 4.4 `CatalystEvent` Type

```typescript
// electron/main/services/catalyst/catalyst-types.ts
export type CatalystEventType =
  | "earnings_8k" // 8-K with earnings release
  | "material_8k" // 8-K non-earnings (merger, guidance, etc.)
  | "proxy_statement" // DEF 14A
  | "annual_report" // 10-K
  | "quarterly_report"; // 10-Q

export type CatalystEvent = {
  id: string; // crypto.randomUUID()
  ticker: string; // extracted from EDGAR CIK lookup or filing header
  companyName: string;
  eventType: CatalystEventType;
  filingId: string; // EDGAR accession number — dedup key
  documentUrl: string; // direct URL to the 8-K text document
  indexUrl: string; // filing index page
  filedAt: string; // ISO timestamp from EDGAR
  detectedAt: string; // when we first saw it
};
```

### 4.5 EventBus Channel

Add to `electron/shared/ipc/channels.ts` or event-bus types:

```typescript
catalyst_event: CatalystEvent;
```

Add to `ExvaEventMap` in `electron/main/services/infra/event-bus.ts`.

### 4.6 Polling Behavior

- Poll interval: 3 minutes during market hours (9:00 AM – 5:00 PM ET), 15 minutes outside
- Dedup: persist seen `filingId` values in a `catalyst_seen_filings` SQLite table (simple id + seen_at)
- Only emit for instrument classes the running sessions care about (initially: `stock`)
- Shutdown cleanly when sessions stop

### 4.7 DB Migration Required

```sql
-- New table: catalyst event log
CREATE TABLE catalyst_events (
  id TEXT PRIMARY KEY NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  filing_id TEXT NOT NULL UNIQUE,
  document_url TEXT NOT NULL,
  index_url TEXT NOT NULL,
  filed_at TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  selector_triggered INTEGER NOT NULL DEFAULT 0  -- boolean
);
```

---

## 5. Orchestrator: Catalyst-Triggered Selector

### 5.1 What Changes

**File:** `electron/main/services/orchestration/cycle/agent-orchestrator.ts`
**New file:** `electron/main/services/orchestration/cycle/scheduling/catalyst-handler.ts`

Add `attachCatalystListener` / `detachCatalystListener` analogous to the existing `attachTradeClosedListener` / `detachTradeClosedListener` pattern in `scheduling/trade-closed-handler.ts`.

When a `catalyst_event` fires:

1. Check if the session's instrument classes include the event's ticker class (`stock`, etc.)
2. Check if session is `active` (not paused/stopped)
3. Enqueue a pinned selector cycle with the catalyst context injected into `selectionInstructions`

### 5.2 Pinned Selector Cycle

A pinned cycle differs from a normal selector cycle in one way: the `selectionInstructions` string is pre-populated with the ticker and catalyst context:

```
Catalyst event detected: AAPL (Apple Inc.) filed an 8-K at 2026-05-27T16:05:00Z.
Document URL: https://www.sec.gov/Archives/edgar/data/320193/...
Evaluate AAPL (stock) as the primary candidate. Fetch the document and extract the signal.
Discovery mode: catalyst_scan.
```

This bypasses the discovery stage entirely — the instrument is known. The selector's `catalyst-feed-scout` worker fetches the document and confirms the catalyst is material before passing it to verification.

### 5.3 `selectionInstructions` Injection

The selector phase reads `selectionInstructions` from `ctx.input.selectionInstructions` (set by the `selector-scope` input engine). The catalyst-triggered cycle bypasses the scope engine and injects the catalyst text directly.

**Approach:** Add an optional `pinnedCatalystContext` field to the selector input shape. When present, the `manual-shortlist` entry engine (or a new `catalyst-trigger` entry engine) uses it to pre-populate instructions and skip scope resolution.

---

## 6. Selector Phase: `catalyst_scan` Workers

### 6.1 New Worker: `catalyst-feed-scout`

**File:** `electron/main/services/pipeline/definitions/selector.phase.ts` (add to `CATALYST_SCAN_SELECTOR_DISCOVERY`)
**Prompt:** `SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT` in `worker-prompts.ts`

```typescript
// Add to STANDARD_SELECTOR_DISCOVERY alternatives:
const CATALYST_SCAN_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "catalyst-feed-scout",
    prompt: SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT,
    tools: ["fetch_url"],
    toolRequirements: { requiredAll: ["fetch_url"], minToolCalls: 1 },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
];
```

**Prompt:**

```
# Catalyst feed scout

A filing event has been detected. The catalyst context is in your task input.

## Required Process

1. Call fetch_url with the document URL provided in the task input.
2. Read the fetched text. Identify the primary ticker and determine whether this filing contains material information
   (earnings release, guidance change, merger announcement, regulatory decision, etc.).
3. If the document is material: return the ticker as a candidate with high catalystScore (0.8–1.0) and a rationale
   summarizing what the document says in 1-2 sentences.
4. If the document is not material (boilerplate, administrative): return an empty candidates array.
5. Do not infer information from memory. Only use what the fetched document says.

When finished, call the submit_result tool; its schema defines every field.
```

### 6.2 Update `selectorDiscoveryWorkersForMode`

```typescript
function selectorDiscoveryWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  if (discoveryMode === "event_contract_scan") return EVENT_SELECTOR_DISCOVERY;
  if (discoveryMode === "catalyst_scan")
    return CATALYST_SCAN_SELECTOR_DISCOVERY;
  // trend_scan, quality_watchlist, mean_reversion_scan, custom:
  return STANDARD_SELECTOR_DISCOVERY;
}
```

### 6.3 Remove `trend-scout` from `STANDARD_SELECTOR_DISCOVERY`

`get_trending_symbols` finds stocks already moving — information already priced in. Remove this worker. `web-scout` alone is sufficient for non-catalyst discovery modes.

---

## 7. Fundamental Phase: Document Extraction Replaces Web Search

### 7.1 New Worker: `document-extractor`

**File:** `electron/main/services/pipeline/definitions/fundamental.phase.ts`
**Prompt:** `FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT`

Replaces `earnings-context` in `catalyst_scan` mode.

```typescript
const CATALYST_FUNDAMENTAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "document-extractor",
    prompt: FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT,
    tools: ["fetch_url"],
    toolRequirements: { requiredAll: ["fetch_url"], minToolCalls: 1 },
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "market-reaction-checker",
    prompt: FUNDAMENTAL_WORKERS_MARKET_REACTION_CHECKER_PROMPT,
    tools: ["get_quote", "get_ohlcv"],
    toolRequirements: { requiredAll: ["get_quote"], minToolCalls: 1 },
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: catalystOutputSchema,
  },
];
```

**`document-extractor` prompt:**

```
# Document extractor

A regulatory or earnings filing has been fetched. Fetch the document URL from your task input and extract structured signals.

## Required Process

1. Call fetch_url with the document URL in your task input.
2. Extract from the fetched text:
   - Guidance: did forward guidance go up, down, or stay the same vs prior period? By how much (% if stated)?
   - Language patterns: count of hedging words ("uncertain", "challenging", "headwinds", "difficult") vs confidence words ("strong", "accelerating", "exceeded", "confident"). Net sentiment = confidence_count - hedging_count.
   - Surprise: any explicit mention of beating/missing analyst expectations?
   - Material event: what is the single most important fact in this document?
3. If the document is inaccessible (fetch error), return null earningsScore and explain in rawSummary.
4. Do not fabricate numbers. Only report what the document explicitly states.

No trade decision. When finished, call the submit_result tool; its schema defines every field.
```

**`market-reaction-checker` prompt:**

```
# Market reaction checker

Check whether the market has already moved on this catalyst.

## Required Process

1. Call get_quote for {instrumentSymbol}.
2. Call get_ohlcv for {instrumentSymbol} with a short window (today or intraday if available).
3. Assess: has the stock price moved more than 3% in the direction implied by the catalyst since the filing time?
   - If yes → catalystFreshness = 0.1 (likely priced in, do not trade)
   - If no meaningful move → catalystFreshness = 0.9 (signal is live)
4. catalystStrength = 0.8 if catalystFreshness > 0.5, else 0.2.

No trade decision. When finished, call the submit_result tool; its schema defines every field.
```

### 7.2 Remove `sentiment-context`

Web sentiment from `search_web` is explicitly called out in `docs/TODO.md` as noise (Twitter/social is gamed, already priced in). Remove from `STANDARD_FUNDAMENTAL_WORKERS` and do not include in `CATALYST_FUNDAMENTAL_WORKERS`.

### 7.3 Update `fundamentalWorkersForMode`

```typescript
function fundamentalWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  if (discoveryMode === "event_contract_scan") return EVENT_FUNDAMENTAL_WORKERS;
  if (discoveryMode === "catalyst_scan") return CATALYST_FUNDAMENTAL_WORKERS;
  return STANDARD_FUNDAMENTAL_WORKERS; // web-search based, for non-catalyst modes
}
```

---

## 8. Technical Phase: Strip TA, Add Staleness Gate

### 8.1 Remove `chart-pattern` and `momentum-indicator`

These workers run RSI/MACD analysis on OHLCV bars. No edge. Remove from `STANDARD_TECHNICAL_WORKERS`.

**File:** `electron/main/services/pipeline/definitions/technical.phase.ts`

```typescript
// BEFORE:
const STANDARD_TECHNICAL_WORKERS = [
  chart - pattern,
  momentum - indicator,
  volume - profile,
];

// AFTER:
const STANDARD_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  volume - profile, // keep — informs position sizing and liquidity
];
```

### 8.2 Add `price-reaction-checker` to `catalyst_scan` Technical Workers

```typescript
const CATALYST_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "price-reaction-checker",
    prompt: TECHNICAL_WORKERS_PRICE_REACTION_CHECKER_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: volumeOutputSchema, // reuse volume schema — carries volumeScore and volumeSignal
  },
];
```

**Prompt:**

```
# Price reaction checker

Determine whether the market has already reacted to this catalyst by moving price significantly.

## Required Process

1. Call get_ohlcv for {instrumentSymbol} with the shortest available window.
2. Call get_quote for current mid-price.
3. Compare current price to the price at the start of today's session (or 30 minutes ago if intraday).
4. volumeScore: 0 if price already moved >3% (opportunity gone), 1 if price is flat/unchanged (signal live).
5. volumeSignal: "accumulation" if catalyst is positive and no move yet; "distribution" if negative catalyst and no move yet; "neutral" if already moved.

No trade decision. When finished, call the submit_result tool; its schema defines every field.
```

### 8.3 Update `technicalWorkersForMode`

```typescript
function technicalWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  if (discoveryMode === "event_contract_scan") return EVENT_TECHNICAL_WORKERS;
  if (discoveryMode === "catalyst_scan") return CATALYST_TECHNICAL_WORKERS;
  return STANDARD_TECHNICAL_WORKERS;
}
```

---

## 9. Prompt Changes Summary

**File:** `electron/main/services/pipeline/worker-prompts.ts`

| Constant                                             | Action                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `TECHNICAL_WORKERS_CHART_PATTERN_PROMPT`             | Delete                                                               |
| `TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT`        | Delete                                                               |
| `TECHNICAL_WORKERS_PRICE_REACTION_CHECKER_PROMPT`    | **Add new**                                                          |
| `FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT`        | Keep (used in `STANDARD_FUNDAMENTAL_WORKERS` for non-catalyst modes) |
| `FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT`        | Keep                                                                 |
| `FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT`       | Delete                                                               |
| `FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT`      | **Add new**                                                          |
| `FUNDAMENTAL_WORKERS_MARKET_REACTION_CHECKER_PROMPT` | **Add new**                                                          |
| `SELECTOR_WORKERS_TREND_SCOUT_PROMPT`                | Delete                                                               |
| `SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT`        | **Add new**                                                          |

---

## 10. Implementation Order

Work in this order. Each phase is independently testable.

### Phase 1 — Strip TA Workers (1–2 hours)

**Goal:** Stop burning API cost on signals with no edge.

1. Delete `chart-pattern` and `momentum-indicator` from `STANDARD_TECHNICAL_WORKERS`
2. Delete `TECHNICAL_WORKERS_CHART_PATTERN_PROMPT` and `TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT` from `worker-prompts.ts`
3. Delete `sentiment-context` from `STANDARD_FUNDAMENTAL_WORKERS`
4. Delete `FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT`
5. Delete `trend-scout` from `STANDARD_SELECTOR_DISCOVERY`
6. Delete `SELECTOR_WORKERS_TREND_SCOUT_PROMPT`
7. Run `bun run typecheck` — confirm no orphan references

**Files touched:**

- `electron/main/services/pipeline/definitions/technical.phase.ts`
- `electron/main/services/pipeline/definitions/fundamental.phase.ts`
- `electron/main/services/pipeline/definitions/selector.phase.ts`
- `electron/main/services/pipeline/worker-prompts.ts`
- (delete) `electron/main/services/signal/aggregators/technical-aggregator.ts` — `chartPatternOutputSchema` and `momentumOutputSchema` may become orphaned; audit imports

### Phase 2 — Add Catalyst Workers (2–4 hours)

**Goal:** Wire `catalyst_scan` mode with real workers.

1. Add `TECHNICAL_WORKERS_PRICE_REACTION_CHECKER_PROMPT` to `worker-prompts.ts`
2. Add `FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT` to `worker-prompts.ts`
3. Add `FUNDAMENTAL_WORKERS_MARKET_REACTION_CHECKER_PROMPT` to `worker-prompts.ts`
4. Add `SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT` to `worker-prompts.ts`
5. Add `CATALYST_TECHNICAL_WORKERS` constant + `price-reaction-checker` worker to `technical.phase.ts`
6. Add `CATALYST_FUNDAMENTAL_WORKERS` constant + `document-extractor` + `market-reaction-checker` workers to `fundamental.phase.ts`
7. Add `CATALYST_SCAN_SELECTOR_DISCOVERY` constant + `catalyst-feed-scout` worker to `selector.phase.ts`
8. Update all three `*WorkersForMode` functions with `catalyst_scan` branch
9. Run `bun run typecheck`

**Files touched:**

- `electron/main/services/pipeline/worker-prompts.ts`
- `electron/main/services/pipeline/definitions/technical.phase.ts`
- `electron/main/services/pipeline/definitions/fundamental.phase.ts`
- `electron/main/services/pipeline/definitions/selector.phase.ts`

### Phase 3 — CatalystWatcherService (4–8 hours)

**Goal:** Real-time EDGAR feed → EventBus.

1. Write DB migration `0002_catalyst_events.sql`
2. Create `electron/main/db/repositories/catalyst/catalyst-events-repo.ts`
3. Create `electron/main/services/catalyst/catalyst-types.ts`
4. Create `electron/main/services/catalyst/edgar-rss-client.ts` — parse EDGAR Atom XML
5. Create `electron/main/services/catalyst/catalyst-dedup-store.ts` — in-memory Set + DB persistence
6. Create `electron/main/services/catalyst/catalyst-watcher-service.ts` — polling loop, emit `catalyst_event`
7. Add `catalyst_event` to `ExvaEventMap` in `electron/main/services/infra/event-bus.ts`
8. Wire into `createAppServices` in `electron/main/services/app-services.ts` — start/stop with app lifecycle

**Files touched (new):**

- `electron/main/db/drizzle/0002_catalyst_events.sql`
- `electron/main/db/repositories/catalyst/catalyst-events-repo.ts`
- `electron/main/services/catalyst/catalyst-types.ts`
- `electron/main/services/catalyst/edgar-rss-client.ts`
- `electron/main/services/catalyst/catalyst-dedup-store.ts`
- `electron/main/services/catalyst/catalyst-watcher-service.ts`

**Files modified:**

- `electron/main/services/infra/event-bus.ts` — add `catalyst_event` to `ExvaEventMap`
- `electron/main/services/app-services.ts` — instantiate and start watcher

### Phase 4 — Event-Triggered Orchestrator (2–4 hours)

**Goal:** Connect `catalyst_event` to a pinned selector cycle.

1. Create `electron/main/services/orchestration/cycle/scheduling/catalyst-handler.ts`
   - `attachCatalystListener(ctx, eventBus, schedulePinnedSelector)`
   - `detachCatalystListener(ctx)`
   - Checks session instrument classes and status before triggering
2. Modify `agent-orchestrator.ts`:
   - Add `attachCatalystListener` call in `start()`
   - Add `detachCatalystListener` call in `stop()`
   - Add `schedulePinnedSelectorCycle(catalyst: CatalystEvent)` private method
   - This method injects catalyst context into `selectionInstructions` and enqueues a `catalyst_scan` mode selector cycle
3. Modify selector input handling to accept pinned catalyst context

**Files touched:**

- `electron/main/services/orchestration/cycle/scheduling/catalyst-handler.ts` (new)
- `electron/main/services/orchestration/cycle/agent-orchestrator.ts`
- `electron/main/services/orchestration/cycle/selector/run-selector.ts` — accept optional catalyst context

### Phase 5 — Paper Validation (ongoing)

**Goal:** Run the full catalyst_scan pipeline on paper and use Period Autopsy to evaluate signal quality.

1. Create a paper trading session with `discoveryMode: "catalyst_scan"`, stocks only
2. Let it run for 2 weeks minimum
3. Use Period Autopsy to review: did trades triggered by EDGAR 8-Ks show positive expectancy?
4. Review `api_call_log` to confirm workers are calling `fetch_url` (document fetches) not `search_web`
5. Review `agent_messages` to confirm extracted signals reference document text, not hallucinated data

---

## 11. What OHLCV Is Still Used For

Keep `get_ohlcv` and `get_quote` in the system — they're not the problem. The problem was using them to generate signals. They remain valid for:

| Use                                             | Why                                                             |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Liquidity check (`volume-profile`)              | Is this stock liquid enough to trade without moving the market? |
| Staleness gate (`price-reaction-checker`)       | Has the stock already moved since the catalyst dropped?         |
| Spread check (`liquidity-gate` in verification) | Is the bid/ask spread reasonable for entry?                     |
| Position sizing                                 | Current price × shares = dollar exposure                        |
| Stop loss / take profit levels                  | Entry price math, not predictive TA                             |

OHLCV is context, not signal.

---

## 12. Risks & Mitigations

| Risk                                             | Mitigation                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EDGAR feed goes down or changes format           | Wrap in try/catch, log, continue polling; do not crash main process                                                                                                                |
| `fetch_url` 8000-char cap truncates long filings | EDGAR 8-K earnings releases are typically short press releases. 10-K bodies will truncate. Acceptable for phase 1 — add pagination in phase 2                                      |
| Ticker extraction from filing may fail           | Some 8-Ks file under a parent company with different ticker. CatalystWatcher should maintain CIK-to-ticker mapping (EDGAR provides this)                                           |
| Catalyst fires outside market hours              | Track `filedAt` timestamp. After-hours filings (4:00–5:00 PM ET) are the target. Pre-market filings (before 9:30 AM) also valid. Weekend filings: queue and trigger at Monday open |
| Too many 8-K events flood the selector           | Rate-limit: max 3 catalyst-triggered cycles queued per session at once. Non-material 8-Ks filtered by `catalyst-feed-scout`                                                        |
| `sentiment-context` removal breaks aggregator    | Check `fundamental-aggregator.ts` — if `sentimentScore` is a required field in `FundamentalSignal`, make it nullable before removing the worker                                    |

---

## 13. Files Reference Map

| Area                                     | Files                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Phase worker prompts                     | `electron/main/services/pipeline/worker-prompts.ts`                             |
| Technical phase                          | `electron/main/services/pipeline/definitions/technical.phase.ts`                |
| Fundamental phase                        | `electron/main/services/pipeline/definitions/fundamental.phase.ts`              |
| Selector phase                           | `electron/main/services/pipeline/definitions/selector.phase.ts`                 |
| Discovery mode type                      | `electron/shared/domain/enums.ts`                                               |
| Orchestrator                             | `electron/main/services/orchestration/cycle/agent-orchestrator.ts`              |
| Trade-closed handler (pattern to follow) | `electron/main/services/orchestration/cycle/scheduling/trade-closed-handler.ts` |
| EventBus                                 | `electron/main/services/infra/event-bus.ts`                                     |
| App services composition root            | `electron/main/services/app-services.ts`                                        |
| DB migrations                            | `electron/main/db/drizzle/`                                                     |
| `fetch_url` tool                         | `electron/main/services/tools/fetch-url-tool.ts`                                |
| Technical aggregator (orphan risk)       | `electron/main/services/signal/aggregators/technical-aggregator.ts`             |
| Fundamental aggregator                   | `electron/main/services/signal/aggregators/fundamental-aggregator.ts`           |

# Tool Surface Review — Dead Weight, Synthetic Data, and Duplication

> **Last updated:** 2026-05-25
> **Scope:** Audit of `electron/main/services/tools/*` — which tools add value, which mislead, which are dead code
> **Audience:** Engineering

## Summary

The tool surface has three defects that should be fixed before they cause real damage: one tool that duplicates existing infrastructure (`get_news`), one that fabricates data the model treats as real (`get_ohlcv` live mode), and one that is dead code in production (`search_reddit`). Each is explained below with the exact changes required.

---

## 1. `get_news` — Redundant (Remove)

### Problem

`get_news` is `search_web("${symbol} latest market news")` wrapped in a dedicated tool. The model can already call `search_web` with any query. This tool provides zero unique data or access — it routes through the same `SearchRegistry` adapters (Brave, Tavily, MCP) that `search_web` uses.

**Evidence in code:** `market-tools.ts:265-293` — the tool calls `deps.searchRegistry.get(deps.searchProviderId).search(sanitizeSearchQuery(\`${symbol} latest market news\`))`, which is the exact same path as `search-tool.ts`.

### Changes Required

| File                                                            | Change                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/tools/market-tools.ts`                                | Remove `get_news` tool, `include.news`, `MockNewsItem`, `scenarioMockNews()`, and all mock news fixture data (NEUTRAL_MOCK_NEWS, MOCK_NEWS_BY_SCENARIO)                                                  |
| `services/tools/__tests__/market-tools.test.ts`                 | Remove `get_news` tests (lines 71-107)                                                                                                                                                                   |
| `services/pipeline/worker-tools/worker-tool-factory.ts`         | Remove `get_news` from `SUPPORTED_TOOL_IDS`, remove `needsMarket` check for it, remove `mockNewsData` from `WorkerToolContext`, drop `searchRegistry`/`searchProviderId` from `createMarketTools()` call |
| `services/pipeline/worker-tools/resolve-mock-tool-context.ts`   | Remove `mockNewsData` from `MockToolContext`, drop `scenarioMockNews`/`MockNewsItem` imports                                                                                                             |
| `services/pipeline/definitions/fundamental.phase.ts`            | Replace `get_news` with `search_web` in all 5 worker tool arrays                                                                                                                                         |
| `services/pipeline/definitions/selector.phase.ts`               | Replace `get_news` with `search_web` in `catalyst-extractor` worker tools                                                                                                                                |
| `services/pipeline/engines/finalizer/selector-risk-filter.ts`   | Remove `hasNewsEvidence` check                                                                                                                                                                           |
| `services/pipeline/engines/input/broker-coverage.ts`            | Update prompt text to remove `get_news` mention                                                                                                                                                          |
| `services/pipeline/worker-prompts.ts`                           | Update `SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT` to remove `get_news` from the required-tools list                                                                                                    |
| `services/llm/adapters/run-agent-execute.ts`                    | Remove `get_news` from the verifyCalls loop guard filter                                                                                                                                                 |
| `services/llm/tool-loop-guard.ts`                               | Remove `get_news` from `canonicalizeToolInput`                                                                                                                                                           |
| `services/llm/__tests__/tool-loop-guard.test.ts`                | Update test helpers that reference `get_news`                                                                                                                                                            |
| `services/llm/__tests__/run-agent-execute.test.ts`              | Remove `get_news` from mock test tool setup (line 168)                                                                                                                                                   |
| `services/orchestration/policy/candidate-validation-service.ts` | Remove `get_news` from `CandidateEvidenceEntry` source type and CV-6 evidence check                                                                                                                      |
| `services/tools/__tests__/social-discovery-tools.test.ts`       | Update if it references `get_news`                                                                                                                                                                       |
| `services/tools/README.md`                                      | Remove `get_news` from documentation                                                                                                                                                                     |

---

## 2. `get_ohlcv` — Synthetic Bars in Live/Paper Mode (Fix)

### Problem

When `getMockOhlcv` is not provided (i.e., live or paper trading mode), `get_ohlcv` calls `adapter.getMarketSnapshot()` for a single price point, then feeds it to `buildSyntheticBars()` which generates 30 fake daily OHLCV bars with random noise. The model sees supposedly real historical price data that is actually fabricated — a trend drifted upward from `spot * 0.955` with ±0.4% random daily noise.

**Evidence in code:** `market-tools.ts:247-255` (before stashed changes). The function `buildSyntheticBars` at lines 298-319 generates bars from a single spot price using `Math.random()`. The test at line 120-143 explicitly validates that "bars drift upward toward spot price."

**Worse:** every live broker adapter already has an optional `getOhlcv?()` method in the `BrokerAdapter` interface (`broker-adapter.ts`). No adapter currently implements it, but the interface contract exists. The tool ignores it entirely and goes straight to synthetic generation instead.

### How It Should Work

```
get_ohlcv execute:
  if mock → use getMockOhlcv callback (existing behavior, correct)
  if live/paper →
    get adapter from brokerRegistry
    if adapter.getOhlcv exists → call it, return bars
    else → return { error: "Broker does not support OHLCV for this class" }
```

### Changes Required

| File                                            | Change                                                                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/tools/market-tools.ts`                | Replace `get_ohlcv` live path: check `adapter.getOhlcv` first, return error if unimplemented. Remove `buildSyntheticBars()` and `round2()`. Remove `DAY_MS` constant and `SyntheticBar` type if only used there. Add `BrokerAdapter` import. |
| `services/tools/__tests__/market-tools.test.ts` | Remove or rewrite tests that assert synthetic bar behavior (lines 48-69, 120-144). The mock path tests (lines 146-171) should remain.                                                                                                        |

### Bonus — Adapter OHLCV Opportunity

The following adapters could implement `getOhlcv` against real endpoints:

| Adapter                        | Potential Endpoint                                      |
| ------------------------------ | ------------------------------------------------------- |
| `AlpacaAdapter`                | `GET /v2/stocks/{symbol}/bars` (Alpaca Market Data API) |
| `CoinbaseAdvancedTradeAdapter` | CCXT `fetchOHLCV(symbol, timeframe)`                    |
| `TradovateAdapter`             | Tradovate historical fills/OHLC endpoint                |
| `PolymarketAdapter`            | CLOB price history (native to Polymarket API)           |

None are currently implemented — but the interface is ready.

---

## 3. `search_reddit` — Dead Code in Production (Remove)

### Problem

In live sessions, `search_reddit` immediately returns an error:

```
"Reddit search requires OAuth authentication in live mode."
```

`market-tools.ts:181-186`: `if (!deps.mockPosts && !deps.isMockSession) return { error: ... }`

In mock sessions, `mockPosts` is always provided via `resolve-mock-tool-context.ts`, so the live Reddit API code path at lines 91-125 (`searchReddit()` function) is **dead code** — it can never be reached. Reddit's JSON search API (`/r/{subreddits}/search.json`) is publicly accessible without OAuth for basic use, but the tool blocks it.

Meanwhile, `search_web` already searches the web including Reddit (via `site:reddit.com` queries or through MCP search providers), and the `McpSearchAdapter` at `services/search/adapters/mcp-adapter.ts` provides a generic search tool that can target any source including Reddit.

### Changes Required

| File                                                          | Change                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/tools/search-reddit-tool.ts`                        | Delete the file                                                                                                                                                   |
| `services/tools/__tests__/social-discovery-tools.test.ts`     | Remove/update Reddit-related test cases                                                                                                                           |
| `services/pipeline/worker-tools/worker-tool-factory.ts`       | Remove `search_reddit` from `SUPPORTED_TOOL_IDS`, remove `createSearchRedditTool` import and call, remove `mockRedditData`/`MOCK_REDDIT_POSTS` from types/imports |
| `services/pipeline/worker-tools/resolve-mock-tool-context.ts` | Remove `mockRedditData`, `MOCK_REDDIT_POSTS` imports, remove `redditPosts` from `applyMockInstrumentFocus` and `fixtures` type                                    |
| `services/pipeline/definitions/selector.phase.ts`             | Remove `reddit-scout` worker from `STANDARD_SELECTOR_DISCOVERY`, remove `SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT` import                                             |
| `services/pipeline/definitions/fundamental.phase.ts`          | Remove `search_reddit` from worker tool arrays (sentiment-context, event-sentiment)                                                                               |
| `services/pipeline/engines/finalizer/selector-risk-filter.ts` | Remove `search_reddit` from `hasSearchEvidence` check                                                                                                             |
| `services/pipeline/worker-prompts.ts`                         | Remove `SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT`, update sentiment prompts that reference "Reddit"                                                                   |
| `services/llm/adapters/run-agent-execute.ts`                  | Remove `search_reddit` from the searchCalls loop guard filter                                                                                                     |
| `services/llm/tool-loop-guard.ts`                             | Remove `search_reddit` from `canonicalizeToolInput`                                                                                                               |
| `services/tools/fetch-url-tool.ts`                            | Update description text mentioning `search_reddit`                                                                                                                |
| `services/tools/README.md`                                    | Remove `search_reddit` from documentation                                                                                                                         |

---

## 4. `get_trending_symbols` — Keep (With Caveat)

Single-source (StockTwits unauthenticated API, often rate-limited). Low cost to maintain, provides a distinct retail sentiment signal that `search_web` can't easily replicate (watchlist counts + message volume + sentiment polarity per symbol). Keep it, but be aware it may return empty data under load.

---

## 5. `get_quote` — Keep

Clean. No issues. Symbol normalization is correct, broker routing is clean.

---

## 6. `fetch_url` — Keep

The strongest tool in this directory. SSRF guard with DNS resolution before fetch, manual redirect validation at every hop, HTML stripping, content capping, untrusted-evidence annotation. Well done.

---

## 7. `search_web` — Keep

Sound implementation. Fallback provider pattern is good. Query sanitization via `validateDiscoveryQuery` is appropriate. Mock mode is cleanly separated.

---

## Summary of Actions

| Action                                            | Files Touched | Risk                                                          |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------- |
| Delete `get_news`                                 | ~15 files     | Low — pure removal of redundant path                          |
| Fix `get_ohlcv` synthetic data                    | 2 files       | Medium — only 2 files but changes tool behavior               |
| Delete `search_reddit`                            | ~12 files     | Low-medium — dead code in live mode, removes a mock-only tool |
| Delete `search-reddit-tool.ts`                    | 1 file        | Low — entire file can go                                      |
| Delete `__tests__/social-discovery-tools.test.ts` | 1 file        | Low — was testing a removed tool                              |

Total: ~20 files touched across all three changes, but all changes are additive-removal (delete code, replace tool references, never introduce new logic). Execution order doesn't matter since no changes conflict.

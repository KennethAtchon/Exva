# Mock Broker Production-Equivalent Sandbox — Deep Plan

> **Date:** 2026-05-07
> **Status:** Draft
> **Owner:** Kenneth Atchon
> **Audience:** Engineers, future maintainers
> **Scope:** Everything required to make mock-broker runs a faithful rehearsal for production AI behaviour: realistic seeded prices, OHLCV history, mock news injection, sandbox system-prompt context, and optional scenario scripting.

---

## 1. Executive Summary

Exva's mock broker currently provides a hollow facade: prices bounce randomly with `Date.now()`, OHLCV bars show a constant declining drift with no volume, news routes to the real search provider (or errors out), and the AI is never told it is operating in a simulated environment. The result is that running a session against the mock broker does not tell you whether the AI pipeline works correctly. It tells you that the code paths execute without crashing — nothing more.

The goal of this plan is to make mock-broker runs _production-equivalent test runs_. After this work, a developer can start a mock session and observe: (a) the AI calling `get_quote` and receiving believable prices, (b) the AI calling `get_ohlcv` and receiving structured bar history with realistic volatility, (c) the AI calling `get_news` and receiving injected mock headlines, (d) the AI being explicitly told it is in a sandbox and should behave accordingly, and (e) all four AI roles — selector, analyst, reviewer, decision maker — producing outputs that reflect the mock data rather than ignoring it.

The core difficulty is that the mock data layer and the prompt construction layer are completely decoupled; neither knows the other exists. Adding sandbox awareness requires threading a single boolean (`isMock`) from the session/broker-registry level down into both the market-data path and the prompt-pack-builder path. The data realism work is self-contained inside the mock adapter and `market-tools.ts`. Together these are two distinct implementation tracks that can be done independently and merged.

---

## 2. Problem Statement

### 2.1 Price non-determinism

`MockBrokerAdapter.priceFor()` computes:

```ts
const seed = [...instrumentSymbol].reduce(
  (sum, char) => sum + char.charCodeAt(0),
  0,
);
return Number((75 + (seed % 250) + (Date.now() % 1000) / 1000).toFixed(2));
```

`Date.now() % 1000` adds up to ±1 USD of noise on every call. Calling `get_quote` twice in one AI run returns different prices. The AI observes incoherent data and cannot form a consistent view, which is not the failure mode we care about testing.

### 2.2 OHLCV is a fabricated declining series

`buildSyntheticBars()` in `market-tools.ts` generates 30 bars from spot price, applying a constant _backward_ drift:

```ts
const drift = (29 - i) * 0.0015;
const close = round2(Math.max(0.01, spot * (1 - drift)));
```

`i=29` (oldest bar) has `drift = 0`, so the oldest bar equals spot price. `i=0` (newest bar) has `drift = 0.0435`, so spot price is 4.35% lower than 30 days ago — i.e., the series shows a 4.35% decline toward today's price. Volume is `null` on every bar. There are no gaps, no volatility, no candle bodies that reflect any realistic price action. A technical analyst running on this data cannot identify any meaningful pattern — EMA, RSI, Bollinger Band, support/resistance — because the series is completely artificial and always identical in shape.

### 2.3 News routes to real search or errors out

`get_news` in `market-tools.ts` calls the search registry:

```ts
const adapter = await deps.searchRegistry.get(deps.searchProviderId);
return adapter.search(sanitizeSearchQuery(`${symbol} latest market news`));
```

When a session is configured with the mock broker but no real search provider, `searchProviderId` is `null` and `get_news` returns `{ error: "Search provider not configured for news tool." }`. When a real search provider _is_ configured, `get_news` calls out to the live internet — which means mock runs spend real money and make real external requests, and also means the AI receives real news that may contradict the mock price scenario.

### 2.4 AI is never told it is in a sandbox

No part of the prompt pipeline injects any sandbox awareness. The system prompt says "You are operating inside Exva, a local autonomous trading desktop app. Your output may influence broker execution after deterministic risk checks." This is accurate for production but misleading during mock runs: the AI is trained to be cautious and conservative, so it may give low-confidence "no trade" decisions when it cannot verify data quality — and it cannot, because the data is indeed unrealistic. The decision-maker's structured output may systematically differ from what it would produce with real data, not because the AI pipeline is broken, but because the prompting context is wrong.

### 2.5 No scenario control

There is no way to instruct the mock adapter to simulate a bull run, a flash crash, a sideways chop, or elevated volatility. Every mock run looks identical in shape. This means you cannot write a regression test for "does the AI say no-trade when the 30-day trend is strongly bearish?"

---

## 3. Goals, Non-Goals, and Invariants

**Goals**

| #   | Goal                                | Success Looks Like                                                                                                                 |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deterministic, coherent mock prices | `get_quote` returns the same price for the same symbol within a session; price is plausible (not sub-$1 or $300+ for most tickers) |
| 2   | Realistic OHLCV bars                | 30-day bar series has volatility, non-null volume, and reflects a configurable scenario (trending up, down, sideways, volatile)    |
| 3   | Injected mock news                  | `get_news` returns structured mock headlines relevant to the symbol without calling the live internet                              |
| 4   | Sandbox-aware prompts               | System prompt tells the AI it is in a sandbox with mock data, so it should still evaluate the data as if real                      |
| 5   | No production code paths changed    | Real broker sessions are unaffected; sandbox injection fires only when the broker is mock                                          |

**Non-Goals**

| #   | Non-Goal                                              | Why It Is Out Of Scope                                                                          |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Real market data replay / historical backtesting      | Different problem; requires data ingestion infra and a replay clock                             |
| 2   | Per-instrument custom price fixtures                  | A scenario-level config is enough; per-symbol overrides add complexity for little testing value |
| 3   | Stateful price simulation (prices move between ticks) | Static seeded prices are sufficient for single-cycle test validation                            |
| 4   | Mock search provider implementation                   | Mock news is injected at the tool level, not through a search adapter                           |
| 5   | UI changes for scenario configuration                 | Config lives in the session record or an environment variable; no UI work in scope              |

**Invariants**

| #   | Invariant                                                                                              | Why It Must Hold                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MockBrokerAdapter` remains stateless between sessions                                                 | It is constructed fresh per session; shared state would cause test interference                                                    |
| 2   | Real broker adapters are not touched                                                                   | Any change to `BrokerAdapter` interface must be backward compatible                                                                |
| 3   | `market-tools.ts` does not import from mock-adapter directly                                           | The mock data path must flow through the existing adapter interface, not bypass it                                                 |
| 4   | Prompt construction remains role-agnostic                                                              | `AgentPromptPackBuilder` must not contain broker-type branching logic; sandbox injection is a parameter, not a hardcoded condition |
| 5   | AI tool contracts (`get_quote`, `get_ohlcv`, `get_news`) return the same schema in mock and production | The AI prompt documents these schemas; the mock must honour them                                                                   |

---

## 4. Current State

### 4.1 Architecture / Components

```
AgentOrchestrator
  └─ AiRuntime
       └─ AgentPromptPackBuilder
            └─ renderSystemPrompt()  ← no sandbox injection
       └─ buildHarnessToolSet()
            └─ createMarketTools()
                 ├─ get_quote  → BrokerRegistry → MockBrokerAdapter.getMarketSnapshot()
                 ├─ get_ohlcv  → MockBrokerAdapter.getMarketSnapshot() + buildSyntheticBars()
                 └─ get_news   → SearchRegistry (real or null)
```

Key files:

| File                                                      | Purpose                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `electron/main/services/broker/adapters/mock-adapter.ts`  | Mock broker: price, order, positions                                          |
| `electron/main/services/tools/market-tools.ts`         | Harness tool implementations; `buildSyntheticBars()` lives here               |
| `electron/main/services/llm/harness-tools.ts`   | Assembles `ToolSet` from availability flags; calls `createMarketTools`        |
| `electron/main/services/llm/prompt-pack-builder.ts`        | Builds system + user prompts; `renderSystemPrompt()` has no sandbox awareness |
| `electron/main/services/llm/runtime.ts`         | `AiRuntime` — calls `buildPromptPack`, then `adapter.runAgent()`              |
| `electron/main/services/llm/runtime-prompt.ts`  | Resolves prompt asset per role                                                |
| `electron/main/services/broker/broker-registry.ts`        | Returns `BrokerAdapter` by account ID                                         |
| `electron/main/services/broker/broker-routing-service.ts` | Maps session + instrument class → broker account ID                           |

### 4.2 Data / State Model

`MockBrokerAdapter` holds in-memory state:

```ts
private readonly orders = new Map<string, { order: BrokerOrder; price: number }>();
```

No price fixture store. No scenario config. The adapter is stateless except for open orders placed during the run.

### 4.3 Critical Runtime Flows

**Price query flow:**

```
get_quote tool execute()
  → brokerAccountIdByClass(instrumentClass)     // BrokerRoutingService
  → BrokerRegistry.get(accountId)               // returns MockBrokerAdapter
  → adapter.getMarketSnapshot(symbol)           // priceFor() → noisy random
  → { instrumentSymbol, price, timestamp }
```

**OHLCV query flow:**

```
get_ohlcv tool execute()
  → getMarketSnapshot(symbol)                   // same noisy price as above
  → buildSyntheticBars(snap.price)              // 30-bar declining series, null volume
  → { symbol, timeframe, bars, note }
```

**News query flow:**

```
get_news tool execute()
  → searchRegistry.get(searchProviderId)        // real search adapter or throws
  → adapter.search(`${symbol} latest market news`)  // live internet call
```

**Prompt construction flow:**

```
AgentPromptPackBuilder.build()
  → renderSystemPrompt({ basePromptMarkdown, toolPolicy, harnessToolAvailability, riskPolicy })
      // No sandbox context. "Your output may influence broker execution."
  → renderUserPrompt({ strategyPrompt, marketContextPlaceholder, task })
      // marketContextPlaceholder says "Market context unavailable"
```

### 4.4 Pain Points and Root Causes

| Pain Point                       | Root Cause                                                            |
| -------------------------------- | --------------------------------------------------------------------- |
| Price changes between tool calls | `Date.now() % 1000` injected into every `priceFor()` call             |
| OHLCV has no volatility          | `buildSyntheticBars` uses a linear drift formula with no noise        |
| Volume always null               | Volume never computed; not part of `getMarketSnapshot` return         |
| News calls live internet         | No mock news path in `get_news`; falls through to real search adapter |
| AI doesn't know it's in sandbox  | No prompt injection point for broker-type context                     |
| No scenario control              | `MockBrokerAdapter` has no configuration surface                      |

---

## 5. Desired End State

### 5.1 Target Architecture

```
AgentOrchestrator
  └─ AiRuntime
       ├─ isMockSession()                        ← NEW: detects mock broker
       └─ AgentPromptPackBuilder
            └─ renderSystemPrompt({ sandboxMode })  ← NEW: sandbox injection
       └─ buildHarnessToolSet({ mockNewsData })   ← NEW: mock news override
            └─ createMarketTools({ mockNews })
                 ├─ get_quote  → MockBrokerAdapter (deterministic seeded price)
                 ├─ get_ohlcv  → MockBrokerAdapter (realistic seeded bars)
                 └─ get_news   → injected mock headlines (no search call)

MockBrokerAdapter
  ├─ constructor(scenario?: MockScenario)         ← NEW: scenario config
  ├─ priceFor(symbol)                             → seeded, stable, no Date.now()
  ├─ getMarketSnapshot(symbol)                    → price + mock volume
  └─ getMockOhlcv(symbol, scenario)               ← NEW: realistic bar generation
```

### 5.2 Data Model Changes

**`MockScenario` type** (new, in mock adapter or shared types):

```ts
export type MockScenarioBias = "bullish" | "bearish" | "sideways" | "volatile";

export interface MockScenario {
  bias?: MockScenarioBias; // default "sideways"
  volatilityPct?: number; // daily std dev as fraction of price, default 0.015
  trendPctPerDay?: number; // signed drift per day, default derived from bias
}
```

**`MockBrokerAdapter` constructor** accepts optional `MockScenario`.

**`createMarketTools` deps** gains optional `mockNewsData`:

```ts
mockNewsData?: MockNewsResult[];
```

Where `MockNewsResult` matches whatever schema the real search adapter returns (so the AI sees an identical structure).

### 5.3 API Contract Changes

`BrokerAdapter` interface gains an optional marker:

```ts
readonly isMock?: boolean;
```

This is a backward-compatible addition. All real adapters leave it `undefined` (falsy). `MockBrokerAdapter` sets `isMock = true`. `AiRuntime` checks this to decide whether to inject sandbox context and mock news.

Alternatively — and preferably — this detection can be done by checking `brokerType === "mock"` which is already on the adapter. The `isMock` marker is therefore not strictly necessary if `AiRuntime` can reach the adapter type.

### 5.4 Prompt Changes

System prompt gains a conditional block when `sandboxMode === true`:

```
## Sandbox Mode
You are running in a PAPER TRADING / MOCK SANDBOX. All market data returned by tools
(prices, OHLCV bars, news) is synthetic and does not reflect real markets.

Your job is identical to a production run: evaluate the mock data seriously, form a view,
and make a trade/no-trade decision. Calibrate confidence and sizing as you would with
real data. The goal is to validate that your reasoning pipeline works correctly.

Do NOT refuse to trade simply because you "know" the data is simulated.
Do NOT mention that data is synthetic in your analysis — treat it as real market input.
```

### 5.5 What Gets Deleted / Changed

| Item                                               | Change                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `priceFor()` in mock adapter                       | Remove `Date.now()` term; use pure char-code seed                                |
| `buildSyntheticBars()` in `market-tools.ts`        | Replace with `ScenarioBarGenerator` with realistic noise and scenario bias       |
| `get_news` fallback path                           | Add `mockNewsData` short-circuit before search call                              |
| `renderSystemPrompt()` in `prompt-pack-builder.ts` | Accept `sandboxMode?: boolean`; inject sandbox block                             |
| `buildHarnessToolSet()` in `harness-tools.ts`      | Accept `mockNewsData` and forward to `createMarketTools`                         |
| `AiRuntime`                                        | Detect mock session; pass `sandboxMode` and `mockNewsData` to downstream callers |

---

## 6. Gap Analysis

| Area                   | Current State                              | Target State                             | Required Change                                                            |
| ---------------------- | ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| Price determinism      | `Date.now() % 1000` noise                  | Pure char-code seed                      | Remove `Date.now()` from `priceFor()`                                      |
| Price range            | 75–325 USD range for everything            | Symbol-class-aware base prices           | Add class-aware base price lookup                                          |
| OHLCV quality          | Linear decline, null volume                | Scenario-biased bars with noise + volume | Replace `buildSyntheticBars`                                               |
| OHLCV source           | Called from `market-tools.ts` generic path | Mock adapter can serve its own OHLCV     | Add `getMockOhlcv()` to mock adapter; call conditionally from market tools |
| News source            | Live search or error                       | Injected mock headlines                  | Thread `mockNewsData` into `get_news` handler                              |
| Prompt sandbox context | None                                       | Sandbox block in system prompt           | Add `sandboxMode` param to `renderSystemPrompt`                            |
| Mock detection         | No detection                               | `isMockSession()` in AiRuntime           | Check broker type via registry                                             |
| Scenario config        | None                                       | `MockScenario` on adapter constructor    | Add scenario param and wire from session config                            |

**Hard gaps:**

1. **Mock detection requires adapter introspection** — `AiRuntime` currently has no way to ask "is the broker for this session a mock?" without reaching through the routing service and registry. A helper method in `AiRuntime` (`isMockSession(sessionId)`) is needed that resolves the broker adapter and checks `brokerType === "mock"`.

2. **`market-tools.ts` cannot call mock-specific methods** — `get_ohlcv` receives a `BrokerAdapter` instance and calls `getMarketSnapshot`. To use mock-specific bar generation, `market-tools.ts` would need to type-narrow the adapter to `MockBrokerAdapter` (import coupling) or the bar generation must be fully inside `createMarketTools` with a mock data injection param. The injection approach (pass pre-generated bars, or a `getMockBars` callback) is cleaner.

3. **Mock news schema must match real news schema** — The `get_news` tool currently returns whatever the search adapter returns. If the AI's system prompt documents a specific schema, mock news must match it exactly. The current system prompt does not document the news schema explicitly, but the AI will have learned from the real adapter's responses. The mock news JSON structure should mirror what Perplexity or similar would return.

---

## 7. Options Considered

### Option A: Patch in place (minimal changes)

Fix only `priceFor()` (remove `Date.now()`), improve `buildSyntheticBars` slightly, and return a hardcoded news string for mock sessions. No sandbox prompt injection, no scenario config.

| Dimension        | Assessment                                                     |
| ---------------- | -------------------------------------------------------------- |
| Build complexity | Low — 2 files                                                  |
| Migration risk   | None                                                           |
| Runtime risk     | None                                                           |
| Reversibility    | Trivial                                                        |
| Team fit         | Easy                                                           |
| Testability      | Improves price determinism; OHLCV still poor; news still wrong |
| Maintainability  | No new abstractions to maintain                                |

**Verdict:** Solves the most acute bug (price non-determinism) but leaves OHLCV and news broken, and leaves AI prompt context wrong. Testing value remains limited.

### Option B: Full sandbox injection layer (this plan's recommendation)

Fix all five defects: price seeding, OHLCV realism, mock news injection, sandbox prompt context, and optional scenario config. Thread `isMock` detection from `AiRuntime` outward to both the market tools and the prompt builder.

| Dimension        | Assessment                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| Build complexity | Medium — 6 files touched, one new type                                 |
| Migration risk   | None — additive changes; real sessions unaffected                      |
| Runtime risk     | Low — conditional on `isMock` flag; all existing paths preserved       |
| Reversibility    | Full — `isMock` flag can be removed cleanly                            |
| Team fit         | Moderate — requires understanding the prompt-pack builder architecture |
| Testability      | High — end-to-end mock runs produce meaningful AI decisions            |
| Maintainability  | Low overhead — `MockScenario` is simple; no new service boundary       |

### Option C: Dedicated mock data service

Introduce a `MockMarketDataService` as a new injectable singleton with its own scenario store, headline generator, and price-history tables. Wire it alongside `BrokerRegistry` in the DI graph.

| Dimension        | Assessment                                      |
| ---------------- | ----------------------------------------------- |
| Build complexity | High — new service, new repo, new DI wiring     |
| Migration risk   | Low                                             |
| Runtime risk     | Low                                             |
| Reversibility    | Moderate — additional service to decommission   |
| Team fit         | Complex — more moving parts, more to understand |
| Testability      | Highest ceiling, but overkill for current needs |
| Maintainability  | Higher long-term overhead                       |

**Verdict:** Unjustified for a mock testing environment. Option B achieves the same validation goals with far less ceremony.

---

## 8. Recommendation

**Choose Option B.** It fixes all five defects, requires no new service boundaries, and leaves every existing production code path untouched. The `isMock` detection is a single point of truth in `AiRuntime` and threads downward to exactly two call sites (prompt builder and harness tools). The `MockScenario` type is a simple value object with no persistence or lifecycle.

Option A is tempting for speed, but leaving the prompt context wrong means mock runs still do not validate the AI decision pipeline — which is the core goal. Option C is premature given that the mock adapter is already the right place to own mock data generation.

The recommendation depends on: the `BrokerRegistry` remaining accessible from `AiRuntime` (it is, via `this.brokerRouting`), and `renderSystemPrompt` remaining a pure function (it is — it takes explicit params, doesn't close over session state).

---

## 9. Detailed Design

### 9.1 Module Boundaries

No new modules. Changes are contained to:

```
electron/main/services/broker/adapters/mock-adapter.ts
electron/main/services/tools/market-tools.ts
electron/main/services/llm/harness-tools.ts
electron/main/services/llm/prompt-pack-builder.ts
electron/main/services/llm/runtime.ts
```

Optional: a shared type file for `MockScenario` and `MockNewsResult` if they need to be referenced from multiple modules.

### 9.2 Track 1 — Mock Data Realism

#### 9.2.1 Fix `priceFor()`

```ts
private priceFor(instrumentSymbol: string): number {
  const seed = [...instrumentSymbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  // Stable per-symbol base price in $50–$400 range, no time component
  return Number((50 + (seed % 350)).toFixed(2));
}
```

If per-class base prices are desired (crypto at $10k+ range, prediction markets at $0.50–$0.95), a lookup is straightforward:

```ts
private basePrice(instrumentClass: InstrumentClass, seed: number): number {
  switch (instrumentClass) {
    case "crypto": return 1000 + (seed % 60000);
    case "prediction_market": return 0.50 + (seed % 45) / 100;
    case "futures": return 500 + (seed % 5000);
    default: return 50 + (seed % 350);
  }
}
```

But `getMarketSnapshot` doesn't receive `instrumentClass`, so the simple per-symbol seed is sufficient unless we add `instrumentClass` to the signature. For now, keep it simple.

#### 9.2.2 Realistic OHLCV via `getMockOhlcv()`

Add to `MockBrokerAdapter`:

```ts
getMockOhlcv(symbol: string, barCount = 30): SyntheticBar[] {
  const seed = symbolSeed(symbol);
  const base = this.priceFor(symbol);
  const bias = this.scenario?.bias ?? "sideways";
  const dailyDrift = this.scenario?.trendPctPerDay ?? scenarioDrift[bias];
  const dailyVol = this.scenario?.volatilityPct ?? 0.015;

  const bars: SyntheticBar[] = [];
  let price = base * Math.exp(-dailyDrift * barCount); // start further back

  for (let i = 0; i < barCount; i++) {
    const noise = seededNormal(seed + i) * dailyVol;
    const ret = dailyDrift + noise;
    const open = price;
    const close = round2(price * (1 + ret));
    const high = round2(Math.max(open, close) * (1 + Math.abs(seededNormal(seed + i + 1000)) * 0.005));
    const low = round2(Math.min(open, close) * (1 - Math.abs(seededNormal(seed + i + 2000)) * 0.005));
    const volume = Math.round(base * (500 + (seed + i) % 1000));
    bars.push({
      ts: new Date(Date.now() - (barCount - 1 - i) * DAY_MS).toISOString(),
      open, high, low, close, volume,
    });
    price = close;
  }
  return bars;
}

const scenarioDrift: Record<MockScenarioBias, number> = {
  bullish: 0.005,
  bearish: -0.005,
  sideways: 0.0,
  volatile: 0.001,
};
```

`seededNormal(seed)` — a deterministic Box-Muller or simple LCG approximation:

```ts
function seededNormal(seed: number): number {
  // LCG → uniform → Box-Muller approximation (fast, good enough for mock data)
  const u1 = ((seed * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const u2 = (((seed + 1) * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  return (
    Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2)
  );
}
```

This is fully deterministic for the same seed — same symbol, same bars every run.

#### 9.2.3 Wire `getMockOhlcv` into `market-tools.ts`

`createMarketTools` currently calls `getMarketSnapshot` + `buildSyntheticBars`. The cleanest approach without import coupling to `MockBrokerAdapter`:

Add an optional callback to `createMarketTools` deps:

```ts
export function createMarketTools(deps: {
  // ...existing...
  getMockOhlcv?: (symbol: string) => SyntheticBar[]; // NEW
  mockNewsData?: MockNewsResult[]; // NEW
});
```

In `get_ohlcv` execute:

```ts
execute: async ({ symbol, instrumentClass }) => {
  if (deps.getMockOhlcv) {
    return { symbol, timeframe: "1d", bars: deps.getMockOhlcv(symbol) };
  }
  // existing path: getMarketSnapshot + buildSyntheticBars
  ...
}
```

In `get_news` execute:

```ts
execute: async ({ symbol }) => {
  if (deps.mockNewsData) {
    return { results: deps.mockNewsData.map(n => ({ ...n, query: symbol })) };
  }
  // existing real search path
  ...
}
```

#### 9.2.4 Mock news data

Define `MockNewsResult` to match what the AI has seen from the real search adapter. Looking at how `get_news` is used today, the real adapter returns whatever the search provider returns (Perplexity, Brave, etc.) — the AI processes it as free text. The simplest mock is an array of headline strings in a `results` array:

```ts
export interface MockNewsItem {
  title: string;
  snippet: string;
  url: string;
  publishedAt: string;
}

const DEFAULT_MOCK_NEWS: MockNewsItem[] = [
  {
    title: "Markets steady as macro data comes in mixed",
    snippet:
      "Equities remain range-bound with no clear directional catalyst after this week's data releases.",
    url: "https://mock.local/news/1",
    publishedAt: new Date().toISOString(),
  },
  {
    title: "No significant corporate news for this instrument this week",
    snippet: "Volume has been below average. No earnings, no filings.",
    url: "https://mock.local/news/2",
    publishedAt: new Date().toISOString(),
  },
];
```

This is intentionally neutral — the AI should form its view from price/OHLCV data, not from injected bullish/bearish headlines that would short-circuit its analysis.

### 9.3 Track 2 — Sandbox Prompt Injection

#### 9.3.1 `isMockSession()` in `AiRuntime`

```ts
private isMockSession(sessionId: string): boolean {
  if (!this.brokerRouting || !this.brokerRegistry) return false;
  try {
    // Try resolving for any instrument class — if any returns mock, flag it
    const accountId = this.brokerRouting.resolveBrokerAccountId(sessionId, "stock");
    if (!accountId) return false;
    // BrokerRegistry.get() is async; we need a sync path here.
    // Option: check registered account metadata (providerKey === "mock")
    // OR expose a sync `getType(accountId)` on BrokerRegistry
    return this.brokerRegistry.isMockAccount(accountId);
  } catch {
    return false;
  }
}
```

This requires adding `isMockAccount(accountId: string): boolean` to `BrokerRegistry`, which checks the stored provider key without instantiating the adapter:

```ts
isMockAccount(accountId: string): boolean {
  const account = this.accounts.find(a => a.id === accountId);
  return account?.providerKey === "mock";
}
```

Alternatively, resolve the adapter via the existing async `get()` and check `adapter.brokerType === "mock"`. Since this detection only runs once per role invocation (not per tool call), an `await` is acceptable.

#### 9.3.2 Thread `sandboxMode` into `buildPromptPack`

In `AiRuntime.buildPromptPack()`:

```ts
private async buildPromptPack(
  sessionId: string,
  role: AgentRole,
  config: { promptSource: "default" | "session_override"; promptMarkdown: string },
  task: AgentTaskPrompt,
  harnessToolAvailability: HarnessToolAvailability,
) {
  const basePromptMarkdown = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
  const sandboxMode = await this.isMockSession(sessionId);   // NEW
  return new AgentPromptPackBuilder(this.requireStrategyContextService()).build({
    sessionId,
    role,
    basePromptMarkdown,
    task,
    harnessToolAvailability,
    sandboxMode,   // NEW
  });
}
```

#### 9.3.3 Sandbox block in `AgentPromptPackBuilder`

`PromptPack.build()` gains `sandboxMode?: boolean` in its input. `renderSystemPrompt` gets the same param:

```ts
function renderSystemPrompt(input: {
  role: AgentRole;
  basePromptMarkdown: string;
  toolPolicy: RoleToolPolicy;
  harnessToolAvailability: HarnessToolAvailability;
  riskPolicy: RuntimeRiskPolicy;
  sandboxMode?: boolean; // NEW
}): string {
  const sections = [
    input.basePromptMarkdown.trim(),
    "",
    "## Runtime Authority",
    input.sandboxMode
      ? "You are operating inside Exva in PAPER TRADING / SANDBOX mode. Market data (prices, OHLCV, news) is synthetic."
      : "You are operating inside Exva, a local autonomous trading desktop app. Your output may influence broker execution after deterministic risk checks.",
    "",
    ...(input.sandboxMode
      ? [
          "## Sandbox Mode",
          "All tool data is mock/synthetic. Evaluate it as if it were real market data.",
          "Make a genuine trade/no-trade decision based on what the data shows.",
          "Do not refuse to trade solely because you know data is simulated.",
          "Do not disclose sandbox status in your analysis or reasoning text.",
          "",
        ]
      : []),
    "## Tool Policy For This Run",
    renderToolPolicy(
      input.role,
      input.toolPolicy,
      input.harnessToolAvailability,
    ),
    // ...rest unchanged
  ];
  return sections.join("\n");
}
```

#### 9.3.4 Thread mock data into harness tools

In `AiRuntime`, when calling `buildHarnessToolSet`, pass mock data refs:

```ts
const isMock = await this.isMockSession(sessionId);
const mockAdapter = isMock ? await this.resolveMockAdapter(sessionId) : null;

const tools = await buildHarnessToolSet({
  sessionId,
  role,
  cycleId: opts?.cycleId ?? null,
  availability: harnessAvail,
  searchProviderId,
  resolveSearchTool: this.resolveSearchTool.bind(this),
  searchRegistry: this.searchRegistry,
  brokerRouting: this.brokerRouting,
  brokerRegistry: this.brokerRegistry,
  getMockOhlcv: mockAdapter
    ? (symbol: string) => mockAdapter.getMockOhlcv(symbol)
    : undefined, // NEW
  mockNewsData: isMock ? DEFAULT_MOCK_NEWS : undefined, // NEW
});
```

`resolveMockAdapter()`:

```ts
private async resolveMockAdapter(sessionId: string): Promise<MockBrokerAdapter | null> {
  if (!this.brokerRouting || !this.brokerRegistry) return null;
  try {
    const accountId = this.brokerRouting.resolveBrokerAccountId(sessionId, "stock");
    if (!accountId) return null;
    const adapter = await this.brokerRegistry.get(accountId);
    return adapter.brokerType === "mock" ? (adapter as MockBrokerAdapter) : null;
  } catch {
    return null;
  }
}
```

This preserves the invariant that `market-tools.ts` never imports from `mock-adapter.ts` — the callback is a closure over the adapter instance, resolved in `AiRuntime`.

### 9.4 `MockScenario` Wiring

`MockBrokerAdapter` constructor:

```ts
constructor(private readonly scenario: MockScenario = {}) {}
```

The broker registry factory for mock accounts needs to pass through a scenario. Where mock accounts are registered (likely in the broker factory / DI setup), add:

```ts
new MockBrokerAdapter({ bias: "bullish", volatilityPct: 0.02 });
```

For now, the default scenario (sideways, 1.5% vol) is sufficient. Scenario configuration from session settings is a future enhancement.

### 9.5 Full File-Level Change Summary

```
electron/main/services/broker/adapters/mock-adapter.ts
  - Remove Date.now() from priceFor()
  - Add MockScenario type and constructor param
  - Add getMockOhlcv(symbol, barCount?) method
  - Add seededNormal() helper
  - Add symbolSeed() helper (extracted from priceFor)

electron/main/services/tools/market-tools.ts
  - Add getMockOhlcv? and mockNewsData? to createMarketTools deps
  - get_ohlcv: short-circuit to getMockOhlcv if present
  - get_news: short-circuit to mockNewsData if present
  - Export MockNewsItem interface (or import from shared types)
  - Remove or deprecate buildSyntheticBars() (keep as fallback if getMockOhlcv absent)

electron/main/services/llm/harness-tools.ts
  - Add getMockOhlcv? and mockNewsData? to buildHarnessToolSet input
  - Forward both to createMarketTools call

electron/main/services/llm/prompt-pack-builder.ts
  - Add sandboxMode?: boolean to build() input and renderSystemPrompt input
  - Inject sandbox block conditionally in renderSystemPrompt

electron/main/services/llm/runtime.ts
  - Add isMockSession(sessionId): Promise<boolean>
  - Add resolveMockAdapter(sessionId): Promise<MockBrokerAdapter | null>
  - Update buildPromptPack to be async; await isMockSession; pass sandboxMode
  - Pass getMockOhlcv and mockNewsData to buildHarnessToolSet

electron/main/services/broker/broker-registry.ts
  - Add isMockAccount(accountId): boolean  [optional — can check brokerType post-get]
```

---

## 10. Implementation Plan

### Phase 1 — Price Determinism (30 min, zero risk)

**Objective:** Fix non-deterministic prices. The single most disruptive bug for AI coherence.

**Code changes:**

- `mock-adapter.ts`: Remove `(Date.now() % 1000) / 1000` from `priceFor()`. Extract `symbolSeed()` helper. The resulting price is stable for the duration of the session.

**Validation:**

- Start a mock session. Call `get_quote` twice for the same symbol (check logs). Prices must be identical.
- Run `tsc --noEmit` — no type errors.

**Rollback:** Trivially revert the one-line change.

**Done criteria:** `get_quote` returns the same price for the same symbol within a session.

---

### Phase 2 — OHLCV Realism (2–3 hours)

**Objective:** Replace the constant-drift synthetic bars with a seeded, scenario-biased series that looks like real price history.

**Code changes:**

- `mock-adapter.ts`: Add `MockScenario` type, `seededNormal()`, `getMockOhlcv()`.
- `market-tools.ts`: Add `getMockOhlcv?` callback to deps; short-circuit in `get_ohlcv`. Keep existing `buildSyntheticBars` as unreachable fallback.
- `harness-tools.ts`: Forward `getMockOhlcv` through `buildHarnessToolSet`.
- `runtime.ts`: Add `resolveMockAdapter()`; pass `getMockOhlcv` callback to `buildHarnessToolSet`.

**Validation:**

- Start a mock session. Call `get_ohlcv` for a symbol. Inspect logs for bar data. Verify: 30 bars, non-null volume, non-monotone closes, high > close > low on every bar.
- Call `get_ohlcv` twice for the same symbol — bars must be identical (deterministic).
- Run a full AI cycle. Confirm technical analyst output references price levels or trend — not a generic "insufficient data" response.

**Rollback:** Remove `getMockOhlcv` param; `market-tools.ts` falls back to existing `buildSyntheticBars`.

**Done criteria:** OHLCV bars have volatility, non-null volume, are deterministic, and reflect scenario bias direction.

---

### Phase 3 — Mock News Injection (1 hour)

**Objective:** `get_news` returns injected mock headlines; no live internet call during mock sessions.

**Code changes:**

- Define `MockNewsItem` interface and `DEFAULT_MOCK_NEWS` array in `market-tools.ts` (or a shared constants file).
- Add `mockNewsData?` to `createMarketTools` deps; short-circuit in `get_news` execute.
- Add `mockNewsData?` to `buildHarnessToolSet` input; forward to `createMarketTools`.
- `runtime.ts`: Detect mock session; pass `DEFAULT_MOCK_NEWS` to `buildHarnessToolSet`.

**Validation:**

- Enable a search provider in the session. Start a mock session. Confirm in logs that `get_news` tool result contains mock headlines, not real search results.
- Start a mock session with no search provider configured. Confirm `get_news` still returns mock headlines (not an error).
- Confirm real sessions with a search provider still call live search.

**Rollback:** Remove `mockNewsData` param; falls through to existing search path.

**Done criteria:** `get_news` during mock runs returns mock headlines without calling any external URL.

---

### Phase 4 — Sandbox Prompt Injection (2 hours)

**Objective:** System prompt tells the AI it is in a sandbox and should evaluate mock data as if real.

**Code changes:**

- `runtime.ts`: Add `isMockSession(sessionId): Promise<boolean>`. Make `buildPromptPack` async.
- `prompt-pack-builder.ts`: Add `sandboxMode?: boolean` to `build()` input and `renderSystemPrompt()`. Inject sandbox block when true.
- Update all call sites of `buildPromptPack` in `runtime.ts` to `await` it.

**Validation:**

- Start a mock session. Check the `execute run agent start` log. The `systemPrompt` field must contain "PAPER TRADING / SANDBOX".
- Start a real session. Confirm system prompt does NOT contain "PAPER TRADING / SANDBOX".
- Run a full mock AI cycle. Confirm the decision-maker produces a structured output (trade or no-trade with reasoning) — not a refusal.

**Rollback:** Pass `sandboxMode: false` to `renderSystemPrompt`; sandbox block is never rendered.

**Done criteria:** Mock sessions have sandbox block in system prompt; real sessions do not.

---

### Phase 5 — Scenario Config (optional, 1 hour)

**Objective:** Allow the broker factory to pass a `MockScenario` to `MockBrokerAdapter`.

**Code changes:**

- `mock-adapter.ts` constructor already accepts `MockScenario` from Phase 2.
- Find where `MockBrokerAdapter` is constructed (likely `broker-factory.ts` or the DI container setup). Pass a scenario object — even if hardcoded at first.

**Validation:**

- Change scenario to `{ bias: "bullish" }`. Run a mock session. Verify OHLCV bars trend upward over 30 days.
- Change to `{ bias: "bearish" }`. Verify bars trend downward.

**Done criteria:** Scenario bias is visible in bar data and AI analysis references trend direction.

---

## 11. Testing and Verification Strategy

### Unit Tests

**`mock-adapter.ts`**

- `priceFor("BTCUSD")` returns the same value when called twice (no `Date.now()` dependency).
- `getMockOhlcv("BTCUSD", 30)` returns 30 bars, all with non-null volume, `high >= max(open,close)`, `low <= min(open,close)`.
- With `bias: "bullish"`, the last bar close is higher than the first bar close.
- With `bias: "bearish"`, the last bar close is lower than the first bar close.
- Bars are identical across two calls for the same symbol (determinism).

**`market-tools.ts`**

- When `getMockOhlcv` callback is provided, `get_ohlcv` returns its output without calling the broker.
- When `mockNewsData` is provided, `get_news` returns mock data without calling search registry.
- When neither is provided, existing real paths execute.

**`prompt-pack-builder.ts`**

- `renderSystemPrompt({ sandboxMode: true, ... })` output contains "PAPER TRADING".
- `renderSystemPrompt({ sandboxMode: false, ... })` output does not contain "PAPER TRADING".
- `renderSystemPrompt({ sandboxMode: undefined, ... })` output does not contain "PAPER TRADING".

### Integration / End-to-End

**Mock session full cycle:**

1. Start a session with mock broker configured.
2. Run one full AI cycle (instrument selector → analyst → reviewer → decision maker).
3. Assert:
   - All four `execute run agent start` logs have `systemPrompt` containing "PAPER TRADING" (except decision maker if it uses `enforceNoTools`).
   - `agent tool call` logs for `get_quote` show a stable price.
   - `agent tool call` logs for `get_ohlcv` show bars with volume.
   - `agent tool call` logs for `get_news` show mock headlines.
   - Decision maker structured output is non-null (no parse fallback).
   - Decision maker `action` field is either `"trade"` or `"no_trade"` with a reasoning string.

**Real session regression:**

- Start a session with a real broker. Confirm `execute run agent start` system prompt does NOT contain "PAPER TRADING". Confirm `get_news` hits live search.

---

## 12. Risks and Failure Modes

| #   | Risk                                                   | Likelihood | Impact                                       | Detection                                         | Mitigation                                          | Rollback                     |
| --- | ------------------------------------------------------ | ---------- | -------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| 1   | `isMockSession()` returns true for real sessions       | Low        | High — sandbox prompt injected into real run | Regression test on real session system prompt     | Unit test `isMockSession` with real broker type     | Revert detection logic       |
| 2   | `buildPromptPack` becomes async, breaks callers        | Medium     | Medium — compile error                       | `tsc --noEmit`                                    | Update all call sites to `await`                    | Revert async change          |
| 3   | `getMockOhlcv` closure holds stale adapter reference   | Low        | Low — stale bars                             | Check adapter lifetime in registry                | Resolve adapter fresh per call if needed            | Remove callback pattern      |
| 4   | Mock news JSON schema differs from real search schema  | Medium     | Low — AI still processes it                  | Run mock session; check AI cites news in analysis | Align `MockNewsItem` shape to real adapter output   | Adjust `MockNewsItem` fields |
| 5   | Sandbox prompt changes AI behaviour in unexpected ways | Low        | Low — decision quality may change            | Compare decision outputs before/after             | Keep sandbox block minimal; don't over-constrain AI | Remove sandbox block         |
| 6   | `seededNormal` produces degenerate values (NaN, Inf)   | Low        | Medium — bars have invalid prices            | Assert valid ranges in unit test                  | Guard `Math.log(Math.max(u1, 1e-9))`                | Add clamp to generated price |

**Top risk in detail — Risk 2 (async `buildPromptPack`):**

`AiRuntime.buildPromptPack()` is currently synchronous and called three times: in `runRole()`, `runDecisionRole()`, and `runInstrumentSelector()`. Making it async requires all three call sites to `await` it. This is a mechanical change but must be done atomically — a partial update leaves the type checker happy while runtime behaviour is wrong. Run `tsc --noEmit` immediately after the change to catch all missed awaits.

---

## 13. Operational Rollout

This is a local Electron app — no deployment, no staged rollout. Verification is manual:

1. Pull the branch. Run `bun run typecheck`.
2. Start the app in development mode.
3. Configure a session with the mock broker.
4. Start a trading cycle. Watch the terminal logs.
5. Verify the five assertions from §11 Integration.
6. Start a session with a real broker (or a provider connection test). Verify real paths are unaffected.

No feature flags needed — the `isMockSession` check is always active and naturally scoped to mock adapter type.

---

## 14. Open Questions

| #   | Question                                                                                                  | Why It Matters                                                                                      | Owner | Resolution Needed By   |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----- | ---------------------- |
| 1   | Does `BrokerRoutingService.resolveBrokerAccountId` throw for missing instrument classes in mock sessions? | `isMockSession` calls it; if it throws for `"stock"` in a crypto-only mock session, detection fails | Ken   | Before Phase 4         |
| 2   | Should `MockScenario` be configurable from the session creation UI?                                       | Determines whether scenario config needs DB persistence or can stay in-memory at construction time  | Ken   | Phase 5 design         |
| 3   | What does the real search adapter response look like?                                                     | `MockNewsItem` must match its schema or the AI will notice the format change between runs           | Ken   | Before Phase 3         |
| 4   | Is `getMockOhlcv` the right name, or should this be on a `MockMarketDataProvider` interface?              | Naming choice affects future extensibility                                                          | Ken   | Phase 2 design         |
| 5   | Should the sandbox block tell the AI to disclose sandbox status in its reasoning, or stay silent?         | Affects what appears in `assistantText` and logs                                                    | Ken   | Phase 4 implementation |

---

## 15. Appendix

### A. Current `priceFor` bug reproduction

```ts
// Called at t=0
priceFor("AAPL"); // → 75 + (65+65+76+76) % 250 + (1746578123456 % 1000) / 1000
// → 75 + 32 + 0.456 = 107.456

// Called at t=500ms
priceFor("AAPL"); // → 75 + 32 + 0.956 = 107.956
// Δ = 0.5 USD in 500ms — incoherent for the AI
```

### B. `buildSyntheticBars` current output shape for `spot=100`

```
i=29 (oldest): close = 100 * (1 - 0)     = 100.00
i=15 (midpoint): close = 100 * (1 - 0.021) = 97.90
i=0  (newest): close = 100 * (1 - 0.0435) = 95.65
volume = null on all bars
```

This is a 4.35% decline from oldest to newest, with zero noise and zero volume. A technical analyst would see a perfectly smooth downtrend with no tradeable structure.

### C. Seeded OHLCV example output (Phase 2 target, `bias="bullish"`, `spot=100`)

```
Day 1:  open=91.22, high=91.89, low=90.88, close=91.34, volume=74500
Day 15: open=95.61, high=96.44, low=95.10, close=95.88, volume=81200
Day 30: open=99.73, high=100.52, low=99.21, close=100.08, volume=77900
```

Trend is upward, volatility is visible, candle bodies vary, volume is non-null.

### D. Referenced files

- `electron/main/services/broker/adapters/mock-adapter.ts`
- `electron/main/services/tools/market-tools.ts`
- `electron/main/services/llm/harness-tools.ts`
- `electron/main/services/llm/prompt-pack-builder.ts`
- `electron/main/services/llm/runtime.ts`
- `electron/main/services/llm/runtime-prompt.ts`
- `electron/main/services/broker/broker-registry.ts`
- `electron/main/services/broker/broker-routing-service.ts`
- `electron/main/services/orchestration/agent-orchestrator.ts`

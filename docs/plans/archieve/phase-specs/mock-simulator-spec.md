# Mock Simulator Spec — Phase 5

> **Status:** Not started
> **Files to create:**
>
> - `electron/main/services/broker/mock/mock-market-simulator.ts`
> - `electron/main/services/broker/mock/mock-scenario-fixtures.ts`
> - `electron/main/services/broker/mock/mock-execution-faults.ts`
>   **Files to modify:**
> - `electron/main/services/broker/adapters/mock-adapter.ts` (fix PnL, add bid/ask, add timeframe param)
> - `electron/main/services/broker/adapters/broker-adapter.ts` (expand `MarketSnapshot`)
> - `electron/main/services/ai/tools/market-tools.ts` (add `timeframe` param to `get_ohlcv`)
> - `electron/main/services/ai/tools/search-reddit-tool.ts` (live mode guard)

---

## Goal

Mock mode must be able to simulate losing trades, bad fills, stale data, rejected orders, and conflicting signals. A mock system that always trends up and always profits teaches nothing. Every new gate added in Phase 3/6 must have a scenario that exercises it.

---

## 1. `MockScenarioKind` Enum

```ts
export type MockScenarioKind =
  | "clean_breakout" // bullish trend, clean fill, stop never hit, take-profit exits
  | "failed_breakout" // entry on breakout, reversal, stop-loss triggered
  | "sideways_chop" // no clear signal, selector should produce no-trade
  | "gap_down_after_entry" // opens with large gap below entry; stop hit immediately
  | "news_reversal" // bullish chart but bearish news catalyst; reviewer should reject
  | "stale_quote" // quote timestamp is 10+ min old; freshness gate blocks
  | "wide_spread" // bid/ask spread > threshold; spread gate blocks
  | "partial_fill" // broker fills only 40–70% of requested size
  | "broker_reject" // broker returns order rejection; capital reservation released
  | "rate_limit"; // broker returns 429; step runner retries with backoff
```

---

## 2. Scenario Definitions

Each scenario has four sections: **quote/snapshot**, **OHLCV bars**, **social/news**, **broker behavior**.

All prices use a `BASE_PRICE` of `100.00` for clarity. Adapters apply a symbol-specific seed multiplier on top.

---

### `clean_breakout`

**Purpose:** Happy path. All gates pass. Exit via take-profit.

**Quote / snapshot:**

```ts
{ price: 105.00, bid: 104.90, ask: 105.10, spreadPct: 0.19, volume: 850_000, timestamp: now() }
```

**OHLCV (4h, 30 bars):**

- Steady uptrend: each bar closes ~0.4% above previous close
- No bar closes below the prior low (clean structure)
- Final bar: strong close with above-average volume

**Social/news:**

```ts
news: [
  {
    headline: `${symbol} reports earnings beat, raises guidance`,
    sentiment: "bullish",
  },
  {
    headline: `${symbol} breaks multi-week resistance on volume`,
    sentiment: "bullish",
  },
];
reddit: [
  {
    body: `$${symbol} setting up for a breakout, volume confirming`,
    score: 420,
    sentiment: "bullish",
  },
];
trending: [symbol];
```

**Broker behavior:**

- `placeOrder`: full fill at `quote.price`
- `getOrderStatus`: returns `open` for 2 ticks, then `closed` (simulating take-profit hit at broker)
- `closeOrder`: PnL = `+entry * takeProfitPct / 100 * sizeUsd / entry` → positive

**Expected policy outcome:** All gates pass. Trade opens. Take-profit closes it. Positive PnL.

---

### `failed_breakout`

**Purpose:** Entry on breakout signal, price reverses, stop-loss triggered. Negative PnL.

**Quote / snapshot:**

```ts
{ price: 102.00, bid: 101.85, ask: 102.15, spreadPct: 0.29, volume: 620_000, timestamp: now() }
```

**OHLCV (4h, 30 bars):**

- 25 bars trending up, final 5 bars showing sharp reversal
- Last bar closes below 20-bar moving average
- Volume spike on reversal bar

**Social/news:**

```ts
news: [
  { headline: `${symbol} faces regulatory headwinds`, sentiment: "bearish" },
];
reddit: [
  {
    body: `${symbol} breakout failed, looks like distribution to me`,
    score: 180,
    sentiment: "bearish",
  },
];
```

**Broker behavior:**

- `placeOrder`: full fill at `quote.price`
- `getOrderStatus`: returns `open` for 1 tick
- `closeOrder` (triggered by `ExitPolicyEvaluator`): PnL = `-(stopLossPct / 100) * sizeUsd` → negative

**Expected policy outcome:** Trade opens. Stop-loss fires. Negative PnL recorded.

---

### `sideways_chop`

**Purpose:** No clear directional signal. AI should return `action: "no_trade"`. No order placed.

**Quote / snapshot:**

```ts
{ price: 100.00, bid: 99.80, ask: 100.20, spreadPct: 0.40, volume: 180_000, timestamp: now() }
```

**OHLCV (4h, 30 bars):**

- Price oscillates ±2% around 100 with no sustained trend
- Multiple failed breakout attempts (fakeouts above and below)

**Social/news:**

```ts
news: [
  {
    headline: `${symbol} reports in-line quarter, no surprises`,
    sentiment: "neutral",
  },
];
reddit: [
  {
    body: `${symbol} going nowhere, just chop`,
    score: 55,
    sentiment: "neutral",
  },
];
```

**Broker behavior:** Not reached.

**Expected policy outcome:** Reviewer or decision maker returns `action: "no_trade"`. No order placed. Cycle restarts.

---

### `gap_down_after_entry`

**Purpose:** Trade opens, next bar gaps down massively (e.g. earnings miss). Stop-loss hits immediately on monitor tick.

**Quote / snapshot:**

```ts
{ price: 98.00, bid: 97.80, ask: 98.20, spreadPct: 0.20, volume: 400_000, timestamp: now() }
```

**OHLCV (4h, 30 bars):**

- 29 bars normal uptrend
- Final bar: gap down to ~85.00 (−13%), closes near lows

**Social/news:**

```ts
news: [
  {
    headline: `${symbol} misses earnings by wide margin, guides lower`,
    sentiment: "bearish",
  },
];
reddit: [
  {
    body: `${symbol} blood bath after earnings, holders not ok`,
    score: 2300,
    sentiment: "bearish",
  },
];
```

**Broker behavior:**

- `placeOrder`: fills at `98.00`
- On next `getOrderStatus` tick: `latestPrice = 85.00`
- `closeOrder`: PnL = `(85.00 - 98.00) / 98.00 * sizeUsd` → large negative

**Expected policy outcome:** Trade opens. First monitor tick detects price vs. stop threshold. `ExitPolicyEvaluator` triggers close. Large negative PnL.

---

### `news_reversal`

**Purpose:** Bullish chart + bearish news. AI reviewer/decision should reject. Tests that news content actually influences the decision.

**Quote / snapshot:**

```ts
{ price: 103.00, bid: 102.85, ask: 103.15, spreadPct: 0.14, volume: 700_000, timestamp: now() }
```

**OHLCV (4h, 30 bars):**

- Clean uptrend (technical analyst would score bullish)

**Social/news:**

```ts
news: [
  {
    headline: `${symbol} under SEC investigation for accounting irregularities`,
    sentiment: "bearish",
  },
  { headline: `${symbol} CFO resigns unexpectedly`, sentiment: "bearish" },
];
reddit: [
  {
    body: `${symbol} chart looks great but the news is catastrophic. Staying away.`,
    score: 890,
    sentiment: "bearish",
  },
];
```

**Broker behavior:** Not reached if AI correctly rejects.

**Expected policy outcome (non-deterministic — AI-dependent):** Decision or reviewer returns `action: "no_trade"`. This scenario is used in model quality evals, not policy gate tests.

---

### `stale_quote`

**Purpose:** Quote timestamp is old. Freshness gate (`data_freshness` in `OrderPolicyGate`, `CV-5` in `CandidateValidationService`) must block the order.

**Quote / snapshot:**

```ts
{
  price: 100.00,
  bid: 99.85,
  ask: 100.15,
  spreadPct: 0.15,
  volume: 500_000,
  timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString()  // 15 min ago
}
```

**OHLCV:** Normal bullish bars (not the blocking factor).

**Social/news:** Bullish (not the blocking factor).

**Broker behavior:** Not reached.

**Expected policy outcome:** `CandidateValidationService` CV-5 fires (swing threshold = 300s; 900s > 300s → rejected). Or `OrderPolicyGate.data_freshness` gate fires if CV-5 is somehow bypassed. Order blocked with reason `"Quote is stale"`.

---

### `wide_spread`

**Purpose:** Bid/ask spread exceeds per-class threshold. `OrderPolicyGate.spread` gate blocks.

**Quote / snapshot:**

```ts
// Stock with 2.5% spread — threshold is 0.5%
{ price: 100.00, bid: 97.50, ask: 102.50, spreadPct: 5.0, volume: 200_000, timestamp: now() }
```

**OHLCV:** Normal (not the blocking factor).

**Social/news:** Bullish (not the blocking factor).

**Broker behavior:** Not reached.

**Expected policy outcome:** `OrderPolicyGate.spread` fires. Order blocked with reason `"Spread too wide"`.

---

### `partial_fill`

**Purpose:** Broker fills only 40–70% of requested size. System records the actual fill, not the requested size.

**Quote / snapshot:**

```ts
{ price: 100.00, bid: 99.90, ask: 100.10, spreadPct: 0.10, volume: 600_000, timestamp: now() }
```

**OHLCV:** Normal bullish.

**Broker behavior:**

```ts
placeOrder: returns {
  brokerOrderId: "mock_partial_xxx",
  filledAvgPrice: 100.00,
  // NOTE: MockBrokerAdapter must track that this was a partial fill
}
// The recorded trade should reflect only the filled USD amount:
// filledSizeUsd = requestedSizeUsd * 0.55  (55% fill)
```

**Implementation note:** `MockBrokerAdapter.placeOrder()` needs an optional `fillPct` override from the scenario. When `scenario.faults?.partialFillPct` is set, `BrokerOrderResult` must include `filledSizeUsd` (new field) = `order.sizeUsd * fillPct`. The orchestrator uses `filledSizeUsd` (not `order.sizeUsd`) when recording the trade.

**Expected policy outcome:** Order opens at partial fill. `position_size_usd` in the trade record = `requestedSizeUsd * 0.55`. Capital reservation adjusted to actual fill.

---

### `broker_reject`

**Purpose:** Broker rejects the order. Capital reservation released. Cycle marked failed (non-retryable).

**Quote / snapshot:**

```ts
{ price: 100.00, bid: 99.90, ask: 100.10, spreadPct: 0.10, volume: 500_000, timestamp: now() }
```

**Broker behavior:**

```ts
placeOrder: throws BrokerError({ code: "ORDER_REJECTED", message: "Insufficient margin" })
```

**Expected policy outcome:** `broker_order` step fails (non-retryable — broker explicitly rejected). Capital reservation for this order released immediately. No trade record created. Session continues to next instrument.

---

### `rate_limit`

**Purpose:** Broker returns 429 on order placement. Step runner marks retryable, schedules backoff.

**Quote / snapshot:** Normal.

**Broker behavior:**

```ts
// First 2 placeOrder calls: throw BrokerError({ code: "RATE_LIMITED", httpStatus: 429 })
// Third call: succeeds normally
```

**Expected policy outcome:** `broker_order` step fails with `retryable: true` on attempt 1 and 2. Backoff fires. Attempt 3 succeeds. Trade opens normally.

---

## 3. `MockBrokerAdapter` Fixes Required

### Fix `closeOrder()` PnL (A2)

**Current** (line 110):

```ts
const realizedPnlUsd = existing
  ? Number((existing.price * 0.002).toFixed(2))
  : 0;
```

**Target:**

```ts
// Track entry price per order (already done in `this.orders` Map as `existing.price`)
// closePrice comes from: scenario progression or current priceFor() at close time
const entryPrice = existing.price;
const closePrice = this.currentPriceFor(existing.order.instrumentSymbol);
const direction = existing.order.side === "BUY" ? 1 : -1;
const pnlPct = (direction * (closePrice - entryPrice)) / entryPrice;
const realizedPnlUsd = Number((pnlPct * existing.order.sizeUsd).toFixed(2));
```

`currentPriceFor()` reads from the active scenario's price progression. In bearish scenarios, `closePrice < entryPrice` → negative PnL.

### Add `timeframe` parameter to `getMockOhlcv()`

```ts
getMockOhlcv(
  symbol: string,
  barCount = 30,
  timeframe: TradingTimeframe = "1d"
): MockOhlcvBar[]
```

Bar spacing:

```ts
const BAR_MS: Record<TradingTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};
```

### Fix `buildSyntheticBars()` drift direction (A4)

**Current** (market-tools.ts — drifts backward/downward):
The `trendStart` is computed as `base * exp(-drift * (barCount - 1))`, so the oldest bar is lowest and recent bars approach `base`. This is correct for uptrend. But if `dailyDrift` is the wrong sign, it goes down.

**Fix:** Ensure `dailyDrift` is always positive in the synthetic fallback (it represents a neutral drift toward spot from below):

```ts
const dailyDrift = Math.abs(0.002); // always up toward spot
const trendStart = base * Math.exp(-dailyDrift * (barCount - 1));
// bar[i].close ≈ trendStart * exp(dailyDrift * i)
// → bar[barCount-1].close ≈ base ✓
```

---

## 4. `market-tools.ts` — Add `timeframe` to `get_ohlcv`

```ts
// Tool input schema addition
{
  name: "get_ohlcv",
  description: "Fetch OHLCV candlestick bars for a symbol",
  input_schema: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      barCount: { type: "number", description: "Number of bars to return (max 200)", default: 30 },
      timeframe: {
        type: "string",
        enum: ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"],
        description: "Bar interval. Default: 1d",
        default: "1d"
      }
    },
    required: ["symbol"]
  }
}
```

Pass `timeframe` through to `MockBrokerAdapter.getMockOhlcv(symbol, barCount, timeframe)`.

---

## 5. Reddit Live Mode Guard (A5)

```ts
// search-reddit-tool.ts — top of the handler

if (!deps.mockPosts && !deps.redditOAuthToken) {
  return {
    error:
      "Reddit search is not available in live mode without OAuth authentication. Configure a Reddit OAuth token or disable the Reddit tool.",
    posts: [],
  };
}
```

The `deps.redditOAuthToken` field does not exist yet — it must be added to the tool's dependency injection. For now, the guard condition is: no mock posts AND no auth token → return error object instead of attempting the unauthenticated fetch.

---

## 6. `MockScenarioFixtures` — Social/News Data

```ts
// electron/main/services/broker/mock/mock-scenario-fixtures.ts

export const SCENARIO_NEWS: Record<MockScenarioKind, NewsItem[]> = {
  clean_breakout: [
    {
      headline: "{symbol} reports earnings beat, raises guidance",
      sentiment: "bullish",
    },
    {
      headline: "{symbol} breaks multi-week resistance on volume",
      sentiment: "bullish",
    },
  ],
  failed_breakout: [
    { headline: "{symbol} faces regulatory headwinds", sentiment: "bearish" },
  ],
  sideways_chop: [
    {
      headline: "{symbol} reports in-line quarter, no surprises",
      sentiment: "neutral",
    },
  ],
  gap_down_after_entry: [
    {
      headline: "{symbol} misses earnings by wide margin, guides lower",
      sentiment: "bearish",
    },
  ],
  news_reversal: [
    {
      headline:
        "{symbol} under SEC investigation for accounting irregularities",
      sentiment: "bearish",
    },
    { headline: "{symbol} CFO resigns unexpectedly", sentiment: "bearish" },
  ],
  stale_quote: [], // news not relevant — freshness gate fires first
  wide_spread: [], // news not relevant — spread gate fires first
  partial_fill: [
    { headline: "{symbol} shows steady momentum", sentiment: "bullish" },
  ],
  broker_reject: [
    { headline: "{symbol} bouncing off support", sentiment: "bullish" },
  ],
  rate_limit: [{ headline: "{symbol} trending higher", sentiment: "bullish" }],
};

export const SCENARIO_REDDIT: Record<MockScenarioKind, RedditPost[]> = {
  clean_breakout: [
    {
      body: "${{symbol}} breakout confirmed, volume is there",
      score: 420,
      sentiment: "bullish",
    },
  ],
  failed_breakout: [
    {
      body: "{{symbol}} failed breakout, looks like distribution",
      score: 180,
      sentiment: "bearish",
    },
  ],
  sideways_chop: [
    {
      body: "{{symbol}} going sideways, nothing to do here",
      score: 55,
      sentiment: "neutral",
    },
  ],
  gap_down_after_entry: [
    {
      body: "{{symbol}} after-hours collapse, down 13%",
      score: 2300,
      sentiment: "bearish",
    },
  ],
  news_reversal: [
    {
      body: "{{symbol}} chart looks great but the news is catastrophic",
      score: 890,
      sentiment: "bearish",
    },
  ],
  stale_quote: [],
  wide_spread: [],
  partial_fill: [
    { body: "{{symbol}} momentum play", score: 200, sentiment: "bullish" },
  ],
  broker_reject: [
    { body: "{{symbol}} dip buy setup", score: 150, sentiment: "bullish" },
  ],
  rate_limit: [
    {
      body: "{{symbol}} consolidating nicely",
      score: 300,
      sentiment: "bullish",
    },
  ],
};

export const SCENARIO_TRENDING: Record<MockScenarioKind, string[]> = {
  clean_breakout: ["SYMBOL"],
  failed_breakout: [], // not trending during reversal
  sideways_chop: [],
  gap_down_after_entry: [],
  news_reversal: ["SYMBOL"], // trending for wrong reasons
  stale_quote: [],
  wide_spread: [],
  partial_fill: ["SYMBOL"],
  broker_reject: [],
  rate_limit: ["SYMBOL"],
};
```

`{symbol}` and `{{symbol}}` are replaced with the actual instrument symbol at fixture generation time.

---

## 7. Fault Injection Types

```ts
// electron/main/services/broker/mock/mock-execution-faults.ts

export interface MockFaultConfig {
  partialFillPct?: number; // 0.0–1.0; if set, placeOrder returns partial fill
  rejectOrderWithCode?: string; // if set, placeOrder throws BrokerError with this code
  timeoutMs?: number; // if set, placeOrder delays for this many ms before resolving
  staleQuoteAgeMs?: number; // if set, getMarketSnapshot returns timestamp this old
  rateLimitOnAttempts?: number[]; // placeOrder throws 429 on these attempt numbers (1-indexed)
}
```

`MockBrokerAdapter` constructor accepts an optional `faults?: MockFaultConfig`. The scenario runner sets faults per `MockScenarioKind`.

---

## 8. Acceptance Tests

```
describe("MockBrokerAdapter")
  ✓ closeOrder() with bearish scenario → realizedPnlUsd < 0
  ✓ closeOrder() with bullish scenario → realizedPnlUsd > 0
  ✓ getMockOhlcv(symbol, 30, "4h") → bars spaced 4h apart
  ✓ getMockOhlcv(symbol, 30, "1d") → bars spaced 24h apart
  ✓ placeOrder() with partialFillPct=0.5 → filledSizeUsd = requestedSizeUsd * 0.5
  ✓ placeOrder() with rejectOrderWithCode → throws BrokerError
  ✓ getMarketSnapshot() with staleQuoteAgeMs=900_000 → timestamp is 15min old

describe("buildSyntheticBars")
  ✓ first bar close < last bar close (upward drift)
  ✓ last bar close ≈ spot price (within 1%)

describe("CandidateValidationService + stale_quote scenario")
  ✓ quote age = 15min, holdingStyle=multi_day_swing → CV-5 fails, allowed=false

describe("OrderPolicyGate + wide_spread scenario")
  ✓ spreadPct=5.0, class=stock → spread gate fails

describe("mock scenario suite — no crashes")
  ✓ all 10 MockScenarioKind values run a full cycle without throwing unhandled exceptions
  ✓ failed_breakout produces a trade with negative realizedPnlUsd
  ✓ broker_reject produces no trade record
  ✓ partial_fill produces trade with position_size_usd < requested sizeUsd
  ✓ rate_limit retries twice then succeeds on attempt 3
```

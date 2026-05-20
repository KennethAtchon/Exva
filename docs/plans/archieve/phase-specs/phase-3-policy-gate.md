# Phase 3 Spec — Deterministic Policy Gate

> **Status:** Not started
> **Files to create:**
>
> - `electron/main/services/orchestration/order-policy-gate.ts`
> - `electron/main/services/orchestration/candidate-validation-service.ts`
>   **Files to modify:**
> - `electron/main/services/risk/risk-engine.ts` (expand `DecisionRiskInput`)
> - `electron/main/services/broker/adapters/broker-adapter.ts` (expand `MarketSnapshot`, `BrokerOrder`)
> - `electron/main/services/orchestration/agent-orchestrator.ts` (wire gates + fix side-default bug)
> - `electron/main/db/` (add `expiresAt` to `instrument_cache`)

---

## Goal

AI decisions never directly create orders. Every order must pass a chain of deterministic checks — strategy compliance, data freshness, price collar, spread, capital, market hours, idempotency, exit contract — before touching the broker. These checks run even when `humanApprovalRequired: false`.

---

## 1. Type Expansions

### `MarketSnapshot` — add market quality fields

```ts
// electron/main/services/broker/adapters/broker-adapter.ts

export interface MarketSnapshot {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  price: number;
  bid?: number; // ADD
  ask?: number; // ADD
  spreadPct?: number; // ADD — (ask - bid) / mid * 100; null if no bid/ask
  volume?: number; // ADD — shares/contracts in last bar; null if unavailable
  timestamp: string;
}
```

### `BrokerOrder` — add client order ID

```ts
export interface BrokerOrder {
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: PredictionOutcome | null;
  instrumentMetadataJson?: string | null;
  instrumentType: InstrumentClass;
  side: "BUY" | "SELL";
  sizeUsd: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  clientOrderId: string; // ADD — format: `${cycleId}:${tradeId}`
}
```

### `DecisionRiskInput` — add pre-order context

```ts
// electron/main/services/risk/risk-engine.ts

export interface DecisionRiskInput {
  config: SessionConfig;
  stats: DashboardStats;
  order: OrderRequest;
  confidence: number;
  riskPolicy?: {
    waitForOpenThreshold: number;
    maxExposureUsd: number | null;
  };
  maxExposureUsd?: number | null;

  // ADD — required for policy gate checks
  quoteSnapshot: {
    price: number;
    bid?: number;
    ask?: number;
    spreadPct?: number;
    volume?: number;
    timestamp: string; // ISO-8601
  };
  side: "BUY" | "SELL";
  exitPolicy: {
    stopLossPct?: number | null;
    atrStopMultiplier?: number | null;
    takeProfitPct?: number | null;
    maxHoldDays?: number | null;
  };
  totalBrokerExposureUsd?: number; // sum of open position sizes on the same broker account
  strategyRules: {
    sideBias: StrategySideBias;
  };
  sessionMode: "paper" | "live";
  brokerSupportsClass: boolean; // pre-resolved by broker routing service
  marketIsOpen: boolean; // pre-resolved by MarketHoursService
}
```

---

## 2. `CandidateValidationService`

Called in `AgentOrchestrator.runTradeCycle()` after `validateSelectorOutput()` and **before** `runAiPipeline()`.

```ts
// electron/main/services/orchestration/candidate-validation-service.ts

export interface CandidateValidationInput {
  sessionId: string;
  cycleId: string;
  instrument: ResolvedInstrument;
  strategy: SessionStrategyContext;
  selectorTrace: ToolStepTrace[];
  quoteSnapshot: MarketSnapshot;
  now: string; // ISO-8601; injectable for tests
}

export interface CandidateEvidenceEntry {
  source: "get_news" | "search_web" | "get_quote" | "fetch_url";
  symbolMatched: boolean; // true if the ticker appears in args or returned text
  publishedAt?: string;
}

export interface CandidateValidationResult {
  allowed: boolean;
  reasons: string[]; // human-readable rejection reasons; empty if allowed
  evidence: CandidateEvidenceEntry[];
  quoteSnapshot: MarketSnapshot;
}

export class CandidateValidationService {
  validate(input: CandidateValidationInput): CandidateValidationResult;
}
```

### Validation rules (in order; first failure sets `allowed: false`)

| #     | Rule                              | Pass condition                                                                                                                                                             |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CV-1  | Symbol present                    | `instrument.symbol` is non-empty string                                                                                                                                    |
| CV-2  | Class enabled                     | `instrument.instrumentClass` is in the session's enabled instrument classes                                                                                                |
| CV-3  | Broker route available            | A registered broker account supports `instrument.instrumentClass`                                                                                                          |
| CV-4  | Quote success                     | `quoteSnapshot.price > 0` and no error                                                                                                                                     |
| CV-5  | Quote freshness                   | `Date.now() - new Date(quoteSnapshot.timestamp).getTime() < maxQuoteAgeMs(class, timeframe)`                                                                               |
| CV-6  | Symbol-specific evidence          | At least one trace entry satisfies: `source === "get_news" && args.symbol === instrument.symbol`, OR `source === "search_web" && returnedText.includes(instrument.symbol)` |
| CV-7  | Rationale non-empty               | `instrument.selectorResearchBrief` is non-null and non-empty                                                                                                               |
| CV-8  | Liquidity (when volume available) | `quoteSnapshot.volume > minVolume(class)` — skip if `volume` is null                                                                                                       |
| CV-9  | Spread (when bid/ask available)   | `quoteSnapshot.spreadPct < maxSpread(class)` — skip if `spreadPct` is null                                                                                                 |
| CV-10 | Strategy compatibility            | Rationale text does not contain words indicating the opposite of `sideBias` (e.g. "short" for `long_only`)                                                                 |

### `maxQuoteAgeMs` per class/timeframe

```ts
const MAX_QUOTE_AGE_MS: Record<
  InstrumentClass,
  Record<"intraday" | "swing" | "position", number>
> = {
  stock: { intraday: 30_000, swing: 300_000, position: 600_000 },
  crypto: { intraday: 15_000, swing: 120_000, position: 300_000 },
  futures: { intraday: 15_000, swing: 120_000, position: 300_000 },
  prediction_market: { intraday: 300_000, swing: 600_000, position: 3_600_000 },
};

function maxQuoteAgeMs(
  cls: InstrumentClass,
  holdingStyle: HoldingStyle,
): number {
  const bucket =
    holdingStyle === "intraday_flat"
      ? "intraday"
      : holdingStyle === "multi_day_swing"
        ? "swing"
        : "position";
  return MAX_QUOTE_AGE_MS[cls][bucket];
}
```

### `minVolume` and `maxSpread` per class

```ts
// Default thresholds — override via session config in the future
const MIN_VOLUME: Partial<Record<InstrumentClass, number>> = {
  stock: 50_000, // shares in last bar
  crypto: 10_000, // USD notional equivalent
  futures: 500, // contracts
  // prediction_market: not enforced (volume semantics differ)
};

const MAX_SPREAD_PCT: Partial<Record<InstrumentClass, number>> = {
  stock: 0.5,
  crypto: 1.0,
  futures: 0.3,
  // prediction_market: not enforced
};
```

---

## 3. `OrderPolicyGate`

Called immediately before `placeRoutedOrder()` in `AgentOrchestrator.runTradeCycle()`.

```ts
// electron/main/services/orchestration/order-policy-gate.ts

export interface PolicyGateInput {
  sessionId: string;
  cycleId: string;
  tradeId: string;
  decisionRiskInput: DecisionRiskInput;
  brokerAccountId: string;
  existingOrderCheck: (
    clientOrderId: string,
    brokerAccountId: string,
  ) => boolean;
  sessionIsPaused: () => boolean;
}

export interface PolicyGateResult {
  allowed: boolean;
  reason?: string;
  gatesFailed: PolicyGateName[];
}

export type PolicyGateName =
  | "runtime"
  | "strategy"
  | "data_freshness"
  | "price_collar"
  | "spread"
  | "capital"
  | "broker"
  | "idempotency"
  | "exit_contract";

export class OrderPolicyGate {
  evaluate(input: PolicyGateInput): PolicyGateResult;
}
```

### Gate definitions

#### `runtime`

```
FAIL if: sessionIsPaused() === true
Reason: "Session is paused"
```

#### `strategy`

```
FAIL if: sideBias === "long_only" && side === "SELL"
FAIL if: sideBias === "short_only" && side === "BUY"
Reason: "Order side contradicts strategy sideBias"
```

#### `data_freshness`

```
FAIL if: Date.now() - new Date(quoteSnapshot.timestamp).getTime() > maxQuoteAgeMs(class, holdingStyle)
Reason: "Quote is stale (age: Xs, max: Ys)"
```

#### `price_collar`

```
// expected fill = quoteSnapshot.price (last known)
collar = PRICE_COLLAR_PCT[instrumentType]  // see table below
FAIL if: Math.abs(order.sizeUsd / expectedShares - quoteSnapshot.price) / quoteSnapshot.price > collar
Note: for USD-sized orders, this simplifies to checking that the quote price hasn't gapped
      by more than `collar` since the snapshot was taken.
Reason: "Expected fill exceeds price collar (±N%)"
```

**Price collar defaults:**

| Class               | `collar`   |
| ------------------- | ---------- |
| `stock`             | 0.02 (±2%) |
| `crypto`            | 0.03 (±3%) |
| `futures`           | 0.01 (±1%) |
| `prediction_market` | 0.05 (±5%) |

#### `spread`

```
FAIL if: spreadPct != null && spreadPct > MAX_SPREAD_PCT[instrumentType]
Reason: "Spread too wide (Xbps, max Ybps)"
Skip: if quoteSnapshot.spreadPct is null
```

#### `capital`

```
// Three sub-checks — any failure blocks:
1. Session cap: order.sizeUsd <= config.max_position_usd
2. Global pool: currentGlobalReservedUsd + order.sizeUsd <= globalPoolLimitUsd
3. Broker exposure: totalBrokerExposureUsd + order.sizeUsd <= maxBrokerExposureUsd (if configured)
Reason: "Capital limit exceeded: [session|global|broker]"
```

#### `broker`

```
FAIL if: !brokerSupportsClass
FAIL if: !marketIsOpen  (checked here as the final just-in-time guard)
Reason: "Broker does not support instrument class" | "Market is closed"
```

#### `idempotency`

```
clientOrderId = `${cycleId}:${tradeId}`
FAIL if: existingOrderCheck(clientOrderId, brokerAccountId) === true
Reason: "Duplicate order: clientOrderId already exists"
```

#### `exit_contract`

```
FAIL if:
  exitPolicy.stopLossPct == null &&
  exitPolicy.atrStopMultiplier == null &&
  exitPolicy.takeProfitPct == null &&
  exitPolicy.maxHoldDays == null
Reason: "No enforceable exit policy — configure stopLoss, takeProfit, or maxHoldDays"
```

---

## 4. Side Bias Enforcement Fix

In `agent-orchestrator.ts` around line 758, the current code:

```ts
side: decision.side ?? "BUY";
```

**Must become:**

```ts
if (!decision.side) {
  if (strategy.rules.sideBias !== "both" && strategy.rules.sideBias !== "n_a") {
    throw new AppError(
      `Decision missing side field; cannot default with sideBias=${strategy.rules.sideBias}`,
      "VALIDATION_FAILED",
    );
  }
  // only default when bias doesn't constrain direction
}
const side = decision.side ?? "BUY";
```

The `OrderPolicyGate.strategy` gate is the second layer of enforcement after this early check.

---

## 5. Instrument Cache TTL

```sql
-- Migration: add expiresAt to instrument_cache
ALTER TABLE instrument_cache ADD COLUMN expires_at TEXT;
```

**Invalidation logic in `AgentOrchestrator`:**

```ts
const cache = this.deps.instrumentCacheRepo.get(sessionId);
if (cache) {
  const expired = cache.expiresAt && new Date(cache.expiresAt) < new Date();
  if (expired) {
    this.deps.instrumentCacheRepo.clear(sessionId);
  }
}
```

**TTL calculation:**

```ts
function instrumentCacheTtlMs(holdingStyle: HoldingStyle): number {
  switch (holdingStyle) {
    case "intraday_flat":
      return 30 * 60 * 1000; // 30 min
    case "multi_day_swing":
      return 4 * 60 * 60 * 1000; // 4h
    case "weeks_position":
      return 24 * 60 * 60 * 1000; // 24h
    case "custom":
      return 4 * 60 * 60 * 1000; // 4h default
  }
}
```

Cache is also cleared unconditionally on session resume (already should happen via `definitionHash` change; ensure this is not bypassed).

---

## 6. Order Flow in `AgentOrchestrator.runTradeCycle()` — Target Call Sequence

```
1. validateSelectorOutput(instrument)          — existing
2. CandidateValidationService.validate()       — NEW (Phase 3)
   └─ if !result.allowed → log + skip instrument (non-retryable step fail)
3. runAiPipeline(technical, fundamental, reviewer, decision)
4. validateStrategyCompliance(decision, rules) — NEW (side bias early check)
5. RiskEngine.validateDecision(decisionRiskInput)
6. OrderPolicyGate.evaluate(policyGateInput)   — NEW
   └─ if !result.allowed → log + skip (non-retryable step fail)
7. capitalReservation.reserve(order)           — moved here from approval branch (Phase 4)
8. MarketHoursService.isTradable(instrument)   — final just-in-time check
9. placeRoutedOrder(order)
```

Steps 6 and 8 may seem redundant (market hours). Step 8 is the last-chance check immediately before the broker call; step 6 uses the pre-resolved `marketIsOpen` value that was fetched earlier in the cycle. Both stay because the gap between resolution and order can span several seconds of AI pipeline execution.

---

## 7. Acceptance Tests

```
describe("CandidateValidationService")
  ✓ missing rationale → allowed=false, reasons includes "rationale"
  ✓ stale quote (age > maxQuoteAgeMs) → allowed=false
  ✓ only generic search_web (no symbol in returned text) → allowed=false (CV-6)
  ✓ get_news with matching symbol → allowed=true (CV-6 passes)
  ✓ low volume below threshold → allowed=false (CV-8)
  ✓ high spread above threshold → allowed=false (CV-9)
  ✓ prediction_market class skips volume+spread checks
  ✓ all rules pass → allowed=true, evidence array populated

describe("OrderPolicyGate")
  ✓ sessionIsPaused → runtime gate fails
  ✓ side=SELL, sideBias=long_only → strategy gate fails
  ✓ stale quote → data_freshness gate fails
  ✓ spreadPct=1.5, class=stock → spread gate fails
  ✓ order.sizeUsd > pool remaining → capital gate fails
  ✓ marketIsOpen=false → broker gate fails
  ✓ existing order with same clientOrderId → idempotency gate fails
  ✓ all exitPolicy fields null → exit_contract gate fails
  ✓ all gates pass → allowed=true, gatesFailed=[]

describe("DecisionRiskInput side default")
  ✓ decision.side missing + sideBias=long_only → throws VALIDATION_FAILED
  ✓ decision.side missing + sideBias=both → defaults to BUY
  ✓ decision.side=SELL + sideBias=long_only → policy gate blocks at strategy check
```

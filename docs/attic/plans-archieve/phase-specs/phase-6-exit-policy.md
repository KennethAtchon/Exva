# Phase 6 Spec — Exit Policy Enforcement

> **Status:** Not started — depends on Phase 5 (needs `MarketSnapshot.bid/ask`, `getMockOhlcv(timeframe)`)
> **Files to create:**
>
> - `electron/main/services/risk/exit-policy-evaluator.ts`
>   **Files to modify:**
> - `electron/main/services/orchestration/trade-monitor.ts` (wire evaluator into `tick()`)
> - `electron/main/db/repositories/trades-repo.ts` (add `highWaterMark` field)
> - `electron/main/db/` (migration: add `high_water_mark_price` to `trades` table)

---

## Goal

`moderate` preset configures `stopLossType: "trailing_atr"` and `atrStopMultiplier: 2`. Currently, `TradeMonitor.tick()` only checks `maxHoldDays` and prediction-market resolution. Stop-loss and take-profit never fire. Fix: add `ExitPolicyEvaluator` called on every monitor tick for every open trade.

---

## 1. DB Schema Change

```sql
-- Migration: add high-water-mark tracking to trades
ALTER TABLE trades ADD COLUMN high_water_mark_price REAL;
-- Nullable. Set to filledAvgPrice on trade open. Updated each tick when price > current value.
```

Update `TradesRepo` to expose:

```ts
updateHighWaterMark(tradeId: string, price: number): void;
// UPDATE trades SET high_water_mark_price = ? WHERE id = ? AND (high_water_mark_price IS NULL OR high_water_mark_price < ?)
```

---

## 2. `ExitPolicyEvaluator` Interface

```ts
// electron/main/services/risk/exit-policy-evaluator.ts

export type ExitReason =
  | "stop_loss_fixed"
  | "stop_loss_trailing_atr"
  | "take_profit"
  | "max_hold_days" // handled by TradeMonitor.enforceMaxHoldDays — not this evaluator
  | "event_resolution"; // handled by TradeMonitor.enforcePredictionMarketPolicy — not this evaluator

export interface ExitDecision {
  shouldExit: boolean;
  reason?: ExitReason;
  triggerPrice?: number;
}

export interface ExitPolicyInput {
  trade: {
    id: string;
    entryPrice: number; // filledAvgPrice
    side: "BUY" | "SELL";
    instrumentType: InstrumentClass;
    highWaterMarkPrice: number | null;
    openedAt: string; // ISO-8601
  };
  currentPrice: number;
  ohlcvBars: MockOhlcvBar[]; // recent bars used to compute ATR; min 14 bars required
  riskConfig: {
    stopLossType: StopLossType;
    stopLossPct: number | null;
    atrStopMultiplier: number | null;
    takeProfitPct: number | null;
  };
  now: string; // ISO-8601; injectable for tests
}

export class ExitPolicyEvaluator {
  evaluate(input: ExitPolicyInput): ExitDecision;
}
```

---

## 3. `fixed_pct` Logic

```ts
// For long (BUY):
const stopPrice = entryPrice * (1 - (stopLossPct / 100));
if (currentPrice <= stopPrice) → exit, reason: "stop_loss_fixed"

// For short (SELL):
const stopPrice = entryPrice * (1 + (stopLossPct / 100));
if (currentPrice >= stopPrice) → exit, reason: "stop_loss_fixed"

// Take profit (long):
if (takeProfitPct != null) {
  const tpPrice = entryPrice * (1 + (takeProfitPct / 100));
  if (currentPrice >= tpPrice) → exit, reason: "take_profit"
}

// Take profit (short):
if (takeProfitPct != null) {
  const tpPrice = entryPrice * (1 - (takeProfitPct / 100));
  if (currentPrice <= tpPrice) → exit, reason: "take_profit"
}
```

Check take-profit before stop-loss (more favorable exit takes priority if both trigger simultaneously).

---

## 4. `trailing_atr` Logic

### ATR Calculation (Wilder's, 14-period)

```ts
function computeATR(bars: MockOhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const recent = bars.slice(-(period + 1));

  // True range for each bar
  const trueRanges = recent.slice(1).map((bar, i) => {
    const prevClose = recent[i].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose),
    );
  });

  // Initial ATR = simple average of first `period` true ranges
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder smoothing for remaining bars (if any)
  for (const tr of trueRanges.slice(period)) {
    atr = (atr * (period - 1) + tr) / period;
  }

  return atr;
}
```

### Trailing Stop Logic (long)

```ts
const atr = computeATR(ohlcvBars);
if (atr == null) return { shouldExit: false }; // not enough bars, skip

// Update high-water-mark (caller does the DB write after evaluate())
const newHwm = Math.max(highWaterMarkPrice ?? entryPrice, currentPrice);

const trailStop = newHwm - (atrStopMultiplier * atr);
if (currentPrice <= trailStop) → exit, reason: "stop_loss_trailing_atr", triggerPrice: trailStop
```

### Trailing Stop Logic (short)

```ts
const newLwm = Math.min(highWaterMarkPrice ?? entryPrice, currentPrice); // low-water-mark for shorts
const trailStop = newLwm + (atrStopMultiplier * atr);
if (currentPrice >= trailStop) → exit, reason: "stop_loss_trailing_atr", triggerPrice: trailStop
```

---

## 5. `stopLossType: "none"` Behavior

```ts
if (riskConfig.stopLossType === "none") {
  // Only check take-profit; skip all stop-loss evaluation
}
```

`"broker_native_trailing"` — evaluator does nothing (broker handles it natively). Log a debug message that the trailing logic is broker-managed.

---

## 6. `TradeMonitor.tick()` Integration

```ts
// After enforceMaxHoldDays() and enforcePredictionMarketPolicy():

const remainingOpenTrades = this.tradesRepo
  .listOpenAndPending(this.sessionId)
  .filter((trade) => trade.status === "open");

for (const trade of remainingOpenTrades) {
  if (!trade.broker_order_id || !trade.brokerAccountId) continue;

  const adapter = await this.brokerRegistry.get(trade.brokerAccountId);
  const snapshot = await adapter.getMarketSnapshot(trade.instrumentSymbol);
  const currentPrice = snapshot.price;

  // Update high-water-mark
  this.tradesRepo.updateHighWaterMark(trade.id, currentPrice);

  // Fetch recent OHLCV for ATR
  const bars = (await adapter.getMockOhlcv?.(trade.instrumentSymbol, 20)) ?? [];

  const exitDecision = this.exitPolicyEvaluator.evaluate({
    trade: {
      id: trade.id,
      entryPrice: trade.filled_avg_price ?? trade.position_size_usd, // use filled price
      side: trade.side as "BUY" | "SELL",
      instrumentType: trade.instrumentType as InstrumentClass,
      highWaterMarkPrice: trade.high_water_mark_price ?? null,
      openedAt: trade.opened_at ?? trade.created_at,
    },
    currentPrice,
    ohlcvBars: bars,
    riskConfig: strategyContext.riskConfig,
    now: new Date().toISOString(),
  });

  if (exitDecision.shouldExit) {
    await this.closeTradeAtBroker(trade);
    // Persist exit reason — see Section 7
    continue;
  }

  // Existing broker status check (keeps polling for externally-closed orders)
  const status = await adapter.getOrderStatus(trade.broker_order_id);
  if (status.status === "closed") {
    this.closeTrade(trade.id, status.realizedPnlUsd ?? 0);
  }
}
```

**Important:** `getMockOhlcv` is only on `MockBrokerAdapter`. For live adapters, OHLCV must come through a different path (market data service). For now, cast to `MockBrokerAdapter` in paper mode or skip ATR computation if bars are unavailable — log a warning and fall back to `fixed_pct` only.

---

## 7. Persist Exit Reason

Add `exit_reason` column to the `trades` table:

```sql
ALTER TABLE trades ADD COLUMN exit_reason TEXT;
-- Values: stop_loss_fixed | stop_loss_trailing_atr | take_profit | max_hold_days | event_resolution | broker_closed | manual
```

Update `closeTrade()` in `TradeMonitor` to accept an optional `exitReason: ExitReason` and write it to the trade record:

```ts
private closeTrade(tradeId: string, pnl: number, exitReason?: ExitReason) {
  const closed = this.tradesRepo.updateStatus(tradeId, "closed", pnl, exitReason);
  this.capitalReservation.releaseOnClose(tradeId);
  this.eventBus.emit("trade_closed", closed);
  return closed;
}
```

---

## 8. Prediction Market Exclusion

`ExitPolicyEvaluator` must skip exit evaluation for `instrumentType === "prediction_market"`. These are handled by `enforcePredictionMarketPolicy` which has its own resolution logic.

```ts
if (input.trade.instrumentType === "prediction_market") {
  return { shouldExit: false };
}
```

---

## 9. Acceptance Tests

```
describe("ExitPolicyEvaluator — fixed_pct")
  ✓ long trade, stopLossPct=5, currentPrice = entryPrice * 0.94 → shouldExit=true, reason=stop_loss_fixed
  ✓ long trade, stopLossPct=5, currentPrice = entryPrice * 0.96 → shouldExit=false
  ✓ long trade, takeProfitPct=10, currentPrice = entryPrice * 1.11 → shouldExit=true, reason=take_profit
  ✓ take_profit checked before stop_loss when both trigger
  ✓ short trade, stopLossPct=5, currentPrice = entryPrice * 1.06 → shouldExit=true

describe("ExitPolicyEvaluator — trailing_atr")
  ✓ fewer than 15 bars → shouldExit=false (not enough data)
  ✓ price rises to new HWM → trail moves up; no exit
  ✓ price drops below (HWM - atrStopMultiplier * ATR) → shouldExit=true, reason=stop_loss_trailing_atr
  ✓ price drops but stays above trail → shouldExit=false
  ✓ prediction_market instrumentType → shouldExit=false always

describe("ExitPolicyEvaluator — stopLossType=none")
  ✓ no stop-loss check runs; take-profit still checked if configured

describe("TradeMonitor.tick() with ExitPolicyEvaluator")
  ✓ fixed_pct stop triggered → closeTradeAtBroker called, exit_reason=stop_loss_fixed persisted
  ✓ trailing_atr stop triggered → closeTradeAtBroker called, exit_reason=stop_loss_trailing_atr
  ✓ take-profit triggered → closeTradeAtBroker called, exit_reason=take_profit
  ✓ no exit condition met → trade remains open
  ✓ high_water_mark_price updated each tick when price rises
```

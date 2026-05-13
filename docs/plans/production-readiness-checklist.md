# Exva Agent Execution — Production Readiness Checklist

> **Generated:** 2026-05-12
> **Source:** `agent-execution-production-readiness-deep-plan.md`
> **Owner:** Kenneth Atchon

---

## Phase 0 — Immediate Fixes (ship now)

### C1 · Selector Parser (Done)
- [x] Three-level fallback in `instrument-selection-parser.ts`: `resultJson` → `argsJson` → `assistantText`
- [x] Regression test: `null` tool result with valid `argsJson` parses correctly
- [x] Regression test: malformed JSON at all levels fails closed with `VALIDATION_FAILED`
- [x] Regression test: `assistantText` fallback fires when no `submit_candidates` call exists in trace

### M9 · No-Instrument Retry Timer/Message Mismatch
- [ ] Replace `NO_INSTRUMENT_RETRY_MS = 3 * 60 * 1000` (line 51 `agent-orchestrator.ts`) with a resolved user-configurable value
- [ ] Default the interval to `5 * 60 * 1000` (5 min)
- [ ] Persist the configured value in session/runtime config
- [ ] Fix line 833: message reads `"Re-evaluating in 30 minutes"` — replace with the resolved interval value (e.g. `"Re-evaluating in 5 minutes"`)
- [ ] Both the `setTimeout` at line 865 and the emitted message use the same single resolved variable
- [ ] Test: custom value is read from config, used by timer, and reflected in the message string
- [ ] Test: missing/invalid config falls back to 5-minute default
- [ ] Decide and document allowed range for the setting (suggested: 1–60 min) (Q5)

---

## Phase 1 — Failure-Isolated Step Runner

### Schema
- [ ] New table `session_execution_steps`: columns `id`, `sessionId`, `cycleId`, `stage`, `status`, `attempt`, `startedAt`, `completedAt`, `nextRetryAt`, `lastErrorCode`, `lastErrorMessage`, `retryable`
- [ ] Migration script + rollback script
- [ ] Repo class `SessionExecutionStepsRepo` with `upsert`, `getLatestByCycle`, `getLatestBySession`, `clearFailed`

### `ExecutionStepRunner` service (`electron/main/services/orchestration/execution-step-runner.ts`)
- [ ] Wraps each named stage: `selector`, `candidate_validation`, `analyst_technical`, `analyst_fundamental`, `reviewer`, `decision_maker`, `risk_gate`, `broker_order`, `monitoring`
- [ ] On stage start: write `running` to `session_execution_steps`, emit `step:started` event
- [ ] On stage success: write `succeeded`, emit `step:succeeded`
- [ ] On stage failure: classify error → `retryable` (provider/broker transient) vs. `non-retryable` (validation/policy/config)
- [ ] Retryable: write `retrying`, schedule exponential backoff (30s / 90s / 270s), max 3 attempts
- [ ] Non-retryable: write `failed`, set session to `attention_required` (not `error`/`crashed`)
- [ ] Fatal safety condition: stop new orders, keep monitor alive, preserve open-position monitoring
- [ ] Never rethrow across stage boundary — previous stage failure must not kill later independent stages

### Refactor `AgentOrchestrator`
- [ ] Replace broad rethrow in `start()` with per-stage step runner wrapping
- [ ] Selector failure marks `selector` stage failed — runtime stays alive for retry
- [ ] Errors in `enqueueTradeCycles()` mark that cycle's stage failed — session keeps running for future cycles
- [ ] Open-trade monitoring loop (`TradeMonitor`) continues even when a research cycle fails mid-stage
- [ ] `stop()` only stops new orders by default; does not silently kill monitor (see H8)

### IPC Actions
- [ ] `session:getExecutionProgress` — returns latest step state per session (cheap query from `session_execution_steps`)
- [ ] `session:retryStep` — retries the named stage for a given `sessionId/cycleId`
- [ ] `session:pauseAfterCurrentStep` — sets a flag; orchestrator drains current step then pauses
- [ ] `session:clearFailedStep` — clears failed state to allow cycle restart

### Tests
- [ ] Selector provider error → only `selector` stage fails; session status stays recoverable
- [ ] User calls `session:retryStep` → stage re-runs from clean state
- [ ] Open trade monitor continues through a failing new-cycle research attempt
- [ ] Non-retryable validation failure → `attention_required`, no retry loop
- [ ] Retryable error exhausts 3 attempts → final `failed` state, no infinite loop

---

## Phase 2 — Session Card Progress UI

### `SessionExecutionProgress` component (`src/components/sessions/SessionExecutionProgress.tsx`)
- [ ] Stage progress bar: 9 stages mapped to percent (selector=10 … monitoring=100)
- [ ] Active AI role chip showing current role + model name (e.g. `technical analyst · claude-haiku-4-5`)
- [ ] Cycle ID short code (`cycleId.slice(0, 8)`) linking to DevPanel trace
- [ ] Last step status label: `running` / `retrying in Xs` / `failed` / `waiting for broker` / `monitoring open trade`
- [ ] Retry button: visible only on retryable failed stage; calls `session:retryStep` IPC
- [ ] Pause-after-step toggle: calls `session:pauseAfterCurrentStep` IPC
- [ ] View Trace button: opens DevPanel filtered to `sessionId/cycleId/stage`
- [ ] Component renders nothing (or collapsed state) when session has no active cycle

### Wire into `SessionTable.tsx`
- [ ] Insert `SessionExecutionProgress` between top row and meta strip
- [ ] Subscribe Sessions page/store to `step:started`, `step:succeeded`, `step:failed` events keyed by `sessionId + cycleId`
- [ ] Retrying countdown ticks from `nextRetryAt` in real-time (no full refetch per tick)
- [ ] Visual language matches existing industrial dark Exva cards — no playful wizard UI

### Decide
- [ ] Show all historical stages or only current/latest cycle in the card? (Q7)

### Tests
- [ ] Card renders `Finding instruments` during selector stage
- [ ] Card renders `Retrying selector in 42s` on retryable failure
- [ ] Card renders `Risk checks` during risk gate
- [ ] Card renders `Monitoring position` when trade is open
- [ ] Failed stage shows Retry and View Trace actions visibly

---

## Phase 3 — Deterministic Policy Gate

### Expand `DecisionRiskInput` (`risk-engine.ts`)
- [ ] Add `quoteTimestamp: string`
- [ ] Add `bid?: number`, `ask?: number`, `spreadPct?: number`
- [ ] Add `slippageEstimatePct?: number`
- [ ] Add `side: "BUY" | "SELL"`
- [ ] Add `exitPolicy: { stopLossPct?: number; atrStopMultiplier?: number; takeProfitPct?: number; maxHoldDays?: number }`
- [ ] Add `totalBrokerExposureUsd?: number` for per-broker cap check

### `OrderPolicyGate` service (`electron/main/services/orchestration/order-policy-gate.ts`)
- [ ] **Runtime gate**: session status is still `active`; no stop/pause requested
- [ ] **Strategy gate**: decision `side` matches `strategy.rules.sideBias`; setup type matches allowed decision metadata (H1)
- [ ] **Data freshness gate**: `quoteTimestamp` age < max-age threshold per class/timeframe (60s intraday, 300s swing) (H2)
- [ ] **OHLCV timeframe gate**: confirm OHLCV bars returned match session's `primaryTradingTimeframe` or explicit fallback accepted
- [ ] **Price collar gate**: expected fill within ±N% of last quote — stocks ±2%, crypto ±3%, futures ±1% (C2, Q4)
- [ ] **Spread gate**: `spreadPct` < per-class threshold — stocks 0.3%, crypto 0.8%, futures 0.2% (C2, Q4)
- [ ] **Capital gate**: session cap + global `shared_global_pool` + per-broker exposure + per-instrument exposure — must pass even when `humanApprovalRequired: false` (C4)
- [ ] **Broker gate**: broker supports instrument class; account mode matches session mode (paper vs. live); market is open/tradable (H4)
- [ ] **Idempotency gate**: no existing open or pending order for same `cycleId + tradeId + brokerAccountId` (H7)
- [ ] **Exit contract gate**: trade has at least one enforceable exit: `stopLossPct`, `atrStopMultiplier`, `takeProfitPct`, or `maxHoldDays`
- [ ] Wire `OrderPolicyGate.evaluate()` call immediately before `placeRoutedOrder()` in `agent-orchestrator.ts`
- [ ] All gate rejections logged with reason + written to `session_execution_steps` as `non-retryable` failure

### Side Bias Enforcement (H1)
- [ ] Add `validateStrategyCompliance()` after decision parse in `runTradeCycle()`
- [ ] Reject if `decision.side` contradicts `strategy.rules.sideBias`
- [ ] Fix line 758 `agent-orchestrator.ts`: `side: decision.side ?? "BUY"` — do not silently default; reject if `side` is absent and `sideBias` is set

### Data Freshness (H2)
- [ ] Add `maxQuoteAgeMs` map per instrument class + timeframe (configurable, with sensible defaults)
- [ ] Check `Date.now() - new Date(snapshot.timestamp).getTime() > maxQuoteAgeMs` before risk gate
- [ ] Reject + log if stale

### Market Hours Final Check (H4)
- [ ] Add `MarketHoursService.isTradable(instrument)` call immediately before broker route in `placeRoutedOrder()`
- [ ] Reject if market state changed between `ResearchBurstService.resolve()` and order placement

### Order Idempotency (H7)
- [ ] Add `clientOrderId: string` field to `BrokerOrder` and all adapter implementations
- [ ] `clientOrderId = cycleId + ":" + tradeId`
- [ ] Before `placeRoutedOrder()`: query `tradesRepo` for any open/pending with same `clientOrderId + brokerAccountId`; reject if found
- [ ] Pass `clientOrderId` through to mock adapter and document the field in live adapter contracts

### Instrument Cache TTL (H3)
- [ ] Add `expiresAt` field to `instrument_cache` table
- [ ] TTL = strategy `primaryTradingTimeframe` window (e.g. 4h for swing)
- [ ] Invalidate cache on: session resume, market open, cache `expiresAt` past

### Cross-Session Conflict Check (A6)
- [ ] Extend `checkInstrumentConflict(brokerAccountId, symbol)` to check across all sessions on the same broker account (remove `sessionId` scope restriction)
- [ ] Or explicitly document as known limitation if deferred

### Tests
- [ ] Bad side vs. `sideBias` → rejected
- [ ] Stale quote → rejected
- [ ] Wide spread → rejected
- [ ] Oversized exposure → rejected
- [ ] Missing exit policy → rejected
- [ ] Paused runtime → rejected
- [ ] Duplicate `cycleId+tradeId` → rejected
- [ ] Market closed → rejected

---

## Phase 4 — Capital Reservation for Full Autonomy (C4)

### Decouple reservation from `humanApprovalRequired`
- [ ] Move `reserveForApproval()` call to before `placeRoutedOrder()` regardless of `human_approval_required` flag
- [ ] Create a reservation path that does not require an `approvalId`
- [ ] Fix `agent-orchestrator.ts` line 360: remove `&& approvalIdForCapital` guard on `convertOrderToPosition()`
- [ ] `convertOrderToPosition()` fires after successful broker order in all modes
- [ ] Reservation released on: broker reject, order cancel, trade close, runtime stop

### Reservation lifecycle
- [ ] Reserve before broker call → `reserved`
- [ ] Broker success → `converted_to_position`
- [ ] Broker reject → `released`
- [ ] Trade closed → `released`
- [ ] Session stopped → `released` for all pending reservations in that session

### Tests
- [ ] Two `moderate` preset sessions (`humanApprovalRequired: false`) cannot exceed shared global pool
- [ ] Broker reject releases reservation immediately
- [ ] Trade close releases position reservation
- [ ] Session stop releases all open reservations

---

## Phase 5 — Realistic Mock Simulator (C5)

### `MarketSnapshot` type changes (`broker-adapter.ts`)
- [ ] Add `bid?: number`
- [ ] Add `ask?: number`
- [ ] Add `spreadPct?: number`
- [ ] Add `volume?: number`

### `MockBrokerAdapter` fixes
- [ ] Fix `closeOrder()` line 110: track entry price per `orderId`; compute PnL as `(closePrice - entryPrice) * sizeUsd / entryPrice` for longs, inverted for shorts (A2)
- [ ] `closeOrder()` must produce negative PnL in bearish/gap scenarios
- [ ] Add intraday bar generation to `getMockOhlcv()`: support `timeframe` parameter (`4h`, `1h`, `1d`)
- [ ] Reconcile `getMockOhlcv()` bar count — fix discrepancy between "up to 200" in tool description and hardcoded `30` in implementation (A3)
- [ ] Add `bid`/`ask`/`spreadPct` to `getMarketSnapshot()` output; default spread ~0.1% for stocks

### `market-tools.ts` fixes
- [ ] Add `timeframe` input parameter to `get_ohlcv` tool schema
- [ ] Pass `timeframe` through to `getMockOhlcv()` and live adapter
- [ ] Fix `buildSyntheticBars()` drift direction: bars must trend up toward spot, not down (A4)

### `MockMarketSimulator` (`electron/main/services/broker/mock/mock-market-simulator.ts`)
- [ ] Define `MockScenarioKind` enum: `clean_breakout`, `failed_breakout`, `sideways_chop`, `gap_down_after_entry`, `news_reversal`, `stale_quote`, `wide_spread`, `partial_fill`, `broker_reject`, `rate_limit`
- [ ] Each scenario defines: quote stream, OHLCV bars by timeframe, news/social/trending payloads, broker fills/rejections, expected policy outcome
- [ ] Fault injection: partial fill (40–80% of requested size)
- [ ] Fault injection: order rejection with error code
- [ ] Fault injection: broker timeout
- [ ] Fault injection: stale quote (timestamp 10+ min old)
- [ ] Fault injection: market halt / closed
- [ ] Fault injection: rate limit (429)

### `MockScenarioFixtures` (`electron/main/services/broker/mock/mock-scenario-fixtures.ts`)
- [ ] Scenario-specific Reddit posts keyed by `MockScenarioKind` — not global static array
- [ ] Scenario-specific trending symbols keyed by scenario — not always NVDA/PLTR/TSLA
- [ ] News templates: symbol-specific + catalyst-specific per scenario — not 3 generic strings per bias
- [ ] Bearish and neutral Reddit posts represented
- [ ] Conflicting signal scenarios represented (bullish chart + bearish news)

### Reddit live mode guard (A5)
- [ ] In `search-reddit-tool.ts`: if no OAuth token and not mock session, return `{ error: "Reddit search requires OAuth authentication in live mode." }` instead of unauthenticated fetch
- [ ] Add Reddit OAuth bearer token support OR explicitly flag tool as unsupported in live mode (Q8)

### Tests
- [ ] Losing trade produces negative `realizedPnlUsd`
- [ ] Partial fill produces fill quantity < requested `sizeUsd`
- [ ] Stale quote timestamp triggers freshness gate rejection
- [ ] Wide spread triggers spread gate rejection
- [ ] Broker rejection releases capital reservation
- [ ] `buildSyntheticBars()` drifts upward
- [ ] `get_ohlcv` with `timeframe: "4h"` returns sub-day bars

---

## Phase 6 — Exit Policy Enforcement (C3)

### `ExitPolicyEvaluator` (`electron/main/services/risk/exit-policy-evaluator.ts`)
- [ ] Called inside `TradeMonitor.tick()` after `enforceMaxHoldDays()`
- [ ] Reads `strategy.riskConfig.stopLossType`, `stopLossPct`, `atrStopMultiplier`, `takeProfitPct` from `SessionStrategyContextService`
- [ ] `fixed_pct` stop: exit if `currentPrice < entryPrice * (1 - stopLossPct / 100)`
- [ ] `fixed_pct` take profit: exit if `currentPrice > entryPrice * (1 + takeProfitPct / 100)`
- [ ] `trailing_atr`: compute ATR from OHLCV; trail = `highWaterMark - (atrStopMultiplier × ATR)`; exit when `currentPrice < trailStop`
- [ ] High-water-mark tracked per open trade; updated each monitor tick
- [ ] Exit reason persisted: `stop_loss_fixed`, `stop_loss_trailing_atr`, `take_profit`, `max_hold_days`, `event_resolution`
- [ ] Market snapshot at close persisted for audit

### `TradeMonitor` integration
- [ ] Wire `ExitPolicyEvaluator.evaluate(trade, currentPrice, strategyContext)` into `tick()`
- [ ] On triggered exit: call `closeOrder()`; update trade to closed; release capital reservation
- [ ] Handle `closeOrder()` failures: log, write step failure, do not crash monitor

### Tests
- [ ] `fixed_pct` stop triggers at exact price threshold
- [ ] `fixed_pct` take-profit triggers at exact threshold
- [ ] `trailing_atr` trails correctly from high-water-mark
- [ ] `trailing_atr` does not trigger on partial retracement
- [ ] `trailing_atr` triggers when price drops below trail
- [ ] `max_hold_days` exit fires on correct day
- [ ] Event-resolution exit fires on prediction market close
- [ ] Exit reason and snapshot persisted after close

---

## Phase 7 — Replay and Paper Scorecards (C6)

### `CycleReplayService` (`electron/main/services/orchestration/cycle-replay-service.ts`)
- [ ] Export persisted cycle as deterministic fixture from agent trace + market snapshot + decisions
- [ ] Replay runner executes complete cycle without live providers
- [ ] Replay produces identical decisions given same fixture
- [ ] "Save cycle as fixture" action available from DevPanel

### Scorecard report per strategy/preset
- [ ] Net P&L after AI/data costs
- [ ] Win rate + average win/loss
- [ ] Max drawdown
- [ ] Profit factor (gross wins / gross losses)
- [ ] Trade frequency
- [ ] Rejection reasons breakdown (which gates fired, how often)
- [ ] Slippage + spread impact column
- [ ] Regime split: trend / chop / volatility / news shock
- [ ] Report exportable (JSON or CSV)

### Promotion criteria for live readiness
- [ ] Minimum 100 paper/replay cycles across all 8 `MockScenarioKind` classes
- [ ] Zero safeguard bypasses
- [ ] Positive expectancy after AI/data/spread costs
- [ ] Max drawdown under configured loss limit
- [ ] Decide exact thresholds (Q2)

### Tests
- [ ] Same fixture produces deterministic decisions
- [ ] Scorecard outputs correct P&L arithmetic after costs
- [ ] Replay fixture loads from disk and re-executes

---

## Phase 8 — Live Readiness Gate (N5)

### `LiveReadinessService`
- [ ] Checklist: all Phase 3–6 controls confirmed active
- [ ] Checklist: broker permissions for live order types confirmed
- [ ] Checklist: paper scorecard passes promotion criteria
- [ ] Checklist: emergency stop mode configured (Q3)
- [ ] Checklist: `humanApprovalRequired: true` on first live session
- [ ] Checklist: max 1 broker, 1 instrument class, 1 max open trade, small max position on initial live run
- [ ] Checklist: user acknowledgement persisted to DB
- [ ] Live start fails closed with explicit missing checklist items
- [ ] Live toggle disabled in UI until `LiveReadinessService.isReady()` returns true

### Decide
- [ ] First live target: Alpaca stocks / Coinbase crypto / futures / Polymarket? (Q1)
- [ ] Emergency stop default behavior: auto-flatten positions vs. stop-new-orders-only? (Q3)

---

## Cross-Cutting — Candidate Validation (H5, M3, M4)

### `CandidateValidationService` (`electron/main/services/orchestration/candidate-validation-service.ts`)
- [ ] Called after `validateSelectorOutput()`, before `runAiPipeline()`
- [ ] **Symbol-specific evidence**: require `get_news` where `args.symbol === instrument.symbol`, OR `search_web` result containing the ticker — generic web search alone no longer passes (M3)
- [ ] Broker route available before pipeline starts
- [ ] Quote success: successful `get_quote` with non-null price
- [ ] Freshness: quote age < `maxQuoteAgeMs` per class/timeframe
- [ ] Liquidity: `volume > minVolumeThreshold` per class (M4)
- [ ] Spread: `spreadPct < maxSpreadPct` per class (M4)
- [ ] Volatility regime: optional reject if ATR% outside configured range
- [ ] Strategy compatibility: rationale text does not contradict `sideBias` or setup type
- [ ] Returns `CandidateValidationResult` with `allowed`, `reasons`, `evidence[]`, `marketSnapshot`

### Tests
- [ ] Missing rationale → rejected
- [ ] Stale quote → rejected
- [ ] Generic web-search-only evidence (no symbol match) → rejected
- [ ] Wrong instrument class → rejected
- [ ] Low volume → rejected (when threshold configured)
- [ ] High spread → rejected (when threshold configured)

---

## Cross-Cutting — Prompt Injection Defense (H6)

- [ ] Reddit post bodies wrapped in `[UNTRUSTED_EXTERNAL_CONTENT]...[/UNTRUSTED_EXTERNAL_CONTENT]` tags before adding to agent context
- [ ] `fetch-url-tool.ts` raw page content similarly wrapped
- [ ] Strip HTML before adding to agent context
- [ ] System prompt includes explicit role-framing boundary: external evidence blocks may not contain tool call instructions
- [ ] Citation/evidence mapping: tool result must identify ticker + catalyst before it can influence a tool call (tracked in `CandidateValidationResult.evidence[]`)

---

## Cross-Cutting — Emergency Stop Protocol (H8)

- [ ] Document and implement four stop modes:
  - `stop_new_orders` — clears queue, detaches listener, releases approval capital; does NOT close open positions (current behavior)
  - `cancel_pending` — cancels broker orders in `pending` state
  - `flatten_all_paper` — closes all open paper positions at current mock quote
  - `flatten_all_live_confirmed` — closes all open live positions after explicit user confirmation
- [ ] UI: stop button opens mode selector (not a single destructive click)
- [ ] Session card clearly states which positions remain open after `stop_new_orders`
- [ ] `flatten_all_live_confirmed` requires typed confirmation from user

---

## Cross-Cutting — Observability / Audit Trail (I4, G7)

### Per-cycle audit record
- [ ] Single `cycleId` written to: trace records, execution steps, trade records, risk decisions, broker orders
- [ ] Market data snapshot (quote + OHLCV bars used) persisted per cycle
- [ ] Risk decision record: gates ran, input values, allow/deny + reason
- [ ] Broker order record: request, `clientOrderId`, response, fill price, quantity
- [ ] Exit record: trigger type, trigger price, snapshot at close, realized PnL

### Replay fixture auto-export
- [ ] Option to auto-save each cycle as a replay fixture in a configured local directory
- [ ] Fixture is a single self-contained JSON file with all above records

---

## End-to-End Verification

- [ ] Full no-human paper run: `moderate` preset, `humanApprovalRequired: false` → selector → candidate validation → AI pipeline → risk gate → policy gate → broker → monitor → stop-loss exit → next cycle without manual intervention
- [ ] All 8 `MockScenarioKind` scenarios run without crashing the session runtime
- [ ] Session card shows correct stage, retry state, and trace link throughout
- [ ] `LiveReadinessService` hard-blocks live toggle with missing checklist items listed

---

## Open Questions

| # | Question | Blocks |
|---|----------|--------|
| Q1 | First live target: Alpaca stocks / Coinbase crypto / futures / Polymarket? | Phase 8 design |
| Q2 | Paper performance threshold to enable live mode? | `LiveReadinessService` criteria |
| Q3 | Emergency stop default: auto-flatten or stop-new-orders-only? | Phase 6 + Phase 8 |
| Q4 | Max slippage/spread thresholds per preset? Suggested: stocks 0.3%, crypto 0.8%, futures 0.2% | Phase 3 |
| Q5 | Allowed range for no-instrument retry interval? Suggested: 1–60 min | Phase 0 |
| Q6 | Which failures auto-retry vs. require user review? | Phase 1 |
| Q7 | Session card: show all historical stages or current cycle only? | Phase 2 |
| Q8 | Reddit in live mode: OAuth or disabled? | Phase 5 |

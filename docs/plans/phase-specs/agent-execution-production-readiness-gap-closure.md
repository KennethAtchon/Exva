# Agent Execution Production Readiness - Gap Closure Spec

> **Date:** 2026-05-13
> **Status:** Draft
> **Owner:** Kenneth Atchon
> **Audience:** Engineers closing the remaining production-readiness gaps
> **Scope:** Exact implementation work required to close the remaining holes after the current audit of `agent-execution-production-readiness-deep-plan.md`

## 1. Purpose

This document is not a replacement for `docs/plans/phase-specs/agent-execution-production-readiness-deep-plan.md`. That file explains the full target architecture. This file exists for a narrower purpose: convert the still-open gaps into concrete implementation instructions that can be executed without guesswork.

The current codebase already landed meaningful slices of the deep plan: selector parser fallback, configurable no-instrument retry, execution-step persistence, no-approval capital reservation, the base policy gate, mock scenario support, exit-policy evaluation, replay export, and paper scorecards. The audit found that those slices are incomplete in specific ways. This spec closes those exact holes.

## 2. Current Gap Summary

| ID | Area | Current gap | Severity |
| --- | --- | --- | --- |
| G1 | Step runtime | `monitoring` exists in shared types/UI metadata but is never persisted as an execution step | High |
| G2 | Progress UI | `getLatestBySession()` mixes stages from different cycles; `activeRoleLabel` is never populated; `View Trace` does not deep-link to the trace view | High |
| G3 | Policy gate | Price collar is a no-op; idempotency always returns false; broker capability and market-open gates are not wired with real values | Critical |
| G4 | Mock fallback | `buildSyntheticBars()` still drifts downward toward spot and does not match the intended production-like fallback behavior | Medium |
| G5 | Exit enforcement | `TradeMonitor` cannot compute ATR for live/non-mock adapters and does not persist close-time market snapshot evidence | Medium |
| G6 | Replay scorecards | `PaperScorecardService.generate()` leaves `scenarioCoverage` empty, so promotion criteria are incomplete | Medium |
| G7 | Live readiness | No hard gate exists before starting a `live_allowed` session | Critical |
| G8 | Regression coverage | Several behaviors are implemented but not fully protected by tests, especially assistant-text selector fallback and end-to-end readiness failures | Medium |

## 3. Required Delivery Order

Implement in this order. Later items depend on earlier items.

1. G3 policy-gate hardening
2. G1/G2 progress and step correctness
3. G4 mock fallback fix
4. G5 exit-monitor completion
5. G6 scorecard completion
6. G7 live-readiness hard gate
7. G8 regression test closure

Rationale:
- Live readiness cannot be credible until policy gating, monitoring, and scorecards are actually complete.
- Progress UI should reflect trustworthy step state before more automation depends on it.

## 4. Gap Closure Design

### G1. Persist and surface the `monitoring` stage correctly

#### Problem

`src/components/sessions/SessionExecutionProgress.tsx` includes `monitoring` in `STAGE_ORDER`, but no step runner invocation or direct repository write ever records a `monitoring` stage. The UI therefore claims support for a terminal stage that the runtime never emits.

#### Required behavior

- After a broker order succeeds and the trade is opened, the cycle must record `monitoring` as `succeeded` for that `cycleId`.
- If a cycle ends with `no_trade`, `monitoring` must not be written.
- If a trade later closes, the cycle remains associated with a completed `monitoring` stage; monitoring itself is an ongoing runtime responsibility, not a retried execution step.

#### Files to modify

- `electron/main/services/orchestration/agent-orchestrator.ts`
- `electron/main/db/repositories/session-execution-steps-repo.ts`
- `electron/main/ipc/session.ts`

#### Implementation

In `agent-orchestrator.ts`, immediately after:

```ts
this.deps.bus.emit("trade_opened", opened);
```

write a `monitoring` step row for the same `cycleId`:

```ts
this.deps.sessionExecutionStepsRepo.upsert({
  sessionId: this.sessionId,
  cycleId: context.cycleId,
  stage: "monitoring",
  status: "succeeded",
  attempt: 1,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  nextRetryAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  retryable: false,
});
this.deps.bus.emit("step:succeeded", { sessionId: this.sessionId, cycleId: context.cycleId, stage: "monitoring" });
```

Do not run this through `ExecutionStepRunner`. The monitor is not a retryable stage in the same sense as selector/risk/broker; it is a lifecycle handoff marker.

#### Acceptance

- A successful trade-opening cycle returns `monitoring` from the progress query.
- A `no_trade` cycle does not return `monitoring`.

### G2. Make session progress cycle-scoped and traceable

#### Problem

`SessionExecutionStepsRepo.getLatestBySession()` currently returns the latest row per stage across the entire session, which can combine `selector` from one cycle and `broker_order` from another. `activeRoleLabel` is never passed into `deriveProgress()`. `onViewTrace` only opens the session detail drawer.

#### Required behavior

- Progress must always represent one concrete latest cycle.
- Active role chip must show the role/model actually associated with the running stage.
- View Trace must navigate to the DevPanel and preselect the matching `sessionId`, `cycleId`, and stage context.

#### Files to modify

- `electron/main/db/repositories/session-execution-steps-repo.ts`
- `electron/main/ipc/session.ts`
- `src/components/sessions/SessionExecutionProgress.tsx`
- `src/pages/SessionsPage.tsx`
- `src/App.tsx`
- `src/pages/DevPanel.tsx`
- `src/lib/exva.ts` if new navigation payload helpers are needed

#### Implementation

1. Replace `getLatestBySession(sessionId)` semantics.
   Add a new repo method:

```ts
getLatestCycleState(sessionId: string): { cycleId: string | null; steps: ExecutionStepState[] }
```

Implementation rule:
- Query all rows for the session ordered by `updatedAt desc`.
- Pick the first row's `cycleId` as the active/latest cycle.
- Return only rows whose `cycleId` matches that cycle.

Do not infer a latest cycle by stage.

2. Update `session:getExecutionProgress` to call `getLatestCycleState(sessionId)` and return step `updatedAt` along with the existing fields.

3. Populate `activeRoleLabel` in the renderer.
   Add a local stage-to-role mapping in `SessionsPage.tsx`:

```ts
const STAGE_ROLE_MAP: Partial<Record<ExecutionStage, AgentRole>> = {
  selector: "instrument_selector",
  analyst_technical: "analyst_technical",
  analyst_fundamental: "analyst_fundamental",
  reviewer: "reviewer",
  decision_maker: "decision_maker",
};
```

Fetch strategy/session AI-role config for the focused session only when needed, and format chip text as:

```ts
"technical analyst · openai/gpt-4o-mini"
```

If a stage has no AI role, return `null`.

4. Wire `View Trace` to the actual trace view.
   Add a query-string or in-memory route intent in `App.tsx` such as:

```ts
type DevPanelFocus = { sessionId: string; cycleId: string; stage: ExecutionStage } | null;
```

When `onViewTrace` fires, switch page to `devpanel` and pass `DevPanel` a focus payload. In `DevPanel.tsx`, when a focus payload exists:
- filter events by `session_id` and `cycle_id`
- auto-select the newest matching event
- default the inspector tab to `trace`

#### Acceptance

- A session card never displays mixed-cycle state.
- Running AI stages show a role/model chip.
- Clicking `View Trace` opens `DevPanel` on the matching cycle trace, not the drawer.

### G3. Finish the deterministic policy gate

#### Problem

The existing `OrderPolicyGate` structure is present, but three critical controls are still not real: price collar, idempotency, and broker/tradability checks.

#### Files to modify

- `electron/main/services/orchestration/order-policy-gate.ts`
- `electron/main/services/orchestration/agent-orchestrator.ts`
- `electron/main/services/broker/adapters/broker-adapter.ts`
- `electron/main/services/broker/broker-routing-service.ts`
- `electron/main/services/orchestration/candidate-validation-service.ts`
- `electron/main/services/orchestration/__tests__/cycle-replay-service.test.ts`
- add `order-policy-gate.test.ts`

#### Implementation

1. Replace the price-collar no-op with a real re-quote comparison.

In `agent-orchestrator.ts`, fetch a fresh quote immediately before `OrderPolicyGate.evaluate()` and pass both snapshots:

```ts
quoteSnapshot: latestQuote,
placementQuoteSnapshot: freshPlacementQuote,
```

Expand `DecisionRiskInput` accordingly:

```ts
placementQuoteSnapshot?: MarketSnapshot;
```

Then in `order-policy-gate.ts`:

```ts
const ref = d.quoteSnapshot?.price;
const now = d.placementQuoteSnapshot?.price;
if (ref && now) {
  const driftPct = Math.abs(now - ref) / ref;
  if (driftPct > collar) gatesFailed.push("price_collar");
}
```

Use the class thresholds already declared in `PRICE_COLLAR_PCT`.

2. Make idempotency real.

Add `clientOrderId: string` to `BrokerOrder` and thread it into every adapter call site. In `agent-orchestrator.ts`, build it once from `${cycleId}:${trade.id}`.

Add a repo-backed lookup for duplicate open or pending orders by `(brokerAccountId, clientOrderId)` before placement. If there is no existing persisted field for `clientOrderId`, add one to the trades schema and persist it at trade creation/open order time.

3. Wire broker capability and market-open checks with real values.

Before `OrderPolicyGate.evaluate()`:
- resolve the adapter and set `brokerSupportsClass = adapter.supportedInstrumentClasses.includes(context.instrument.instrumentClass)`
- call a final market-hours/tradability resolver and set `marketIsOpen`

This must happen immediately before broker routing, not only during research burst.

4. Fail closed if the fresh placement quote is unavailable.

If the pre-placement quote fetch throws or returns invalid data, reject with `VALIDATION_FAILED` rather than placing on the stale selector quote.

#### Acceptance

- A quote that moves beyond the class collar between candidate validation and order placement is rejected.
- Replaying the same `cycleId:tradeId` cannot place a second order.
- Closed markets and unsupported instrument classes reject before touching the broker.

### G4. Fix the synthetic OHLCV fallback

#### Problem

`electron/main/services/ai/tools/market-tools.ts` still uses a bearish backward drift in `buildSyntheticBars()`.

#### Files to modify

- `electron/main/services/ai/tools/market-tools.ts`
- add or extend `market-tools.test.ts`

#### Implementation

Replace:

```ts
const close = round2(Math.max(0.01, spot * (1 - drift)));
```

with an upward historical drift so older bars are lower and newer bars approach spot from below:

```ts
const progress = (29 - i) / 29;
const close = round2(Math.max(0.01, spot * (0.955 + progress * 0.045)));
```

Then derive `open`, `high`, and `low` off that close. Keep the fallback simple and deterministic; do not attempt a full simulator here. The real simulator work already lives in `MockBrokerAdapter` and `mock-market-simulator.ts`.

#### Acceptance

- Synthetic fallback bars trend upward toward spot.
- Newest close is approximately spot.

### G5. Complete exit-policy monitoring for live-like adapters

#### Problem

`TradeMonitor` currently computes ATR only when an adapter exposes `getMockOhlcv()`. It also closes trades without persisting the quote snapshot that triggered the exit.

#### Files to modify

- `electron/main/services/broker/adapters/broker-adapter.ts`
- `electron/main/services/orchestration/trade-monitor.ts`
- `electron/main/db/repositories/trades-repo.ts`
- `electron/main/db/schema.ts` only if trade-level snapshot persistence needs an additional column; otherwise reuse existing fields consistently
- add `trade-monitor.test.ts`

#### Implementation

1. Add an optional broker-adapter market-history method:

```ts
getOhlcv?(instrumentSymbol: string, timeframe: "1h" | "4h" | "1d", barCount: number): Promise<Array<{ high: number; low: number; close: number }>>;
```

2. Implement it on `MockBrokerAdapter` by delegating to `getMockOhlcv()`.

3. In `TradeMonitor.tick()`, request bars using timeframe derived from session strategy:
- `intraday_flat` -> `1h`
- `multi_day_swing` -> `4h`
- `weeks_position` and `custom` -> `1d`

4. Fall back cleanly.
   If `getOhlcv` is absent or fails, trailing ATR exits are skipped for that tick, but fixed stop-loss, take-profit, max-hold, and prediction-market exits still run.

5. Persist close evidence.
   When `closeTradeAtBroker()` closes due to an evaluator decision, update the trade with:
- `exit_reason`
- close-time `market_snapshot_json`
- `closed_at`

The schema already has `market_snapshot_json`; use it consistently for exit evidence instead of adding a second snapshot field unless the current meaning would become ambiguous.

#### Acceptance

- Trailing ATR works for mock and any adapter that implements `getOhlcv()`.
- Exit-triggering quote snapshot is persisted with the closed trade.

### G6. Compute scorecard scenario coverage

#### Problem

`PaperScorecardService.generate()` always returns `scenarioCoverage: {}`.

#### Files to modify

- `electron/main/services/analytics/paper-scorecard-service.ts`
- `electron/main/db/schema.ts` and trade persistence only if there is no existing place to derive scenario kind
- corresponding tests in `paper-scorecard-service.test.ts`

#### Implementation

Use one source of truth for mock scenario classification. Preferred order:

1. If `trade.instrument_metadata_json` already stores a mock scenario kind, parse it.
2. Else if the associated broker account is mock and the cycle fixture export contains a scenario, derive from replay fixture metadata.
3. Else leave the trade unclassified.

Do not infer scenarios from PnL or exit reason.

Add a helper:

```ts
function readMockScenarioKind(trade: Trade): MockScenarioKind | null
```

Increment coverage counts only for classified trades.

If the current trade metadata does not persist mock scenario kind yet, add it to `instrument_metadata_json` when mock trades are created. That is the smallest change that preserves existing schema shape.

#### Acceptance

- Scorecards show non-empty scenario coverage for mock sessions.
- `meetsPromotionCriteria()` can fail on missing required scenario classes for real reasons rather than an always-empty map.

### G7. Add the hard live-readiness gate

#### Problem

`SessionService.start()` currently starts any focused session that passes preflight, including `live_allowed` sessions. There is no readiness report, acknowledgement, or UI gate.

#### Files to create

- `electron/main/services/risk/live-readiness-service.ts`

#### Files to modify

- `electron/main/services/session/session-service.ts`
- `electron/main/ipc/session.ts`
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/session-repo.ts`
- `src/pages/SessionsPage.tsx`
- `src/components/sessions/SessionTable.tsx`
- optionally a new `src/components/sessions/LiveReadinessModal.tsx`

#### Implementation

Implement the design in `docs/plans/phase-specs/phase-8-live-readiness.md` with one important tightening: the gate must execute in the main-process `SessionService.start()` path, not only in the UI.

Required flow:

1. `SessionService.start(sessionId)`
- load session
- if `session.executionMode !== "live_allowed"`, continue normally
- else call `liveReadinessService.check(sessionId)`
- if report fails, emit session event and throw `AppError("Live readiness gate failed", "VALIDATION_FAILED", { blockedBy, checks })`

2. Add IPC handlers:
- `session:getLiveReadiness`
- `session:testLiveBrokerConnection`
- `session:acknowledgeLiveReadiness`

3. Persist `live_readiness_acknowledged_at` on `sessions`.
   Clear it whenever materially relevant config changes:
- execution mode
- broker assignments/routing
- risk config
- timeframe config

4. Add a renderer modal for the checklist.
   Starting a live session from `SessionsPage.tsx` must:
- call `getLiveReadiness`
- show the modal if blocked
- allow explicit acknowledgement only after all non-ack checks pass

5. Keep the backend hard gate even if the UI already checked.
   This prevents bypass through stale renderer state or direct IPC use.

#### Acceptance

- A `live_allowed` session with missing readiness items cannot start from UI or direct IPC.
- A passing report still requires explicit user acknowledgement.
- Editing relevant config clears prior acknowledgement.

### G8. Close regression coverage gaps

#### Tests to add or update

- `electron/main/services/ai/ai-runtime/__tests__/instrument-selection-parser.test.ts`
  Add explicit assistant-text fallback coverage.
- `electron/main/services/orchestration/__tests__/execution-step-runner.test.ts`
  Add monitoring-stage handoff assertions if helper logic is added around it.
- `electron/main/services/orchestration/__tests__/order-policy-gate.test.ts`
  Add price-collar drift, duplicate client-order-id, broker closed, and unsupported class cases.
- `electron/main/services/orchestration/__tests__/agent-orchestrator.test.ts`
  Add fresh-placement-quote failure and no-op duplicate replay cases.
- `electron/main/services/orchestration/__tests__/trade-monitor.test.ts`
  Add close-time market snapshot persistence and non-mock `getOhlcv()` behavior.
- `electron/main/services/analytics/__tests__/paper-scorecard-service.test.ts`
  Add actual scenario coverage computation assertions.
- `electron/main/services/risk/__tests__/live-readiness-service.test.ts`
  Add full readiness pass/fail matrix.
- renderer tests for `SessionExecutionProgress` and the live-readiness modal if the repo has existing renderer test coverage; otherwise add focused component tests only for the new logic-heavy pieces.

## 5. Verification Commands

```bash
bun run typecheck
bunx vitest electron/main/services/ai/ai-runtime/__tests__/instrument-selection-parser.test.ts
bunx vitest electron/main/services/orchestration/
bunx vitest electron/main/services/risk/
bunx vitest electron/main/services/analytics/
```

If renderer tests are added:

```bash
bunx vitest src/components/sessions/
```

## 6. Done Criteria

This gap-closure work is complete only when all of the following are true:

1. `monitoring` appears in progress only for trade-opening cycles and is backed by persisted step state.
2. Session progress is scoped to the latest concrete cycle and never mixes stages across cycles.
3. `View Trace` opens the actual trace view on the correct cycle.
4. Policy gate enforces a real price collar, real idempotency, and real broker/tradability checks.
5. Synthetic OHLCV fallback no longer biases technical analysis bearish.
6. Exit-triggering market snapshot evidence is persisted.
7. Paper scorecards compute scenario coverage from stored trade/cycle metadata.
8. Live sessions fail closed until readiness checks and acknowledgement pass.
9. The new tests fail before the implementation and pass after it.

## 7. Non-Goals

- Rewriting the entire deep plan
- Replacing the existing mock simulator with a separate service architecture
- Building a generalized router/navigation framework for the whole app
- Expanding live-readiness thresholds beyond the first-live-session constraints already defined in `phase-8-live-readiness.md`

## 8. Open Assumptions

| ID | Assumption | Impact if false |
| --- | --- | --- |
| A1 | `market_snapshot_json` on trades can safely store close-time exit evidence without breaking existing readers | If false, add a dedicated `close_market_snapshot_json` column instead |
| A2 | Mock scenario kind can be persisted in `instrument_metadata_json` without needing a new top-level trade column | If false, add `mock_scenario_kind` explicitly to trades |
| A3 | `DevPanel` can accept a simple focus payload through `App.tsx` state without requiring router changes | If false, add a lightweight global store for DevPanel intent |

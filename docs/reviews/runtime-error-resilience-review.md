# Runtime Error Resilience — Implementation Review

> **Reviewed:** 2026-05-24  
> **Plan doc:** [`docs/plans/runtime-error-resilience-plan.md`](../plans/runtime-error-resilience-plan.md)  
> **Branch:** main  

---

## Summary

Phases 1, 2, and 4 (log consistency) landed substantially complete. Phase 3 (frontend visibility) is not started. Phase 5 (integration tests) is partial. Several edge cases and one spec-deviation are worth fixing before Phase 3 ships.

| Phase | Status | Notes |
|---|---|---|
| **1** — Cycle boundary hardening | ✅ Done | All five tasks landed |
| **2** — Soft policy outcomes + failure history | ✅ Done (one gap) | `maxDataSpendUsd` operator-guardrail not enforced at runtime |
| **3** — Operator visibility (frontend) | ❌ Not started | No toast, no attention badge, no session-page failure surface |
| **4** — Observability consistency | 🟡 Partial | Log levels correct; `outcome` field not in DB schema |
| **5** — Tests and replay fixtures | 🟡 Partial | Unit tests solid; integration scenarios missing |

---

## Phase 1 — Cycle boundary hardening ✅

### What landed

**`trade-cycle.ts` — `finishWithoutOpenPosition`**

```ts
function finishWithoutOpenPosition(
  ctx: TradingCycleContext,
  label: string,
  outcome: OrchestrationOutcome = "no_trade",
): void {
  if (outcome !== "no_trade" && outcome !== "transient") return;
  scheduleCycleRefillAfterDelayIfIdle(ctx, ctx.scheduleSelectorCycle, label, ...);
}
```

Called at every exit path that doesn't open a position: `pipeline.status === "failed"`, `decision.output.action === "skip"`, unapproved trade, failed broker order. Correct.

**`executeTradeCycle` top-level try/catch**

Unexpected throws are caught, recorded as `outcome: "bug"` + `reasonCategory: "unexpected_bug"`, emitted as ERROR, and trigger `attention_required`. Process never dies from a trade-cycle crash.

**Unified retry timer**

`scheduleCycleRefillAfterDelayIfIdle` is the single path for delayed selector reschedule. Duplicate-timer guard prevents stacking:

```ts
if (ctx.noInstrumentRetryTimer) {
  ctx.deps.logger.info(..., "orchestrator retry timer already scheduled; skipping duplicate");
  return;
}
```

**Selector failure → delayed retry in `runPhaseCycle`**

After a selector step failure, non-operator/non-bug/non-session-capacity outcomes call `scheduleCycleRefillAfterDelayIfIdle` instead of immediately setting `attention_required`.

**`attention_required` narrowed correctly**

`handleStepFailure` in `TradingCycleContext` only sets `attention_required` for `operator_required` and `bug`. Transient hard failures escalate after `MAX_CONSECUTIVE_HARD_FAILURES` (= 3). `no_trade` and `session_capacity` never set `attention_required`.

### Minor issue

`runPhaseCycle` (orchestrator-step.ts:148) schedules a delayed refill when `stage === "selector"` and outcome is not `operator_required | bug | session_capacity`. The selector refill callback is `() => options.retryCycle()` — a lambda, not `ctx.scheduleSelectorCycle`. This is correct behavior, but it means two timer paths exist for selector retries: one in `instrument-queue.ts` (via `handleResolvedInstruments`) and one in `runPhaseCycle`. Both use `scheduleCycleRefillAfterDelayIfIdle`, so the dedup guard prevents stacking. Not a bug, but worth noting.

---

## Phase 2 — Soft policy outcomes + failure history ✅ (one gap)

### What landed

**`runtime-outcome.ts`** — fully spec-compliant types

The module exactly matches the plan spec:

- `OrchestrationOutcome` union: `no_trade | transient | session_capacity | operator_required | bug`
- `FailureHistoryEntry` with all specified fields
- `outcomeLevel()` — `no_trade` and `session_capacity` → WARN; `transient` retryable → WARN, exhausted → ERROR; `operator_required | bug` → ERROR
- `createOutcomeError()` for creating typed `AppError`s with outcome details

**`classifyStepError` in `trading-step-runner.ts`**

Now reads `details.outcome` from `AppError` before falling back to code-based defaults. Also reads `details.reasonCategory`. The explicit-override path is clean:

```ts
const outcome = isOrchestrationOutcome(details?.outcome)
  ? details.outcome
  : defaultOutcomeForAppError(error.code, details?.retryable === true);
```

Dedicated code-to-outcome mappings:
- `OPERATOR_REQUIRED_CODES`: `LOCKED`, `MISSING_SECRET`, `NO_BROKER`, `PROVIDER_NOT_CONFIGURED`, `SEARCH_PROVIDER_REQUIRED`, `SPEND_CAP_EXCEEDED`, `UNSUPPORTED_INSTRUMENT` → `operator_required`
- `SESSION_CAPACITY_CODES`: `BROKER_ALLOCATION_EXCEEDED`, `BROKER_SESSION_CAP_EXCEEDED`, `CAPITAL_POOL_EXCEEDED` → `session_capacity`
- `NO_TRADE_CODES`: `INSTRUMENT_CONFLICT` → `no_trade`
- `VALIDATION_FAILED` still maps to `transient` in `defaultOutcomeForAppError` (not `bug`). This is fine because errors that carry explicit `details.outcome` override it.

**`trade-engine-input-builders.ts`** — policy rejection classification

`classifyRiskGateError` (module-local function):
| Reason string | Code | Outcome |
|---|---|---|
| "Maximum concurrent trades reached" | `VALIDATION_FAILED` | `session_capacity` |
| "Daily API budget reached" | `SPEND_CAP_EXCEEDED` | `operator_required` + `session_spend_limit` |
| "Daily loss limit reached" | `SPEND_CAP_EXCEEDED` | `operator_required` + `session_pnl_limit` |
| "Profit target reached" | `SPEND_CAP_EXCEEDED` | `operator_required` + `session_pnl_limit` |
| other | `VALIDATION_FAILED` | `no_trade` + `risk_gate` |

Broker allocation paths:
- `allocation.ok === false` → `session_capacity` (position-level allocation full)
- `conflict.ok === false` → `no_trade` + `broker_allocation` (symbol-specific conflict)

`createOrderPolicyError` in `effect-runner.ts`:
- Capital/strategy/data/price gates → `no_trade` + `risk_gate`
- Runtime gate → `operator_required`
- Fallback → `no_trade` + `broker_reject`

**`TradingCycleContext` failure history**

All spec requirements met:
- 1-hour rolling window (`FAILURE_HISTORY_WINDOW_MS = 60 * 60 * 1000`)
- `pruneFailureHistory()` called on every read and write
- `recordFailure()` sets `retryAt` for `no_trade` and `transient` outcomes only
- `getFailureHistoryForInstrument()` case-insensitive normalized lookup
- `getNearestRetryAt()` sorted ascending, returns earliest

**Failure history injection into pipeline**

Selector pipeline:
- `runSelector` passes `ctx.getFailureHistory()` + `ctx.getNearestRetryAt()` as top-level input
- Each `ResolvedInstrument` carries `recentFailureHistory: ctx.getFailureHistoryForInstrument(row.symbol)`
- Discovery stage task receives `failureHistory` + `nextEligibleRetryAt`
- Verification stage task receives per-symbol filtered `failureHistory`
- `selector-risk-filter` finalizer receives instrument-scoped `failureHistory`

Trade pipeline phases:
- `technical`, `fundamental`, `review`, `decision` phases all receive `recentFailureHistory` from the instrument's `recentFailureHistory` field

### Gap: `maxDataSpendUsd` enforcement not wired

The plan explicitly calls out: "Explicit `maxDataSpendUsd` operator-required guardrail wiring — still pending."

The field is stored in the DB (`sessionRiskConfig.maxDataSpendUsd`), surfaced in the risk-config prompt context (`strategy-prompt-context.ts`), and passed to `fetch-url-tool` via `worker-tool-factory`. However:

- `fetch-url-tool` does not throw `SPEND_CAP_EXCEEDED` when the limit is crossed
- No pipeline step checks cumulative data spend against `maxDataSpendUsd` and converts it to `operator_required`

This means a session can exceed `maxDataSpendUsd` without halting intake. This is a known gap from the plan.

### Minor issue: string-match guardrails are fragile

`classifyRiskGateError` pattern-matches on the reason string returned by the risk engine worker:

```ts
if (reason === "Daily API budget reached") { ... }
if (reason === "Daily loss limit reached" || reason === "Profit target reached") { ... }
```

If the risk engine worker ever changes its output phrasing, the guardrail silently downgrades from `operator_required` to `no_trade`. Recommend adding a structured `gateType` field to the risk engine output so the classifier isn't string-matching.

### Minor issue: `classifyPolicyRejection` not extracted as its own module

The plan proposed `orchestration/policy/outcome-classifier.ts`. Instead, classification lives in:
- `classifyRiskGateError` in `trade-engine-input-builders.ts`
- `createOrderPolicyError` in `effect-runner.ts`
- `defaultOutcomeForAppError` / `defaultReasonCategory` in `trading-step-runner.ts`

Not a functional problem, but it's scattered. Moving the code-to-outcome tables to a shared module would prevent future divergence.

---

## Phase 3 — Frontend visibility ❌ Not started

Nothing from Phase 3 has landed. From the plan:

| Task | Status |
|---|---|
| Global session ERROR/WARN toast (`RuntimeEventToast.tsx` wired in `App.tsx`) | ❌ |
| `step:failed` failure surface on SessionsPage row + SessionDetailDrawer | ❌ |
| Subscribe to `research_phase_failed` with human-readable message | ❌ |
| `attention_required` badge in TopNav → filtered Sessions view | ❌ |
| Optional: recent WARN/ERROR count + failure history summary | ❌ |

The bus events that Phase 3 would consume are all emitted correctly on the backend. The frontend is not listening.

**Current operator experience:** ERRORs appear in the Dashboard event feed only. An operator on any other page (Sessions, Trades) gets no real-time signal that a cycle failed. They must navigate to Dashboard or open DevPanel.

---

## Phase 4 — Observability consistency 🟡 Partial

### Done

**`event-bus-observer.ts` log levels** — fully corrected:

```ts
observe("step:failed", (payload) => {
  const logFn = payload.retryable
    ? scopeLogger.warn.bind(scopeLogger)
    : scopeLogger.error.bind(scopeLogger);
  logFn({ eventName: "step:failed", ...payload }, "execution step failed");
});

observe("research_phase_failed", (payload) => {
  scopeLogger.error(..., "research phase failed");
});
```

`agent_event` is level-aware (ERROR/WARN/DEBUG/INFO). This matches plan §4 requirement.

`handleStepFailure` also emits `agent_event` with the correct level for every terminal failure. `research_phase_complete` and `research_phase_failed` bus events are both covered.

### Not done

**`outcome` field not in DB schema**

`session_execution_steps` table has no `outcome` column:

```ts
// schema.ts — no outcome column on sessionExecutionSteps
```

The plan requires this for DevPanel filtering by outcome type. Adding it requires a migration and a schema change to `SessionExecutionStepsRepo.upsert`.

---

## Phase 5 — Tests 🟡 Partial

### What landed

**`trading-cycle-context.test.ts`** — 2 tests:
1. Instrument-scoped failure recording with retry timing (asserts `retryAt`, `instrumentSymbol`, `reasonCategory`)
2. 1-hour pruning

**`trading-step-runner.test.ts`** — 6 tests covering:
1. Normal success lifecycle (step:started → step:succeeded)
2. Provider HTTP 503 → retryable transient + `retrying` status + `nextRetryAt`
3. `VALIDATION_FAILED` → non-retryable `transient`
4. Retryable `AppError` (explicit `details.retryable: true`) → `retrying`
5. Cap after 4 retries → exhausted, `retryable: false`
6. Exponential backoff schedule (30s / 60s / 120s / 240s)
7. `skipIfPreviouslySucceeded` option

**`agent-orchestrator.test.ts`** — selector retry path tests (limited)

### Missing (plan Phase 5 acceptance criteria)

| Scenario | Status |
|---|---|
| Pipeline stage failure → refill, session stays active | ❌ |
| Selector failure → retry, no attention_required | ❌ |
| Concurrent-trade cap → WARN `session_capacity` + auto-retry when slot opens | ❌ |
| API budget / daily loss / profit target → `operator_required` + `attention_required`, no retry until Resume | ❌ |
| History entries older than 1 hour pruned before selector context render | ❌ (unit tested for pruning but not end-to-end through selector context) |
| Replay fixtures for no_trade vs error outcomes | ❌ |
| Frontend: bus handler renders toast | ❌ |

---

## Issues catalogue

### Bug-level

None confirmed. The core invariants hold:
- Process can't die from a trade-cycle crash — top-level catch is present
- `attention_required` is correctly gated to `operator_required` and `bug`
- No silent stall path found for the trade-cycle branch

### Design issues

**1. `recordFailure` in `instrument-queue.ts` uses `sessionId` as `cycleId`**

```ts
// instrument-queue.ts:59
ctx.recordFailure({
  cycleId: ctx.sessionId,  // ← wrong
  ...
});
```

`cycleId` is used in `TradingCycleContext.recordFailure` to look up the instrument via `cycleContexts.get(input.cycleId)`. Passing `sessionId` will always miss, so `instrumentSymbol` will be `null` for no-instrument selector entries. This is partially acceptable (there's no instrument at that point), but the intent is that a unique cycle UUID should be used. The entry is still functionally correct — it lands in `failureHistory` as a session-level `selector_cycle` entry with no symbol — but it's semantically wrong.

**2. String-match guardrails in `classifyRiskGateError`**

Described above. Risk engine output phrasing change → silent outcome downgrade. Add a structured `gateType` field to the risk engine output.

**3. `retryAfterFailureMinutes` rename not done**

Plan recommended renaming `noInstrumentRetryMinutes` to `retryAfterFailureMinutes`. The DB column, repo, and type still use the old name. `TradingCycleContext.getFailureRetryMinutes()` wraps it correctly, so the semantic gap is papered over, but the surface name doesn't reflect the broadened scope.

**4. `classifyPolicyRejection` not extracted**

Three separate files classify outcome from error codes/reasons. A single shared `outcome-classifier.ts` would make the taxonomy authoritative and testable in isolation.

### Gaps (plan items confirmed not done)

- `maxDataSpendUsd` operator-required enforcement at runtime (fetch-url-tool + data pipeline)
- `outcome` column on `session_execution_steps` DB table + DevPanel filter
- All Phase 3 frontend work
- Phase 5 integration test scenarios for guardrail flows

---

## What went well

1. **Type taxonomy is clean.** `runtime-outcome.ts` is a standalone, zero-dependency module. Everything imports from it; nothing re-declares the types.

2. **`classifyStepError` override path is correct.** Explicit `details.outcome` on `AppError` wins over code-based defaults. Callers can precisely control classification without monkey-patching.

3. **Failure history is self-cleaning and properly scoped.** Pruning on every read/write, 1-hour window, per-instrument lookup, nearest-retry calculation — all spec-correct.

4. **Failure history reaches every relevant surface.** Discovery workers, verification workers, finalizer (selector-risk-filter), and all four trade-pipeline phases receive it. The plan's §4.3 worker integration requirement is met.

5. **Dedup guard prevents timer stacking.** `scheduleCycleRefillAfterDelayIfIdle` logs and returns early if a timer is already scheduled. No infinite retry buildup.

6. **Consecutive hard failure escalation.** Three consecutive `transient` failures within a cycle context escalate to `attention_required` with a clear user-facing message. Resets cleanly on success.

7. **`finishWithoutOpenPosition` correctly ignores `session_capacity`.** It returns early for `session_capacity`, delegating restart to the trade-closed handler path rather than scheduling an incorrect retry timer.

---

## Recommended next actions (priority order)

1. **Fix `cycleId: ctx.sessionId` in `instrument-queue.ts`** — use a random UUID when there's no cycle context; or accept the null instrument and leave a code comment explaining it's intentional.

2. **Add `outcome` column to `session_execution_steps`** schema + repo + migration so DevPanel filtering lands. Small schema change, high operator value.

3. **Phase 3 frontend** — `RuntimeEventToast`, SessionsPage step failure surface, TopNav badge. Backend is fully wired; this is purely UI work.

4. **Replace string-match risk-gate reasons** with structured output from the risk engine worker (add `gateType: "spend_limit" | "pnl_limit" | "concurrent_cap" | ...` to its output schema).

5. **Integration tests** for the capital-stop scenarios (spend/PnL → `attention_required`, no auto-retry) and the `session_capacity` → auto-retry-when-slot-opens path.

6. **`maxDataSpendUsd` guardrail wiring** — instrument the fetch-url tool (and any other data-cost accumulator) to check cumulative session data spend, throw `SPEND_CAP_EXCEEDED` with `outcome: "operator_required"`, so it routes through `handleStepFailure` → `attention_required`.

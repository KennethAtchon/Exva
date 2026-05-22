# Mock Trade Rehearsal Fix Plan Review - 2026-05-22

## Summary

`docs/plans/mock-trade-rehearsal-fix-plan.md` is mostly implemented as claimed. Phases 0-4 are present in code and covered by targeted regression tests. The plan's "Phase 5 partial" status is also accurate: selector diagnostics and enqueue logging are implemented, but the full end-to-end mock happy-path proof (`trade.status === "open"`) is still missing.

The main remaining implementation mismatch is in Phase 2 cleanup. OpenRouter provider-reported cost is wired through the run path and used by worker spend tracking, but duplicate `estimateCostUsd()` fallback paths still exist in trace assembly/runtime conversion even though the plan said re-estimation should be removed and `RunTrace.costUsd` should be the single source of truth.

## Review Scope

Reviewed against `docs/plans/mock-trade-rehearsal-fix-plan.md`.

Verified implementation and tests in:

- `electron/main/services/ai/pipeline-runtime/plan/plans/selector/plan.ts`
- `electron/main/services/orchestration/policy/candidate-validation-service.ts`
- `electron/shared/ai/pipeline-config.ts`
- `electron/main/services/ai/pipeline-runtime/core/pipeline-runtime.ts`
- `electron/main/services/ai/pipeline-runtime/phase-config-resolver.ts`
- `electron/main/services/ai/pipeline-runtime/execution/pipeline-spend-tracker.ts`
- `electron/main/services/ai/adapters/run-agent-execute.ts`
- `electron/main/services/ai/resolve-run-cost.ts`
- `electron/main/services/ai/pipeline-runtime/execution/trace-assembler.ts`
- `electron/main/services/ai/ai-runtime/runtime-trace.ts`
- `electron/main/services/broker/mock/mock-discovery-fixtures.ts`
- `electron/main/services/ai/engines/aggregators/trade-signal-aggregator.ts`
- `electron/main/services/orchestration/cycle/scheduling/instrument-queue.ts`
- `electron/main/services/ai/pipeline-runtime/plan/phase/interpreter.ts`

## Findings

### 1. Medium: Phase 2 still has duplicate cost-estimation fallbacks

**Files:**

- `electron/main/services/ai/pipeline-runtime/execution/trace-assembler.ts:9,72-78`
- `electron/main/services/ai/ai-runtime/runtime-trace.ts:2,20-22`

**What:** Both files still import `estimateCostUsd()` and fall back to re-estimating cost when building `AgentRun` rows.

**Why it matters:** The plan explicitly said Phase 2 should compute cost once in `run-agent-execute`, carry it in `RunTrace`, and stop re-estimating in downstream assembly. `RunTrace.costUsd` is already required, so these paths are now duplicate logic. They do not appear to break the happy path today, but they leave the old architecture partially in place.

**Fix:** Remove the fallback expressions and persist `trace.costUsd` directly.

### 2. Medium: The planned end-to-end mock open-trade proof is still missing

**Files:**

- `electron/main/services/ai/pipeline-runtime/plan/__tests__/trade-analysis-plans.test.ts:6-19`
- `electron/main/services/orchestration/cycle/__tests__/run-selector.test.ts:6-68`
- `electron/main/services/orchestration/cycle/__tests__/agent-orchestrator.test.ts:25-84`

**What:** The current tests cover plan registration, selector filtering behavior, retry timing, and the phase-level regressions from the fix plan. I did not find the full integration test described in Phase 5 that proves `mock broker + clean_breakout -> enqueued trade cycle -> mock fill -> trade.status === "open"`.

**Why it matters:** This is the key remaining checklist item in the fix plan. Without it, the repo confirms most local contracts but still does not automatically prove the full mock rehearsal happy path.

**Fix:** Add the deferred integration test or narrow the plan language further if the repository intentionally stops at unit/regression coverage.

### 3. Low: Phase 2 implements OpenRouter provider cost, but not the full provider-priority ladder described in the plan

**Files:**

- `electron/main/services/ai/resolve-run-cost.ts:19-24`
- `electron/main/services/ai/adapters/run-agent-execute.ts:356-364`

**What:** The implementation supports provider-reported cost via OpenRouter `providerMetadata.openrouter.usage.cost`, then falls back to estimation. The plan text also described a second priority for direct-provider billed cost when adapters expose it.

**Why it matters:** This is only a mismatch with the broader design wording, not a bug in the current OpenRouter path. If the app later uses direct Anthropic/OpenAI billing data, additional plumbing will still be needed.

**Fix:** Extend `resolveRunCostUsd()` only if direct-provider adapters will expose billed cost.

## Verified Implementations

### Phase 0 - Selector evidence ordering / CV-7 fix

Verified in:

- `electron/main/services/ai/pipeline-runtime/plan/plans/selector/plan.ts:230-240`
- `electron/main/services/orchestration/policy/candidate-validation-service.ts:160-166`
- `electron/main/services/ai/engines/selector/selector-risk-filter.test.ts:72-138`

What shipped matches the plan:

- `selectorEvidence` is built before `RiskFilter.evaluate(...)`
- CV-7 only checks summary when structured evidence exists
- Regression coverage exists for the prior `selectorEvidence: null` failure mode

### Phase 1 - Paper/mock budget profile and warn-only caps

Verified in:

- `electron/shared/ai/pipeline-config.ts:69-111`
- `electron/main/services/ai/pipeline-runtime/phase-config-resolver.ts:73-104`
- `electron/main/services/ai/pipeline-runtime/core/pipeline-runtime.ts:292-315`
- `electron/main/services/ai/pipeline-runtime/execution/pipeline-spend-tracker.ts:15-16,68-70`
- `electron/main/services/ai/pipeline-runtime/__tests__/pipeline-spend-tracker.test.ts:54-66`

What shipped matches the plan:

- `PAPER_MOCK_BUDGETS` exists with raised selector/trade/session caps
- sandbox/mock sessions resolve raised phase and session caps
- `warnOnly` mode keeps workers running after cap exceed in mock sessions

### Phase 2 - OpenRouter provider cost wiring

Verified in:

- `electron/main/services/ai/adapters/run-agent-execute.ts:356-365,414-451`
- `electron/main/services/ai/resolve-run-cost.ts:5-43`
- `electron/main/services/ai/ai-runtime/ai-runtime-types.ts:33-48`
- `electron/main/services/ai/pipeline-runtime/execution/worker-executor.ts:378-406`
- `electron/main/services/ai/__tests__/resolve-run-cost.test.ts:7-45`
- `electron/main/services/ai/__tests__/run-agent-execute.test.ts:146-152`

What shipped matches the plan:

- OpenRouter `usage.cost` is extracted
- `RunTrace` carries `costUsd` and `costSource`
- worker logs and spend tracking use resolved cost
- estimate fallback is warned when provider cost is absent

### Phase 3 - Mock symbol substitution fix

Verified in:

- `electron/main/services/broker/mock/mock-discovery-fixtures.ts:228-329,346-383`
- `electron/main/services/broker/mock/mock-discovery-fixtures.test.ts:28-59`

What shipped matches the plan:

- `SYMBOL_NOISE` expanded substantially
- generic queries fall back to `knownSymbols[0]`
- regression tests cover `TODAY`-style noise and direct ticker matches

### Phase 4 - Mock relaxed entry timing

Verified in:

- `electron/main/services/ai/pipeline-runtime/plan/plans/trade/analysis-plans.ts:136-147`
- `electron/main/services/ai/engines/aggregators/trade-signal-aggregator.ts:68-77`
- `electron/main/services/ai/engines/aggregators/trade-signal-aggregator.test.ts:91-107`

What shipped matches the plan:

- mock `clean_breakout` decision finalization enables relaxed timing
- `wait` is mapped to `now`
- regression test proves `buy` rather than `skip`

### Phase 5 - Observability slice is implemented, integration proof remains deferred

Verified in:

- `electron/main/services/ai/pipeline-runtime/plan/phase/interpreter.ts:256-270,323-339`
- `electron/main/services/orchestration/cycle/scheduling/instrument-queue.ts:61-64`

What shipped matches the plan:

- selector `phase plan complete` logs include `acceptedCount`, `rejectedCount`, and `rejectionReasons`
- orchestrator logs `enqueueing trade cycles`

What remains:

- no repository test currently proves `trade.status === "open"` for the full mock rehearsal

## Tests Run

Executed:

```bash
bunx vitest run \
  electron/main/services/ai/engines/selector/selector-risk-filter.test.ts \
  electron/main/services/ai/__tests__/resolve-run-cost.test.ts \
  electron/main/services/ai/__tests__/run-agent-execute.test.ts \
  electron/main/services/broker/mock/mock-discovery-fixtures.test.ts \
  electron/main/services/ai/engines/aggregators/trade-signal-aggregator.test.ts \
  electron/main/services/ai/pipeline-runtime/__tests__/pipeline-spend-tracker.test.ts
```

Result:

- `6` test files passed
- `24` tests passed

## Conclusion

The implementation status in `docs/plans/mock-trade-rehearsal-fix-plan.md` is mostly accurate.

- Phases 0-4 are implemented correctly.
- Phase 5 is correctly marked partial.
- Phase 6 remains deferred.

The two meaningful follow-ups are:

1. remove the leftover duplicate cost-estimation fallback paths
2. add the missing end-to-end mock happy-path integration test

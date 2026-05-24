# Implementation Order

Four phases. Each is independently shippable and leaves the system in a valid state. Do not start a phase until the previous one is verified working.

---

## Phase 1 — Framework: Engine Registry + `AIPhase` Type Changes

**Status:** Implemented on 2026-05-23.

**Transitional deviation:** `AIPhase.finalize?` remains as an optional legacy fallback until the phase-specific finalizer engines are introduced in Phases 2-4. `AIPhaseRunner` resolves `finalizeEngineIds` first and only falls back to `finalize?` when no finalizer engine IDs are configured, preserving runnable behavior between phases.

**Goal:** The framework can resolve engine IDs. The `AIPhase` type has the new fields. Boot sequence is established. No phase files move yet.

**Why first:** Every subsequent phase depends on the engine registry existing and the `AIPhase` type accepting engine ID fields. Nothing else can be migrated until this is in place.

**Done when:**
- [x] `engines/registry.ts` exists with `registerEngine` / `resolveEngine`
- [x] `EngineKind` includes `"input"`, `"entry_mode"`, `"cache"`, `"finalizer"` (alongside existing kinds)
- [x] `AIPhase` type updated:
  - `inputBuilderIds` renamed to `inputEngineIds`
  - `cachePolicyId` renamed to `cacheEngineId`
  - `entryModes: readonly AIPhaseEntryMode[]` replaced by `entryEngineIds?: readonly string[]`
  - `finalizeEngineIds?: readonly string[]` added; `finalize?` remains temporarily for legacy phase definitions until Phases 2-4 complete
  - `inspect: AIPhaseMetadata` removed
  - `initialState()` made optional (default: `() => ({} as TState)`)
- [x] `phases/interpreter.ts` updated: resolves `inputEngineIds`, `entryEngineIds`, `cacheEngineId`, `finalizeEngineIds` from the phase definition. Tolerates empty/missing arrays gracefully. **Execution order changes:** entry modes before cache (reverses today's cache-first order). Target order: entry modes → cache → input → stages → finalizers → filter → aggregate assembly/persist → write cache.
- [x] `analysis-resolver.ts` updated: reads `inputEngineIds`, `cacheEngineId`, and `finalizeEngineIds` directly from the `AIPhase` object (no longer reads from `plan.inspect`)
- [x] `engines/index.ts` exists (empty imports for now)
- [x] `definitions/index.ts` manifest stub exists (empty ALL_PHASES for now)
- [x] `AIPhase` confirmed NOT in `@electron/shared` — run `grep -r "AIPhase" electron/shared/` before touching the type

**Type migration for existing phases:** All existing `AIPhase` objects (`SELECTOR_PLAN`, `TECHNICAL_PLAN`, etc.) must be updated to match the new type. Since all five phases are being migrated in subsequent phases anyway, the simplest approach is:
- `SELECTOR_PLAN` in `selector-analysis.ts`: rename fields, add `finalizeEngineIds: []` (empty for now — full migration in Phase 2)
- `TECHNICAL_PLAN`, `FUNDAMENTAL_PLAN`, `REVIEW_PLAN`, `DECISION_PLAN` in `aggregator-phase-plan.ts`: rename fields (factory output also updated)

**Rollback:** Revert type additions and registry files. No phase files moved.

---

## Phase 2 — Selector Migration

**Status:** Implemented on 2026-05-24.

**Transitional deviation:** `definitions/selector.phase.ts` exports `SELECTOR_PIPELINE_DEFINITION` alongside the executable `SELECTOR_PHASE` so `core/pipeline-registry.ts` can keep serving the shared `PipelineDefinition` catalog until the rest of the definition layer is adapted. The executable selector path uses `SELECTOR_PHASE`; the metadata bridge is not used for phase execution.

**Goal:** Selector is the first full proof of the system. All 8 scattered files collapse. All phase-level hooks become registered engines. `definitions/selector.phase.ts` is pure config.

**Why second:** Selector is the most scattered phase (multi-stage, direct calls in finalize, entry modes, cache, multiple input builders). If the pattern works for selector, it works for everything.

**Done when:**
- [x] `engines/input/selector-scope.ts` registered and referenced by ID
- [x] `engines/input/broker-coverage.ts` registered and referenced by ID
- [x] `engines/input/prediction-market-candidates.ts` registered and referenced by ID
- [x] `engines/entry-mode/manual-shortlist.ts` registered and referenced by ID
- [x] `engines/cache/selector-instrument-cache.ts` registered and referenced by ID
- [x] `engines/finalizer/selector-risk-filter.ts` registered (adapter over `signal/scoring/selector-risk-filter.ts`)
- [x] `engines/finalizer/selector-submission-builder.ts` registered (adapter over `signal/scoring/selector-submission-builder.ts`)
- [x] `definitions/selector.phase.ts` content fully replaced:
  - Zero imports from `signal/scoring/` for risk filter or submission builder (direct utility calls inside `applyResults()` are permitted)
  - Zero `finalize()` function
  - Zero `entryModes` array
  - `finalizeEngineIds: ["selector-risk-filter", "selector-submission-builder"]`
  - Stage `applyResults()` functions retained with direct calls to `mergeDiscoveryCandidates`, `scoreSelectorCandidates`, `applyVerificationResults`
- [x] `definitions/selector.schemas.ts` exists
- [x] `implementations/registry/input-builder-registry.ts` — selector input builder entries removed (or file deleted if now empty)
- [x] `implementations/registry/cache-policy-registry.ts` — selector cache policy entry removed (or file deleted if now empty)
- [x] All deleted:
  - `implementations/selector/selector-analysis.ts`
  - `implementations/selector/selector-schemas.ts` (content moved to `definitions/selector.schemas.ts`)
  - `implementations/inputs/selector-scope.ts`
  - `implementations/inputs/broker-coverage.ts`
  - `implementations/inputs/prediction-market-candidates.ts`
  - `implementations/inputs/manual-shortlist.ts`
  - `implementations/cache/selector-instrument-cache.ts`
  - `pipeline-discovery-config.ts` selector section removed
- [x] All existing selector tests pass

**Before starting:** 
- `grep -r "isManualSelectorMode\|manual-shortlist\|buildManualShortlistSelection" --include="*.ts"` — ensure no hidden callers outside selector-analysis
- `grep -r "selector-instrument-cache\|SELECTOR_INSTRUMENT_CACHE" --include="*.ts"` — same check
- `grep -r "selector-analysis" --include="*.ts"` — find all import sites before deleting

**Rollback:** Revert file moves. Tests are the net. Engine registrations are additive.

---

## Phase 3 — Technical + Fundamental + Delete Factory

**Status:** Implemented on 2026-05-23.

**Goal:** `pipeline-discovery-config.ts` is deleted. `createAggregatorAIPhase` factory is eliminated for technical and fundamental. Both phases are raw `AIPhase` definitions with inline worker arrays.

**Why third:** These two phases share the `pipeline-discovery-config.ts` problem. Migrating them together deletes the file in one shot.

**Done when:**
- [x] `engines/finalizer/technical-aggregator.ts` registered — adapter that calls `runEngineForWorker()` with `ENGINE_BINDINGS.technicalAggregatorFinalize` (LLM call, async)
- [x] `engines/finalizer/fundamental-aggregator.ts` registered — same pattern with `ENGINE_BINDINGS.fundamentalAggregatorFinalize`
- [x] `definitions/technical.phase.ts` content fully replaced:
  - Raw `AIPhase<AggregatorPlanState, TechnicalSignal>`
  - Workers inline (standard + event mode arrays)
  - `finalizeEngineIds: ["technical-aggregator"]`
  - Single stage with `resolveWorkers` ternary for discoveryMode
  - `applyResults()` stores worker results in state (same pattern as factory output)
- [x] `definitions/fundamental.phase.ts` content fully replaced — same pattern
- [x] `pipeline-discovery-config.ts` deleted entirely
- [x] `implementations/trade/phase-analyses.ts` — TECHNICAL_PLAN and FUNDAMENTAL_PLAN sections removed
- [x] `implementations/trade/aggregator-phase-plan.ts` NOT deleted yet (review + decision still use factory)
- [x] All tests pass

**Before starting:** 
- `grep -r "technicalWorkersForMode\|fundamentalWorkersForMode\|pipeline-discovery-config" --include="*.ts"` — find all callers
- `grep -r "signal/aggregators/technical\|signal/aggregators/fundamental" --include="*.ts"` — confirm no renderer imports before wrapping aggregators

**Rollback:** Revert file moves. Keep `pipeline-discovery-config.ts` until confirmed.

---

## Phase 4 — Review + Decision + Complete Teardown

**Status:** Implemented on 2026-05-23.

**Goal:** All five phases live in `definitions/` as real `AIPhase` configs. `implementations/trade/` is stripped of phase definitions. Factory is eliminated. Boot is manifest-driven.

**Done when:**
- [x] `engines/finalizer/review-aggregator.ts` registered (LLM-calling adapter)
- [x] `engines/finalizer/trade-signal-aggregator.ts` registered (LLM-calling adapter, mock scenario logic moved here from DECISION_PLAN)
- [x] `definitions/review.phase.ts` content fully replaced — raw `AIPhase`, workers inline (from existing `definitions/review.phase.ts` `PipelineDefinition` workers), `finalizeEngineIds: ["review-aggregator"]`
- [x] `definitions/decision.phase.ts` content fully replaced — raw `AIPhase`, workers inline, `finalizeEngineIds: ["trade-signal-aggregator"]`
- [x] `implementations/trade/phase-analyses.ts` deleted (all four sections migrated)
- [x] `implementations/trade/aggregator-phase-plan.ts` deleted (factory no longer needed)
- [x] `implementations/registry/cache-policy-registry.ts` deleted (now empty)
- [x] `implementations/registry/input-builder-registry.ts` deleted (now empty)
- [x] `implementations/registry/register-phases.ts` deleted — replaced by `definitions/index.ts`
- [x] `definitions/index.ts` finalized — all five phases in manifest
- [x] All tests pass

**Decision phase special case:** The mock scenario check in `DECISION_PLAN`:
```ts
const mockRelaxedEntryTiming =
  ctx.toolContext.isMockSession === true &&
  ctx.toolContext.mockScenarioKind === "clean_breakout";
```
This must be preserved. Move into `engines/finalizer/trade-signal-aggregator.ts` where it reads from `ctx.toolContext`. Do not silently drop. Verify the test that covers this scenario still passes.

**Rollback:** Revert file moves. Review + decision are the simplest phases — lowest risk.

---

## Success Checklist (All Phases Complete)

```bash
grep -r "pipeline-discovery-config" --include="*.ts"          # → 0 results
grep -r "createAggregatorAIPhase" --include="*.ts"             # → 0 results
grep -r "isManualSelectorMode" --include="*.ts"                # → 0 results
grep -r "implementations/selector/selector-analysis" --include="*.ts"  # → 0 results
grep -r "plan\.inspect\." --include="*.ts"                     # → 0 results (inspect field removed)
find . -path "*/implementations/selector" -type d              # → 0 results
find . -path "*/implementations/trade/phase-analyses*"         # → 0 results
find . -path "*/implementations/trade/aggregator-phase*"       # → 0 results
find . -name "register-phases.ts" -path "*/registry/*"         # → 0 results
cat definitions/selector.phase.ts | grep "finalize("           # → 0 results
wc -l definitions/index.ts                                     # → ≤ 15
```

Adding a new phase after this:
1. Create `definitions/[name].phase.ts` with `AIPhase<>` config
2. Add to `definitions/index.ts` manifest
3. Register any new engines in `engines/[kind]/` + import in `engines/index.ts`

Nothing else changes. The execution path is not touched.

# Definition-First Pipeline: Implementation Review

> **Date:** 2026-05-23  
> **Reviewer:** Claude (automated deep review)  
> **Scope:** All pipeline service files after Phases 1–4 implementation  
> **Updated:** 2026-05-23 — verified against current codebase; status badges reflect actual code state

---

## Summary

The core engine registry pattern is solid. `engines/registry.ts` is clean, `AIPhase<TState, TOutput>` is the right shape, and the interpreter correctly chains engines through the finalization sequence. Phase 2 (selector) and Phases 3–4 (trade phases) land in `definitions/` as declared. Engines are thin adapters, `signal/` files are untouched.

**Update:** All 19 issues resolved. The interpreter is data-driven, `phase-catalog.ts` derives workers directly from `AIPhase.resolveWorkersForMode` (no if-chain), `selector.phase.ts` has zero runtime imports from `signal/scoring/`, and all worker functions are private to their definition files.

---

## Gap Table: Plan Goals vs Reality

| Goal | Status | Notes |
|---|---|---|
| 1. Engine registry over direct invocation | ✅ Done | All phase hooks use registered engines |
| 2. Definitions are pure config | ✅ Done | Zero runtime imports from `signal/scoring/` in `selector.phase.ts`; one type-only import eliminated by re-exporting from `selector.helpers` |
| 3. New logic never touches execution path | ✅ Done | All 4 interpreter if-chains eliminated |
| 4. Uniform phase layout | ✅ Done | All 5 phases in `definitions/`, same structure |
| 5. Single source of truth per phase | ✅ Done | `phase-catalog.ts` derives workers from `AIPhase.resolveWorkersForMode` — same function the runtime calls; no if-chain |
| 6. New phase = 1-2 file operation | ✅ Done | 3 files: definition + all-phases.ts + engine; catalog and engines/index.ts need no changes |

---

## Critical Issues

### 1. `hasNonEmptyOutput` is hardcoded to selector's output shape

**Status: ✅ Fixed**

`CacheEngine` now has an optional `shouldWrite?(output: TOutput): boolean` guard (`engines/registry.ts:47`). The interpreter calls it as:

```ts
(cacheEngine.shouldWrite ? cacheEngine.shouldWrite(output) : output != null)
```

`selector-instrument-cache.ts` implements `shouldWrite` to check for non-empty `.instruments`. Other phases with a cache engine default to writing whenever output is non-null. Silent skip bug is gone.

---

### 2. `outputSchemaNameForPhase` is a hardcoded if-chain in the runtime

**Status: ✅ Fixed**

`outputSchemaName?: string` is declared on `AIPhase` (`phases/types.ts:75`). The interpreter reads it:

```ts
outputSchemaName: plan.outputSchemaName ?? plan.phase,
```

No if-chain. Each phase definition sets its own value (e.g., `TECHNICAL_PHASE` has `outputSchemaName: "technicalSignal"`).

---

### 3. Entry mode source is hardcoded in the interpreter

**Status: ✅ Fixed**

`source?: AIPhaseSource` is declared on `EntryModeEngine` (`engines/registry.ts:23`). The interpreter reads it:

```ts
source: entryEngine.source ?? "phase",
```

`manual-shortlist.ts` sets `source: "manual_shortlist"`. The two-variant string check (`"manual-shortlist"` vs `"manual_shortlist"`) is gone.

---

### 4. `summarizeSelectorDiagnostics` is selector-specific code in the runtime

**Status: ✅ Fixed**

`summarize?(output: unknown): Record<string, unknown>` is declared on `AIPhase` (`phases/types.ts:81`). The interpreter calls:

```ts
const diagnostics = plan.summarize?.(output);
```

The `SELECTOR_PHASE` sets `summarize` to the logic previously hardcoded as `summarizeSelectorDiagnostics`. The function is gone from the interpreter.

---

### 5. `selector.phase.ts` imports from `signal/scoring/` — Phase 2 done criteria violated

**Status: ✅ Fixed**

`SelectorCandidate` is now re-exported from `definitions/selector.helpers.ts` alongside the other helper types. `selector.phase.ts` imports it from `./selector.helpers` — zero imports from `signal/scoring/` remain in the definition file.

---

### 6. `parseWorkerToolTrace` is duplicated

**Status: ✅ Fixed**

`parseWorkerToolTrace` is now the canonical export of `definitions/selector.helpers.ts:25`. Both `selector.phase.ts` and `engines/finalizer/selector-submission-builder.ts` import from it. No duplication.

---

### 7. `resolveToolRequirementForWorker` duplicates requirements already on `WorkerDefinition`

**Status: ✅ Fixed**

`selector-submission-builder.ts` now reads `worker.toolRequirements` directly with a comment:

```ts
// toolRequirements is declared on the WorkerDefinition itself — use it directly.
worker.toolRequirements,
```

`resolveToolRequirementForWorker` is gone.

---

## Improvements

### 8. `phase-catalog.ts` is a second source of truth for workers

**Status: ✅ Fixed**

`AIPhase` now declares `resolveWorkersForMode?(discoveryMode: ResearchDiscoveryMode): readonly WorkerDefinition[]`. All five phases implement it. `phase-catalog.ts` builds a `PHASE_WORKER_RESOLVERS` map from the phase objects directly — no if-chain, no imports of individual worker functions. A `requireResolver()` guard throws at module load if a phase is missing the field.

The cross-validation test in `phase-definitions.test.ts` asserts that `resolvePhaseWorkers(phase, mode)` (catalog path) and `stages[0].resolveWorkers(ctx, state)` (runtime path) return identical worker IDs for every phase and mode.

---

### 9. `AggregatorPlanState` type is duplicated four times

**Status: ✅ Fixed**

`definitions/aggregator.types.ts` exists. `AggregatorPlanState` is `Record<string, never>` — intentionally empty (see also #10). All four trade phases import from it.

---

### 10. `state.workers` field in `AggregatorPlanState` is dead

**Status: ✅ Fixed**

`AggregatorPlanState` is now `Record<string, never>`. The `workers` field is gone. The doc comment in `aggregator.types.ts` explicitly states that state is empty and `workerResults` come via the finalizer's third parameter.

---

### 11. `workerResults` source is inconsistent across finalizer engines

**Status: ✅ Fixed**

`state.workerResults` no longer exists (state is empty). All finalizer engines use the `workerResults` third parameter. The contract is documented in `aggregator.types.ts`.

---

### 12. `isEventContractScan` is duplicated

**Status: ✅ Fixed**

Inlined as `discoveryMode === "event_contract_scan"` in both `technical.phase.ts:102` and `fundamental.phase.ts:103`. The trivial abstraction was removed rather than extracted.

---

### 13. No startup validation for engine IDs in phase definitions

**Status: ✅ Fixed**

`validatePhaseEngines()` is exported from `definitions/index.ts:38`. It iterates `ALL_PHASES` and calls `resolveEngine` for every `inputEngineId`, `entryEngineId`, `cacheEngineId`, and `finalizeEngineId`. Any typo throws at boot rather than at first phase execution.

---

### 14. `selectionInstructions` key is an implicit, untyped contract

**Status: ✅ Fixed**

`inputKey?: string` is declared on `AIPhase` (`phases/types.ts:68`). The interpreter uses:

```ts
const inputKey = input.plan.inputKey ?? "selectionInstructions";
```

The `AIPhase` doc comment explains the field's purpose and notes the default.

---

### 15. `analysis/interpreter.ts` and `phases/interpreter.ts` share logger name `"pipeline-runtime"`

**Status: ✅ Fixed**

- `phases/interpreter.ts:27` → `createLogger("pipeline-phase-runtime")`
- `analysis/interpreter.ts:14` → `createLogger("pipeline-cycle-runtime")`

Logs are now distinguishable by name.

---

## Suggestions

### 16. "New phase = 1-2 file operation" goal requires 5-7 file edits

**Status: ✅ Done — 3 files**

`AIPhase` now carries a `catalog` field (`outputMode`, `outputSchema`, `engines`, `traceMode`). Aggregator phase files import their finalizer engine as a side effect. `definitions/all-phases.ts` holds the authoritative phase list. `phase-catalog.ts` derives everything from `ALL_PHASES` — no hardcoded per-phase entries.

Minimum to add a new aggregator phase:

1. `definitions/[name].phase.ts` — AIPhase with `catalog`, `resolveWorkersForMode`, and a side-effect import of its finalizer engine
2. `definitions/all-phases.ts` — add to `ALL_PHASES`
3. `engines/finalizer/[name]-aggregator.ts` — the finalizer engine (self-registers via `registerEngine`)

`engines/index.ts` and `phase-catalog.ts` need no changes. The 3-file minimum matches the irreducible work: one for the new domain concept, one to register it, one for its implementation. Reaching 1-2 would require auto-discovery (e.g., filesystem scanning), which is not appropriate for this codebase.

---

### 17. Engine registry is global module state with no test isolation

**Status: ✅ Fixed**

`clearEngineRegistry()` is exported from `engines/registry.ts:90` with a doc comment marking it as test-only and warning against use in production. Tests can call it in `afterEach` to reset state.

---

### 18. Phase definitions export functions for catalog consumption — makes them feel like utility modules

**Status: ✅ Fixed**

`selectorDiscoveryWorkersForMode`, `technicalWorkersForMode`, `fundamentalWorkersForMode` are now private (unexported). `REVIEW_WORKERS` and `DECISION_WORKERS` are also unexported. The catalog imports the phase objects (`SELECTOR_PHASE`, etc.) and calls `resolveWorkersForMode` on them — no more reaching into definition internals.

---

### 19. `registerUnifiedPlanRef` is called without explanation

**Status: ✅ Fixed**

`definitions/index.ts:23–26` now has:

```ts
// Makes phase IDs appear in listAnalysisIds() alongside trade cycle analyses,
// so the analysis resolver can look up phases by their string ID the same way
// it looks up instrument analyses.
registerUnifiedPlanRef(phase.phase);
```

---

## What's Done Well

**Engine interface design is clean.** `InputEngine`, `EntryModeEngine`, `CacheEngine`, `FinalizerEngine` are well-typed, concise interfaces. The `resolveEngine<T>(id, kind)` pattern with kind checking is correct — a wrong-kind registration throws explicitly.

**Finalizer state threading is correct for selector.** `selector-risk-filter` runs first and produces `SelectorRiskFilterFinalizerResult` with `discoveredCount`/`verifiedCount`. `selector-submission-builder` receives that as its `state` parameter and uses those fields for diagnostics. The "last engine produces `TOutput`" contract from the plan's open question #1 is correctly implemented.

**Engines are genuinely thin adapters.** `technical-aggregator.ts`, `fundamental-aggregator.ts`, `review-aggregator.ts`, and `trade-signal-aggregator.ts` delegate immediately to `runEngineForWorker`. No business logic leaked into the adapters. Signal files untouched.

**Mock scenario logic correctly preserved.** Decision phase special case (`isMockSession && mockScenarioKind === "clean_breakout"`) moved into `trade-signal-aggregator.ts` exactly as the plan specified, reading from `ctx.toolContext`.

**Cache fingerprint is comprehensive.** `selector-instrument-cache.ts` builds a deterministic fingerprint from session state, selector settings, instrument classes, model config, search provider, and routing snapshot. Stable-stringifies with sorted keys. SHA-256 hash. The TTL logic per holding style is a nice touch.

**`pickWorkerOutput` is simple and correct** for the schema-reference-equality pattern — works as long as schemas are module singletons imported from the same path, which they are in this codebase.

**Phase 4 special case was not silently dropped.** The mock scenario check was explicitly preserved. Risk register item #5 was addressed.

**`selector.helpers.ts` is a clean extraction.** `parseWorkerToolTrace`, `applyDiscoveryResults`, `applyVerificationResults`, `scoreSelectorCandidates`, `summarizeSelectorOutput`, and `SelectorCandidate` are all in one place. Both `selector.phase.ts` and `selector-submission-builder.ts` import from it. `selector.phase.ts` has zero imports from `signal/scoring/`.

**`resolveWorkersForMode` closes the catalog/runtime gap.** Each `AIPhase` declares its own mode-to-workers mapping. The catalog, the effective config layer, and the runtime interpreter all converge on the same function — no if-chains, no duplicated imports of internal worker arrays.

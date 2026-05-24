# Definition-First Pipeline: Implementation Review

> **Date:** 2026-05-23  
> **Reviewer:** Claude (automated deep review)  
> **Scope:** All pipeline service files after Phases 1–4 implementation

---

## Summary

The core engine registry pattern is solid. `engines/registry.ts` is clean, `AIPhase<TState, TOutput>` is the right shape, and the interpreter correctly chains engines through the finalization sequence. Phase 2 (selector) and Phases 3–4 (trade phases) land in `definitions/` as declared. Engines are thin adapters, `signal/` files are untouched.

However, **three of the six plan goals are not fully met**:

- Goal 2 ("definitions are pure config") is violated by four helper functions living inside `selector.phase.ts`, `signal/scoring/` imports in the definition file, and phase definitions that export worker resolver functions for catalog consumption.
- Goal 3 ("new logic never touches the execution path") is violated by four selector-specific if-chains that remain hardcoded inside `phases/interpreter.ts`.
- Goal 6 ("new phase = 1-2 file operation") requires touching at least 5-7 files.

The `phase-catalog.ts` file creates a second source of truth for workers — the most important structural problem to resolve next.

---

## Critical Issues

### 1. `hasNonEmptyOutput` is hardcoded to selector's output shape

**File:** `phases/interpreter.ts:398–403`

```ts
function hasNonEmptyOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const instruments = (output as { instruments?: unknown[] }).instruments;
  return Array.isArray(instruments) && instruments.length > 0;
}
```

**What:** Checks for `.instruments` — selector's field. Every other phase's output has no `.instruments`. If any trade phase ever gets a `cacheEngineId`, this function returns false and the cache write is silently skipped. No error, no log.

**Why it matters:** Breaks cache writes for any non-selector phase. Silent. Will not be caught until a phase tries to use caching and you wonder why nothing is cached.

**Fix:** Push this check to the `CacheEngine` interface. Add an optional `shouldWrite?(output: unknown): boolean` to `CacheEngine`, or make the `write()` method responsible for deciding. Alternatively replace with a simple `output !== null && output !== undefined` — if the engine wrote it, it's probably worth caching.

---

### 2. `outputSchemaNameForPhase` is a hardcoded if-chain in the runtime

**File:** `phases/interpreter.ts:390–397`

```ts
function outputSchemaNameForPhase(phase: AIPhaseContext["phase"]): string {
  if (phase === "selector") return "instrumentSelection";
  if (phase === "technical") return "technicalSignal";
  if (phase === "fundamental") return "fundamentalSignal";
  if (phase === "review") return "reviewSignal";
  return "tradeSignal";
}
```

**What:** Adding a new phase requires modifying the interpreter. This is exactly the if-chain pattern the architecture was designed to eliminate.

**Why it matters:** Violates Goal 3. The interpreter is supposed to be a stable runtime that reads config — not a place where phase-specific knowledge accumulates.

**Fix:** Add `outputSchemaName?: string` to `AIPhase<TState, TOutput>` in `phases/types.ts`. Set it on each definition. The interpreter reads it from the plan — no switch needed.

---

### 3. Entry mode source is hardcoded in the interpreter

**File:** `phases/interpreter.ts:102–108`

```ts
source:
  entryEngineId === "manual-shortlist" ||
  entryEngineId === "manual_shortlist"
    ? "manual_shortlist"
    : "phase",
```

**What:** The interpreter knows the name of a specific engine and maps it to a specific `AIPhaseSource` value. This is hardcoded domain knowledge inside the runtime. There are even two variants of the same ID checked — which suggests this has already drifted.

**Why it matters:** Every new entry mode that should report a different `source` value requires modifying the interpreter. Violates Goal 3.

**Fix:** Add `source?: AIPhaseSource` to `EntryModeEngine`. The engine declares what source to report. The interpreter reads it: `source: entryEngine.source ?? "phase"`. The `manual-shortlist` engine sets `source: "manual_shortlist"`.

---

### 4. `summarizeSelectorDiagnostics` is selector-specific code in the runtime

**File:** `phases/interpreter.ts:414–430`

```ts
function summarizeSelectorDiagnostics(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object") return {};
  const diagnostics = (output as { diagnostics?: unknown }).diagnostics;
  // ...selector-specific field reads...
}
```

**What:** Phase-specific diagnostic extraction is hardcoded in the interpreter and called unconditionally for every phase log.

**Why it matters:** Another if-chain-in-waiting. New phases with structured diagnostics need to either add to this function or be ignored. Interpreter grows per-phase knowledge.

**Fix:** Add an optional `summarize?(output: unknown): Record<string, unknown>` to `AIPhase`. Call it in the log line if present. Move the selector diagnostic logic to `selector.phase.ts`.

---

### 5. `selector.phase.ts` imports from `signal/scoring/` — Phase 2 done criteria violated

**File:** `definitions/selector.phase.ts:9–13`

```ts
import { mergeDiscoveryCandidates, type SelectorCandidate } from "../../signal/scoring/selector-candidate-merger";
import { scoreCandidate } from "../../signal/scoring/selector-scoring-engine";
```

**What:** Phase 2 done criteria explicitly states: "definitions/selector.phase.ts has zero imports from signal/scoring/". This criterion is not met. Both imports are used inside `applyResults`, which is exempt from the engine registry rule — but the done criteria is unconditional.

**Why it matters:** Two interpretations, one contradicts the other. If "pure config" means no business logic imports, these need to move. If `applyResults` is exempt by design, the done criteria text is wrong and should be corrected. Either way, this is unresolved.

**Fix (path A — stricter):** Extract `applyDiscoveryResults` and `applyVerificationResults` into a `definitions/selector.helpers.ts` that the definition imports from. Keep `signal/scoring/` imports in helpers only. The definition file stays clean.

**Fix (path B — easier):** Correct the done criteria in the plan to reflect the `applyResults` exemption explicitly.

---

### 6. `parseWorkerToolTrace` is duplicated

**File A:** `definitions/selector.phase.ts:362–383`  
**File B:** `engines/finalizer/selector-submission-builder.ts:52–80`

**What:** Exact same parsing logic in two files. Neither imports from the other.

**Why it matters:** Bug fix in one won't propagate to the other. Already has diverged: `selector.phase.ts` maps the type to `SelectorCandidate["selectorTraces"]`, `selector-submission-builder.ts` uses an anonymous inline type. Same input, same algorithm, different caller-visible types.

**Fix:** Move `parseWorkerToolTrace` to a shared utility in `definitions/selector.helpers.ts` or `engines/finalizer/selector-trace-parser.ts`. Both import from it.

---

### 7. `resolveToolRequirementForWorker` duplicates requirements already on `WorkerDefinition`

**File:** `engines/finalizer/selector-submission-builder.ts:82–105`

```ts
function resolveToolRequirementForWorker(workerPrefix: string) {
  if (workerPrefix === "market-validator") {
    return { requiredAll: ["get_quote", "get_ohlcv"], minToolCalls: 2 } as const;
  }
  // ...
}
```

**What:** Tool requirements are already declared on each `WorkerDefinition` object (e.g., `toolRequirements: { requiredAll: ["get_quote", "get_ohlcv"], minToolCalls: 2 }`). This function re-declares them by string prefix as a fallback when the worker's own `toolRequirements` is undefined.

**Why it matters:** If a worker ID changes (e.g., `market-validator` → `market-validator-v2`), this fallback silently returns `undefined` and tool coverage reporting breaks without an error. The requirements are duplicated across two places with no enforcement that they stay in sync.

**Fix:** The `workerResults` passed to the engine already contain the `WorkerDefinition` with `toolRequirements`. Use that directly: `worker.toolRequirements ?? defaultCoverage()`. Remove `resolveToolRequirementForWorker` entirely.

---

## Improvements

### 8. `phase-catalog.ts` is a second source of truth for workers

**File:** `definitions/phase-catalog.ts`

**What:** A `PHASE_CATALOG` record maps every `PipelinePhase` to a `PipelineDefinition` with worker arrays, output schemas, and engine bindings. The workers in the catalog are resolved by calling the same `xxxWorkersForMode` functions that the `AIPhase` definitions use. `effective-ai-phase-config.ts` calls `listPipelineDefinitions()` → `resolvePhaseWorkers()` from this catalog to build the effective config shown to the renderer and used for validation.

This means:
- Execution uses workers from `AIPhase.stages[].resolveWorkers()` in `phases/interpreter.ts`
- Effective config uses workers from `resolvePhaseWorkers()` in `phase-catalog.ts`

Both call the same functions, so they're in sync today. But they're linked by convention, not by structure. A new phase with workers that don't go through `xxxWorkersForMode` would diverge silently.

**Why it matters:** Violates Goal 5 ("single source of truth per phase"). The plan explicitly says `pipeline-discovery-config.ts` should be deleted and workers should be inline in definitions. This new file recreates the same conceptual problem with a different name.

**Fix:** Derive the catalog from the phase definitions. `phase-catalog.ts` should read workers from `getAIPhase(phase)?.stages[0].resolveWorkers(...)` for a canonical discovery mode, or the catalog entries should be an explicit config layer that can be eliminated if `EffectivePipelineConfig` can pull workers from `AIPhase` directly. At minimum, add a test that asserts the catalog workers and the phase workers resolve identically for each mode.

---

### 9. `AggregatorPlanState` type is duplicated four times

**Files:** `definitions/technical.phase.ts:23–26`, `fundamental.phase.ts:23–26`, `review.phase.ts:23–26`, `decision.phase.ts:23–26`

```ts
export type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};
```

Same type, four separate declarations. Each also exports its own local `type WorkerResult = { worker: WorkerDefinition; result: LLMRunResult<unknown> }`.

**Fix:** Create `definitions/aggregator.types.ts` with `AggregatorPlanState` and `WorkerResult`. All four trade phases import from it.

---

### 10. `state.workers` field in `AggregatorPlanState` is dead

**Files:** All four trade phase definitions and their finalizer engines.

**What:** `AggregatorPlanState` carries a `workers` field that is populated in `applyResults` but never read by any finalizer engine. The finalizers only use `state.workerResults`. The `workers` field is set redundantly (for technical/fundamental, by calling `technicalWorkersForMode`/`fundamentalWorkersForMode` a second time during `applyResults`).

**Fix:** Remove the `workers` field from `AggregatorPlanState`. The `workerResults` array already contains `worker` on each entry — `state.workerResults[0].worker` is a `WorkerDefinition`. No information is lost.

---

### 11. `workerResults` source is inconsistent across finalizer engines

**What:** `FinalizerEngine.run` signature is `run(ctx, state, workerResults)`. But:
- `selector-submission-builder.ts` uses the `workerResults` parameter (framework-accumulated results)
- All four aggregator finalizers use `state.workerResults` (accumulated in `applyResults`)

Both contain the same data in practice, but the mechanism differs. A developer writing a new finalizer engine has no guidance on which to use, and could easily pick the wrong one.

**Fix:** Document the contract explicitly on `FinalizerEngine`. Or remove `state.workerResults` (fix #10) so there's only one source. Or remove the `workerResults` param and only use `state` (requires the aggregator pattern to be explicit).

---

### 12. `isEventContractScan` is duplicated

**File A:** `definitions/technical.phase.ts:104–106`  
**File B:** `definitions/fundamental.phase.ts:105–107`

Identical one-liner. Should be a shared utility or inline comparison (the function is trivially `discoveryMode === "event_contract_scan"` — the abstraction may not even be worth it).

**Fix:** Either inline it or move to a shared `definitions/phase-variants.ts`.

---

### 13. No startup validation for engine IDs in phase definitions

**What:** `assertValidPipelineDefinitionCatalog()` validates `PipelineDefinition` catalog eagerly at startup. But there's no equivalent that iterates `ALL_PHASES` and calls `resolveEngine(id, kind)` for every `inputEngineId`, `entryEngineId`, `cacheEngineId`, and `finalizeEngineId`. A typo in any of these IDs only fails at runtime when the phase actually runs.

**Fix:** Add a `validateAllPhaseEngines()` function in `definitions/index.ts` that resolves every engine ID from every phase. Call it after `registerAllPhases()` in the boot sequence (or as part of the existing `assertValidPipelineDefinitionCatalog` call chain).

---

### 14. `selectionInstructions` key is an implicit, untyped contract

**File:** `phases/interpreter.ts:145`

```ts
ctx.input.selectionInstructions = sections.join("\n\n");
```

**What:** All input engines produce text that gets concatenated and stored under the hardcoded key `"selectionInstructions"`. The selector phase's `buildTask` then reads this key. This is an implicit convention with no type enforcement. If another phase added `inputEngineIds`, the interpreter would also write to `selectionInstructions` — which may not be the right key for that phase.

**Why it matters:** The `InputEngine` interface is declared as general-purpose (`kind: "input"`) but is only usable for selector today. The framework gives a false sense that input engines work for any phase.

**Fix (option A — honest):** Add `inputKey?: string` to `AIPhase` so each phase declares what key its input engines write to. Default to `"selectionInstructions"` for selector.

**Fix (option B — simpler):** If input engines are intentionally selector-only, rename the engine kind to `"selector_input"` and document that constraint. Prevents other phases from accidentally using it with wrong expectations.

---

### 15. `analysis/interpreter.ts` and `phases/interpreter.ts` share logger name `"pipeline-runtime"`

**File A:** `analysis/interpreter.ts:14`  
**File B:** `phases/interpreter.ts:27`

```ts
const logger = createLogger("pipeline-runtime");
```

**What:** Logs from two different execution classes are indistinguishable. "phase plan start" vs "cycle plan start" are different strings, but filtering by logger name won't differentiate them.

**Fix:** Use `"pipeline-phase-runtime"` for `phases/interpreter.ts` and `"pipeline-cycle-runtime"` for `analysis/interpreter.ts`.

---

## Suggestions

### 16. "New phase = 1-2 file operation" goal requires 5-7 file edits

**What:** Plan Goal 6 says adding a new phase should require creating `definitions/[name].phase.ts` + one line in `definitions/index.ts`. In reality, adding a phase with any finalizer currently requires:

1. `definitions/[name].phase.ts` — new file
2. `definitions/index.ts` — add to `ALL_PHASES`
3. `engines/finalizer/[name]-aggregator.ts` — new engine file
4. `engines/index.ts` — add import
5. `phases/interpreter.ts` — add to `outputSchemaNameForPhase()` switch
6. `definitions/phase-catalog.ts` — add catalog entry and worker resolver
7. Possibly `core/pipeline-registry.ts` — add `PipelineDefinition`

Fixes #2 and #8 together bring this down to ~3-4 files. Fix #2 alone eliminates the interpreter touch.

---

### 17. Engine registry is global module state with no test isolation

**File:** `engines/registry.ts:55`

```ts
const ENGINES = new Map<string, Engine>();
```

**What:** Module-level singleton. Once registered, engines persist for the entire test process. Importing `engines/index.ts` is a side effect. Tests that call `registerAllPhases()` accumulate all engines globally. If a test overrides an engine (e.g., a mock), it contaminates subsequent tests.

**Fix:** Export a `clearEngineRegistry()` in test environments, or accept a registry parameter in `resolveEngine`/`registerEngine` (inversion of control). At minimum, document this behavior so tests know to import in a specific order.

---

### 18. Phase definitions export functions for catalog consumption — makes them feel like utility modules

**Files:** `selector.phase.ts:143–149` (`selectorDiscoveryWorkersForMode`), `technical.phase.ts:108–113` (`technicalWorkersForMode`), `fundamental.phase.ts:109–114` (`fundamentalWorkersForMode`)

**What:** These functions are exported solely because `phase-catalog.ts` needs them. If `phase-catalog.ts` were removed (fix #8), these exports have no callers outside their own file. Exporting them makes the definition files feel like worker utility modules rather than pure configs.

**Fix:** Fix #8 first. Then make the worker arrays or functions unexported (private to the definition module).

---

### 19. `registerUnifiedPlanRef` is called without explanation

**File:** `definitions/index.ts:23`

```ts
export function registerAllPhases(): void {
  for (const phase of ALL_PHASES) {
    registerAIPhase(phase);
    registerUnifiedPlanRef(phase.phase); // ← why?
  }
}
```

**What:** `registerUnifiedPlanRef` adds the phase ID to `UNIFIED_PLAN_IDS` in `analysis-resolver.ts`, which is used in `listAnalysisIds()`. This is a backwards-compat bridge — phases are listed alongside trade-cycle analyses. Without a comment, developers will not know why phases are registered twice.

**Fix:** Add a one-line comment: `// Makes phase IDs appear in listAnalysisIds() alongside trade cycle analyses.`

---

## What's Done Well

**Engine interface design is clean.** `InputEngine`, `EntryModeEngine`, `CacheEngine`, `FinalizerEngine` are well-typed, concise interfaces. The `resolveEngine<T>(id, kind)` pattern with kind checking is correct — a wrong-kind registration throws explicitly.

**Finalizer state threading is correct for selector.** `selector-risk-filter` runs first and produces `SelectorRiskFilterFinalizerResult` with `discoveredCount`/`verifiedCount`. `selector-submission-builder` receives that as its `state` parameter and uses those fields for diagnostics. The "last engine produces `TOutput`" contract from the plan's open question #1 is correctly implemented.

**Engines are genuinely thin adapters.** `technical-aggregator.ts`, `fundamental-aggregator.ts`, `review-aggregator.ts`, and `trade-signal-aggregator.ts` delegate immediately to `runEngineForWorker`. No business logic leaked into the adapters. Signal files untouched.

**Mock scenario logic correctly preserved.** Decision phase special case (`isMockSession && mockScenarioKind === "clean_breakout"`) moved into `trade-signal-aggregator.ts` exactly as the plan specified, reading from `ctx.toolContext`.

**Cache fingerprint is comprehensive.** `selector-instrument-cache.ts` builds a deterministic fingerprint from session state, selector settings, instrument classes, model config, search provider, and routing snapshot. Stable-stringifies with sorted keys. SHA-256 hash. The TTL logic per holding style is a nice touch.

**`pickWorkerOutput` is simple and correct** for the schema-reference-equality pattern — works as long as schemas are module singletons imported from the same path, which they are in this codebase.

**Phase 4 special case was not silently dropped.** The mock scenario check was explicitly preserved. Risk register item #5 was addressed.

---

## Gap Table: Plan Goals vs Reality

| Goal | Status | Notes |
|---|---|---|
| 1. Engine registry over direct invocation | ✅ Done | All phase hooks use registered engines |
| 2. Definitions are pure config | ⚠️ Partial | `signal/scoring/` imports in selector.phase.ts; private helpers inside definition; functions exported for catalog |
| 3. New logic never touches execution path | ❌ Not met | 4 selector-specific if-chains in `interpreter.ts` |
| 4. Uniform phase layout | ✅ Done | All 5 phases in `definitions/`, same structure |
| 5. Single source of truth per phase | ⚠️ Partial | `phase-catalog.ts` duplicates worker declarations |
| 6. New phase = 1-2 file operation | ❌ Not met | 5-7 files minimum today |

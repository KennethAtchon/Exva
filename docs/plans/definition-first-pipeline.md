# Definition-First Pipeline Architecture — Plan

> **Date:** 2026-05-23
> **Status:** Complete (Phases 1–4 implemented)
> **Deciders:** Kenneth

---

## 1. Problem Statement

The pipeline system conflates two separate concerns: **what a phase does** (its definition) and **how the framework executes it** (the runtime). Because there is no clear boundary between them, every time a phase needs new business logic the instinct is to add a file and call it directly from inside the phase's execution flow. That creates `if` chains. Selector needs broker coverage context → add `broker-coverage.ts`, call it in selector's input assembly. Selector needs a manual shortlist bypass → add `manual-shortlist.ts`, add an `if (isManualSelectorMode)` check. Selector needs scoring → call `scoreCandidate()` directly inside `finalize()`. Each of these is a new hardcoded dependency injected into the execution path rather than a capability the framework knows about.

The `if` chain is the symptom. The root cause is that business logic is being added **to** the phase's execution flow instead of being registered **into** the framework and referenced from the phase's definition. The framework already partially demonstrates the right pattern: `ENGINE_BINDINGS.riskSummaryRead`, `ENGINE_BINDINGS.technicalAggregatorFinalize` are named engine references declared on definitions. Workers don't call those engines directly — they reference them by ID and the runtime resolves and invokes them. This is correct. The problem is that input providers, cache policy, entry modes, and finalization logic in selector do not follow this same pattern. They are direct function calls, not registered capabilities.

The system also has no coherent model for where a phase's parts live. There is a `definitions/` folder, an `implementations/` folder, a `pipeline-discovery-config.ts` file, a shared `implementations/inputs/` folder, a shared `implementations/cache/` folder, and an imperative `register-phases.ts` boot file. None of these is authoritative for any single phase. The result: understanding or extending any phase requires reading across all of these locations simultaneously, and adding new logic means finding the right execution path and inserting another call.

The fix must address both problems together. The framework needs a well-defined engine registry that any phase-level concern can be registered into — input context, cache policy, entry modes, finalization logic. The phase definition then becomes a pure config object: a list of IDs that declare what the framework should invoke, with no imperative logic in the execution path. New business logic = register a new engine, reference its ID on the definition. The execution path never changes. No new `if` clauses.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                | Success Looks Like                                                                                                                               |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Engine registry over direct invocation              | All phase-level hooks (input context, entry modes, cache policy, finalization) are registered engines referenced by ID on definitions            |
| 2   | Phase definitions are pure config                   | A phase definition declares which engine IDs to invoke and which workers to run — no imperative logic, no direct function calls to business logic |
| 3   | New business logic never touches the execution path | Adding a new capability = register an engine + add its ID to a definition. The runtime never changes. No new `if` clauses.                       |
| 4   | Uniform phase layout across all five phases         | Every phase follows the same directory and file structure; no phase has special folders or special-case files                                    |
| 5   | Single source of truth per phase                    | Every question about a phase (workers, inputs, entry modes, engines, cache) is answered by reading one file                                      |
| 6   | Adding a new phase is a 1–2 file operation       | Create `definitions/[name].phase.ts` (+ optional `[name].schemas.ts`) and add one line to `definitions/index.ts`. Nothing else. |

**Non-Goals**

| #   | Non-Goal                                                                          | Reason                                                                                                             |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Rewriting the execution engine (`phases/interpreter.ts`, `worker-graph-scheduler`) | Out of scope; this is about definition organization. The runtime gains engine resolution; its core mechanics don't change. |
| 2   | Changing how workers execute or what tools they use                               | Worker behavior is unchanged; only where they are declared moves                                                   |
| 3   | Eliminating the `AIPhase` / `PipelineDefinition` type distinction in shared types | The shared package is consumed by the renderer; keep the blast radius small                                        |
| 4   | Auto-discovery of phase files at startup                                          | File-based auto-discovery adds complexity; explicit manifest is fine as long as there is only one place to edit it |
| 5   | Moving `signal/scoring/` and `signal/aggregators/` files                          | These files are well-tested standalone units. Engines wrap them; files stay in place.                              |

---

## 3. Background & Context

### Current layout (pipeline service)

The pipeline service lives at `electron/main/services/pipeline/`. The relevant parts:

```
pipeline/
  phases/                           ← Runtime. Already exists. Runs one AI phase: fans out workers,
    interpreter.ts                     collects outputs, handles cache and entry modes.
    registry.ts                        UNCHANGED by this refactor except to resolve engine IDs.
    services.ts
    types.ts

  definitions/                      ← Config layer. Already exists. Currently dead stubs.
    selector.phase.ts                  22-line stub, never used for execution.
    technical.phase.ts
    fundamental.phase.ts
    review.phase.ts
    decision.phase.ts

  pipeline-discovery-config.ts      ← Worker arrays for selector + technical + fundamental
                                       (3 phases, 2 modes each = 6 worker arrays + 3 resolver functions)

  implementations/
    inputs/
      selector-scope.ts             ← selector only
      broker-coverage.ts            ← selector only
      prediction-market-candidates.ts  ← selector only
      manual-shortlist.ts           ← selector only, not an InputBuilder, just functions
      trade-engine-input-builders.ts   ← trade cycle concern (NOT a phase input engine)

    selector/
      selector-analysis.ts          ← the real AIPhase<> definition (~400 lines)
      selector-schemas.ts

    trade/
      phase-analyses.ts             ← AIPhase<> for technical/fundamental/review/decision via factory
      aggregator-phase-plan.ts      ← createAggregatorAIPhase() factory
      default-analysis.ts           ← instrument analysis (trade cycle) — not a phase definition
      default-analysis-steps.ts     ← instrument analysis (trade cycle) — not a phase definition

    registry/
      register-phases.ts            ← imperative boot wiring
      register-analyses.ts          ← registers trade cycle analyses — NOT part of this refactor
      cache-policy-registry.ts      ← replaced by engines/registry.ts (cache kind)
      input-builder-registry.ts     ← replaced by engines/registry.ts (input kind)
      analysis-resolver.ts          ← resolves both phase plans and trade cycle plans — survives
      analysis-dispatcher.ts        ← survives
      analysis-kinds.ts             ← survives

    cache/
      selector-instrument-cache.ts  ← selector only

  signal/  [OUTSIDE pipeline/, at electron/main/services/signal/]
    scoring/
      selector-candidate-merger.ts  ← called in selector discovery stage applyResults()
      selector-scoring-engine.ts    ← called in both selector stage applyResults() functions
      selector-risk-filter.ts       ← called in selector finalize()
      selector-submission-builder.ts ← called in selector finalize()
    aggregators/
      technical-aggregator.ts       ← LLM call, called from TECHNICAL_PLAN finalize()
      fundamental-aggregator.ts     ← LLM call, called from FUNDAMENTAL_PLAN finalize()
      review-aggregator.ts          ← LLM call, called from REVIEW_PLAN finalize()
      trade-signal-aggregator.ts    ← LLM call, called from DECISION_PLAN finalize()
```

### What `phases/` is — and is not

`phases/` is the **runtime layer**. It executes phases. It is NOT for phase definitions. The `phases/interpreter.ts` (`AIPhaseRunner`) is the main execution engine: it resolves entry modes, builds input, runs stages, calls `finalize()`, handles cache. After this refactor, it additionally resolves `inputEngineIds`, `entryEngineIds`, `cacheEngineId`, and `finalizeEngineIds` from the phase definition.

`definitions/` is the **config layer**. It declares what each phase IS. Currently the files there are dead stubs (`PipelineDefinition<>` type, never used for execution). After this refactor they become real `AIPhase<>` definitions with engine ID references.

Do not confuse these two. The refactor moves config into `definitions/`. It does not change what `phases/` does.

### The two-type problem

`PipelineDefinition<TInput, TOutput>` is the shared type from `@electron/shared/ai/ai-phase`. It lives in `definitions/` and is used by the renderer for phase metadata. `AIPhase<TState, TOutput>` is the runtime type from `phases/types.ts`, used by `AIPhaseRunner` for execution.

For technical/fundamental/review/decision, the workers declared in `PipelineDefinition` are used by the `AIPhase` in `implementations/trade/phase-analyses.ts`. For selector, the `PipelineDefinition` in `definitions/selector.phase.ts` is never referenced during execution — `SELECTOR_PLAN` (the `AIPhase`) resolves workers directly from `pipeline-discovery-config.ts` functions.

This means `definitions/selector.phase.ts` exists only to satisfy the type structure of the definitions folder, not because it does anything.

### What changes on the `AIPhase` type

The current `AIPhase<TState, TOutput>` has these fields:

| Field | Status after refactor | Notes |
|---|---|---|
| `phase` | **Unchanged** | |
| `inputBuilderIds?: readonly string[]` | **Renamed** to `inputEngineIds` | Already uses ID pattern; moves to engine registry |
| `cachePolicyId?: string` | **Renamed** to `cacheEngineId` | Already uses ID pattern; moves to engine registry |
| `entryModes: readonly AIPhaseEntryMode[]` | **Replaced** by `entryEngineIds?: readonly string[]` | Object array → ID array |
| `initialState(ctx): TState` | **Kept** as optional function | Structural state shape setup, not business logic. Default: `() => ({} as TState)` |
| `stages: readonly AIWorkerBatch<TState>[]` | **Unchanged** | Worker stages, including `applyResults()` — see note below |
| `finalize(ctx, state, traces)` | **Replaced** by `finalizeEngineIds?: readonly string[]` | Direct function calls in finalize are the problem |
| `filterOutput?(output, ctx): TOutput` | **Kept** as optional function | Post-output filter, lightweight |
| `persistAggregate?: boolean` | **Unchanged** | |
| `inspect: AIPhaseMetadata` | **Removed** | Redundant once engine IDs are first-class fields; `analysis-resolver.ts` reads fields directly |

**`applyResults()` on `AIWorkerBatch` is NOT subject to the engine registry rule.** It is stage-local state transformation — the stage accumulates worker results into the phase state. Direct utility function calls inside `applyResults()` are fine. The engine registry applies to phase-level hooks only: input context, entry modes, cache, and finalization.

### The engine registry pattern — what it means in practice

**Engine kinds:**

| Kind         | Current state                                                                               | Target state                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `input`      | Direct call: `buildCompositeInput(inputBuilderIds, ...)` via separate registry             | Registered in `engines/registry.ts` as `kind: "input"`; `inputBuilderIds` renamed to `inputEngineIds`               |
| `entry_mode` | Direct call: `if (entryMode.matches(ctx))` iterating inline objects in `entryModes` array  | Registered in `engines/registry.ts` as `kind: "entry_mode"`; `entryModes` array replaced by `entryEngineIds`        |
| `cache`      | Direct call: `getCachePolicy(cachePolicyId)` via separate registry                         | Registered in `engines/registry.ts` as `kind: "cache"`; `cachePolicyId` renamed to `cacheEngineId`                  |
| `finalizer`  | Direct call: `SelectorRiskFilter`, `buildInstrumentSelection()` in `finalize()`            | Registered as `kind: "finalizer"`; `finalize()` replaced by `finalizeEngineIds`                                      |
| `context`    | `ENGINE_BINDINGS.riskSummaryRead` — already correct pattern                                | Unchanged                                                                                                            |

**What the phase definition looks like with all direct calls replaced by engine IDs:**

```ts
// definitions/selector.phase.ts
export const SELECTOR_PHASE: AIPhase<SelectorPlanState, InstrumentSelection> = {
  phase: "selector",

  // Framework resolves these from engines/input/ and concatenates into worker prompt context
  inputEngineIds: ["selector-scope", "broker-coverage", "prediction-market-candidates"],

  // Framework checks these in order before running stages; first match short-circuits
  entryEngineIds: ["manual-shortlist"],

  // Framework handles cache read before stages, cache write after finalize
  cacheEngineId: "selector-instrument-cache",

  // Workers declared explicitly — no factory, no separate config file
  stages: [
    {
      id: "discovery",
      frontier: 0,
      resolveWorkers: (ctx) =>
        ctx.strategyContext.researchPosture.discoveryMode === "event_contract_scan"
          ? EVENT_SELECTOR_DISCOVERY
          : STANDARD_SELECTOR_DISCOVERY,
      buildTask: (ctx) => ({
        selectionInstructions: ctx.input.selectionInstructions,
        instrumentClasses: ctx.instrumentClasses,
        discoveryMode: ctx.strategyContext.researchPosture.discoveryMode,
      }),
      concurrency: 3,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults: (ctx, state, results) => {
        // applyResults is stage-local — direct utility calls are fine here
        const merged = mergeDiscoveryCandidates(results);
        const scored = scoreSelectorCandidates(merged);
        return { ...state, candidatesForVerification: scored.slice(0, 5) };
      },
    },
    {
      id: "verification",
      frontier: 1,
      resolveWorkers: (_ctx, state) =>
        state.candidatesForVerification.flatMap(verificationWorkers),
      buildTask: (_ctx, state, worker) => {
        const symbol = worker.id.split(":")[1] ?? "";
        const candidate = state.candidatesForVerification.find(c => c.symbol === symbol);
        return { selectionInstructions: state.selectionInstructions, candidate };
      },
      concurrency: 4,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults: (_ctx, state, results) => {
        const verified = applyVerificationResults(state.candidatesForVerification, results);
        return { ...state, verifiedCandidates: scoreSelectorCandidates(verified) };
      },
    },
  ],

  // Framework invokes registered finalizer engines in declared order after all stages complete
  finalizeEngineIds: ["selector-risk-filter", "selector-submission-builder"],
};
```

Note: `candidate-merger` and `selector-scoring` are NOT in `finalizeEngineIds`. They run inside stage `applyResults()` — that is the correct place for them. The plan's finalizer engines are only for the `finalize()` replacement: risk filtering and output assembly. `assembleAggregateTrace()` is a framework concern handled by `AIPhaseRunner` after finalize.

**The rule:**

> If you're about to add a function call inside a phase's **phase-level hook** (`finalize`, entry modes, cache, inputs), stop. Register it as an engine. Reference the ID. Stage-local `applyResults()` calls are exempt.

### Signal files stay in place — engines are adapters

`signal/scoring/` and `signal/aggregators/` files are well-tested standalone units. They do not move. Engine files in `engines/finalizer/` are thin adapters that import from `signal/` and implement the engine interface:

```ts
// engines/finalizer/selector-risk-filter.ts
import { SelectorRiskFilter } from "../../../signal/scoring/selector-risk-filter";
import type { SelectorCandidate, SelectorPlanState } from "../../definitions/selector.schemas";

function buildSelectorEvidence(candidate: SelectorCandidate): SelectorEvidence { ... } // moved from selector-analysis.ts

registerEngine<FinalizerEngine>({
  id: "selector-risk-filter",
  kind: "finalizer",
  async run(ctx, state) {
    const withEvidence = state.verifiedCandidates.map(c => ({
      ...c, selectorEvidence: buildSelectorEvidence(c),
    }));
    return new SelectorRiskFilter({ ... ctx ... }).evaluate(withEvidence);
  },
});
```

This preserves all existing tests for `signal/` logic. The adapter is the only new file.

For technical/fundamental/review/decision, the aggregator finalizer engines call `runEngineForWorker()` (LLM call) internally, same as the current `finalize()` does. The engine wraps the LLM invocation — it's not a pure transformation.

---

## 4. Research Summary

**Domain-driven module organization (feature co-location)**

The mainstream pattern in large TypeScript codebases (NestJS, tRPC, Nx, large Next.js) is to co-locate everything that belongs to a feature together rather than organizing by layer (controllers/, services/, types/). The Screaming Architecture principle says the folder structure should shout what the system does, not how it is technically organized. Every framework/community post-mortem on "why our codebase became a mess" cites layer-first organization (all inputs/ together, all caches/ together) as the root cause of the same scatter problem described above.

Key insight: if adding selector capability requires touching six folders, the system is organized by layer, not by feature. The solution is to invert: each phase is a feature, and everything it needs lives with it.

Sources: [Martin Fowler — Presentation Domain Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html), [Screaming Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html)

**Config-driven plugin architectures**

Redux's `createSlice`, Zustand's slice pattern, and tRPC's router/procedure composition all follow the same principle: a single configuration object is the complete definition of a feature's behavior. The runtime reads the config and derives everything — no external registration, no parallel type hierarchies. The key insight applied here is that `AIPhase<TState, TOutput>` is already close to a slice: it has state shape, stages, finalizer. The missing piece is that input providers and cache policy are registered separately rather than declared on the object.

Sources: [Redux Toolkit createSlice docs](https://redux-toolkit.js.org/api/createSlice), [tRPC router composition](https://trpc.io/docs/server/routers)

**Entry modes / strategy pattern for phase short-circuit**

The current `entryModes` array on `AIPhase` is a correct pattern — it's essentially a chain-of-responsibility where the first matching mode short-circuits execution. The problem is that the `manual_shortlist` mode is not self-contained in the phase definition; it imports utility functions from a separate file that has no other purpose. The right pattern is to promote the entry mode to a registered engine in `engines/entry-mode/` and reference it by ID. The phase definition owns nothing; it only references.

---

## 5. Options Considered

---

**Option A: Status Quo**

Keep the current structure unchanged. Continue adding phase-specific files to the shared `inputs/` and `cache/` folders as complexity grows.

| Dimension      | Assessment                  |
| -------------- | --------------------------- |
| Complexity     | Low — no change             |
| Performance    | No change                   |
| Reliability    | No change                   |
| Cost           | 0 engineering time          |
| Reversibility  | N/A                         |
| Stack fit      | Matches current conventions |
| Team readiness | N/A                         |

Risks:

- **Decision phase sprawl (High likelihood, High impact):** Decision phase is already described as the next candidate for multi-stage complexity. When that happens, it will add `implementations/decision/`, more input builders in `inputs/`, more entries in `register-phases.ts`. The pattern compounds.
- **Onboarding friction (Certain, Medium impact):** Any new developer must reverse-engineer the same six-file graph. There is no authoritative file for any phase.

---

**Option B: Consolidate selector only**

Merge `selector-analysis.ts` into `definitions/selector.phase.ts`. Move the selector-specific input builders into the same file or a co-located subfolder. Kill `implementations/selector/` and the four isolated input builder files.

| Dimension      | Assessment                                    |
| -------------- | --------------------------------------------- |
| Complexity     | Low-Medium — one phase moved, no type changes |
| Performance    | No change                                     |
| Reliability    | Low risk — moving declarations, not logic     |
| Cost           | ~1 day                                        |
| Reversibility  | Easy to reverse                               |
| Stack fit      | Partially improves definitions/ consistency   |
| Team readiness | Any TS developer can execute this             |

Risks:

- **Doesn't solve the pattern (Certain, Medium impact):** Decision phase will eventually sprawl the same way. This is a one-time fix, not a system change.

---

**Option C: Engine-registry + definition-first architecture (Recommended)**

Two-layer system. **Layer 1 — engines:** all business logic the framework invokes lives in `engines/`, organized by kind, with no phase ownership. **Layer 2 — definitions:** pure config objects that declare which engine IDs to invoke and which workers to run.

**Target folder layout:**

```
pipeline/
  phases/                           ← Runtime. Unchanged except engine resolution added.
    interpreter.ts                     Reads inputEngineIds, entryEngineIds, cacheEngineId,
    registry.ts                        finalizeEngineIds from the phase definition and resolves them.
    services.ts
    types.ts

  definitions/                      ← Config. AIPhase<> declarations for all five phases.
    selector.phase.ts               ← engine IDs + worker stages. Zero business logic.
    selector.schemas.ts             ← zod schemas for worker output
    technical.phase.ts
    fundamental.phase.ts
    review.phase.ts
    decision.phase.ts
    index.ts                        ← manifest: ALL_PHASES + boot registration

  engines/                          ← Business logic. Organized by kind. No phase ownership.
    registry.ts                     ← register/resolve engine by kind + ID
    input/
      selector-scope.ts
      broker-coverage.ts
      prediction-market-candidates.ts
    entry-mode/
      manual-shortlist.ts
    cache/
      selector-instrument-cache.ts
    finalizer/
      selector-risk-filter.ts       ← adapter: imports from signal/scoring/selector-risk-filter
      selector-submission-builder.ts ← adapter: imports from signal/scoring/selector-submission-builder
      technical-aggregator.ts       ← adapter: calls runEngineForWorker + ENGINE_BINDINGS.technicalAggregatorFinalize
      fundamental-aggregator.ts
      review-aggregator.ts
      trade-signal-aggregator.ts
    index.ts                        ← imports all engine files (side-effect: self-register)

  # Worker-level context engines (ENGINE_BINDINGS.riskSummaryRead, etc.) stay in
  # services/signal/registry/ — NOT moved into pipeline/engines/

  core/                             ← Scheduling machinery. Unchanged.
    concurrent-group-runner.ts
    pipeline-registry.ts
    pipeline-runtime.ts
    types.ts
    worker-graph-scheduler.ts

  execution/                        ← Unchanged
  prompting/                        ← Unchanged
  worker-tools/                     ← Unchanged
  worker-prompts.ts                 ← Unchanged

  implementations/
    inputs/
      trade-engine-input-builders.ts ← trade cycle concern, NOT moved — stays here
    registry/
      register-analyses.ts          ← registers trade cycle analyses — NOT part of this refactor
      analysis-resolver.ts          ← updated to read new AIPhase fields directly (no inspect)
      analysis-dispatcher.ts        ← unchanged
      analysis-kinds.ts             ← updated: inputBuilderIds → inputEngineIds in metadata
    trade/
      default-analysis.ts           ← instrument analysis (trade cycle) — NOT touched
      default-analysis-steps.ts     ← instrument analysis (trade cycle) — NOT touched
```

**What changes for every file (complete migration map):**

| Current file                                             | Destination                                              | Notes                                                          |
| -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| `definitions/selector.phase.ts`                          | **Replaced** (same path, new content)                    | Dead stub → real AIPhase with engine IDs; file stays at same path |
| `definitions/technical.phase.ts`                         | **Replaced** (same path, new content)                    | PipelineDefinition stub → real AIPhase with workers inline    |
| `definitions/fundamental.phase.ts`                       | **Replaced** (same path, new content)                    | Same pattern as technical                                      |
| `definitions/review.phase.ts`                            | **Replaced** (same path, new content)                    | Already had workers; rewrite as AIPhase                        |
| `definitions/decision.phase.ts`                          | **Replaced** (same path, new content)                    | Same; mock scenario logic addressed explicitly                 |
| `implementations/selector/selector-analysis.ts`          | **Deleted**                                              | Content moves to definitions/selector.phase.ts + engines/      |
| `implementations/selector/selector-schemas.ts`           | **Moved** → `definitions/selector.schemas.ts`            |                                                                |
| `implementations/inputs/selector-scope.ts`               | **Moved** → `engines/input/selector-scope.ts`            |                                                                |
| `implementations/inputs/broker-coverage.ts`              | **Moved** → `engines/input/broker-coverage.ts`           |                                                                |
| `implementations/inputs/prediction-market-candidates.ts` | **Moved** → `engines/input/prediction-market-candidates.ts` |                                                             |
| `implementations/inputs/manual-shortlist.ts`             | **Moved** → `engines/entry-mode/manual-shortlist.ts`     | Promoted to EntryModeEngine                                    |
| `implementations/cache/selector-instrument-cache.ts`     | **Moved** → `engines/cache/selector-instrument-cache.ts` |                                                                |
| `signal/scoring/selector-risk-filter.ts`                 | **Stays in place** — wrapped by `engines/finalizer/selector-risk-filter.ts` | Never moves |
| `signal/scoring/selector-submission-builder.ts`          | **Stays in place** — wrapped by `engines/finalizer/selector-submission-builder.ts` | Never moves |
| `signal/aggregators/technical-aggregator.ts`             | **Stays in place** — wrapped by `engines/finalizer/technical-aggregator.ts` | Never moves |
| `signal/aggregators/fundamental-aggregator.ts`           | **Stays in place** — wrapped by `engines/finalizer/fundamental-aggregator.ts` | Never moves |
| `signal/aggregators/review-aggregator.ts`                | **Stays in place** — wrapped by `engines/finalizer/review-aggregator.ts` | Never moves |
| `signal/aggregators/trade-signal-aggregator.ts`          | **Stays in place** — wrapped by `engines/finalizer/trade-signal-aggregator.ts` | Never moves |
| `implementations/trade/phase-analyses.ts`                | **Deleted**                                              | Each phase absorbs its own AIPhase definition                  |
| `implementations/trade/aggregator-phase-plan.ts`         | **Deleted** (Phase 4 — after review + decision migrated) | Factory eliminated after all phases migrated                   |
| `pipeline-discovery-config.ts`                           | **Deleted**                                              | Workers inline in each phase file                              |
| `implementations/registry/register-phases.ts`            | **Replaced** by `definitions/index.ts`                   | Manifest loop replaces imperative boot calls                   |
| `implementations/registry/cache-policy-registry.ts`      | **Deleted**                                              | Replaced by engines/registry.ts (cache kind)                  |
| `implementations/registry/input-builder-registry.ts`     | **Deleted**                                              | Replaced by engines/registry.ts (input kind)                  |
| `implementations/registry/register-analyses.ts`          | **Unchanged**                                            | Registers trade cycle analyses — separate concern              |
| `implementations/registry/analysis-resolver.ts`          | **Updated** — reads `inputEngineIds`, `cacheEngineId` directly from AIPhase | Removes `inspect` dependency |
| `implementations/inputs/trade-engine-input-builders.ts`  | **Unchanged**                                            | Trade cycle concern, not a phase input engine                  |

| Dimension      | Assessment                                                                  |
| -------------- | --------------------------------------------------------------------------- |
| Complexity     | Medium — engine registry extension, file moves, type field changes          |
| Performance    | No change in execution; one fewer map lookup (engine registry vs. separate registries) |
| Reliability    | Low risk — pure refactor; all existing logic moves, none changes            |
| Cost           | ~3–4 days total across all 4 migration phases                               |
| Reversibility  | Moderate — file moves are easy; type changes require a migration            |
| Stack fit      | Excellent — unifies the existing ENGINE_BINDINGS + cachePolicyId + inputBuilderIds patterns |
| Team readiness | Straightforward; no external dependencies                                   |

Risks:

- **`AIPhase` type scope** — `AIPhase` is in `phases/types.ts`, NOT in `@electron/shared`. Confirmed safe to change. Run `grep -r "AIPhase" electron/shared/` before touching.
- **`inspect` field removal** — `analysis-resolver.ts` reads `plan.inspect.inputBuilderIds`, `plan.inspect.finalizerEngineIds`. Must be updated in the same commit as `AIPhase` type change.
- **Engine sequencing for finalizers** — `finalizeEngineIds` order matters. For selector: `selector-risk-filter` must run before `selector-submission-builder`. Document the contract on the finalizer engine interface.
- **`signal/scoring/` and `signal/aggregators/` tests** — These stay in place; their tests remain valid. The only new tests needed are for the thin adapter engines.

---

## 6. Recommendation

**We recommend Option C: Engine-registry + definition-first architecture.**

Over the status quo: the status quo compounds. Every new phase capability means a new scattered file and a new direct call in the execution path. Decision phase complexity is coming; this pattern ensures it scatters identically to selector.

Over Option B: fixes one phase, not the system. Decision phase sprawl arrives in the same conversation six months later.

Key assumptions verified:

1. `AIPhase` is NOT in `@electron/shared` — it's in `phases/types.ts`. ✓
2. `inputBuilderIds` and `cachePolicyId` already exist on `AIPhase` and already use the ID pattern. This refactor renames + unifies them in one registry.
3. `signal/scoring/` and `signal/aggregators/` stay in place. Engines are thin adapters.

Conditions that would change the recommendation:

- If finalizer engines need fundamentally different chaining contracts per phase (not just different IDs), the `finalizeEngineIds` array may be insufficient — revisit the finalizer interface before Phase 2.

---

## 7. Implementation Plan

See `docs/plans/definition-first-pipeline/implementation-order.md` for the phased rollout with done criteria per phase.

### Phase 1: Establish the system — type contract and engine registry

**Status:** Implemented on 2026-05-23.

**Implementation note:** Phase 1 keeps a temporary optional `finalize?` fallback on `AIPhase` while existing phases are still migrated. The runtime prefers `finalizeEngineIds` when present and uses the fallback only for legacy phase definitions that have not reached Phases 2-4 yet. This keeps the system runnable between independently shippable phases; the fallback should be removed when Phase 4 completes.

**Goal:** The `AIPhase` type is updated with engine ID fields. The `engines/` directory exists with `registry.ts`. The `definitions/` folder has a manifest. No phase files move yet.

**Done criteria:**

- `AIPhase` type updated: `inputBuilderIds` → `inputEngineIds`, `cachePolicyId` → `cacheEngineId`, `entryModes` → `entryEngineIds`, `finalize()` → `finalizeEngineIds`, `inspect` removed
- `engines/registry.ts` exists with `registerEngine` / `resolveEngine` supporting `kind: "input" | "entry_mode" | "cache" | "finalizer"`
- `phases/interpreter.ts` updated to resolve engine IDs from definition (graceful no-op for empty arrays). **Execution order changes:** entry modes run before cache (today cache runs first — manual shortlist can be skipped on cache hit). Target order: entry → cache → input → stages → finalizers → `filterOutput` → cache write. `assembleAggregateTrace()` and aggregate persistence move from per-phase `finalize()` into `AIPhaseRunner` after finalizers complete.
- `analysis-resolver.ts` updated to read `inputEngineIds`, `cacheEngineId`, and `finalizeEngineIds` directly (removes `inspect` dependency)
- `definitions/index.ts` manifest stub exists
- Existing `cache-policy-registry.ts` and `input-builder-registry.ts` bridge to new `engines/registry.ts` OR are replaced immediately

**Deliverables:** `engines/registry.ts`, `engines/index.ts` (empty), updated `phases/types.ts`, updated `phases/interpreter.ts`, `definitions/index.ts` stub.

**Rollback:** Revert type and runtime changes. No phase files touched.

---

### Phase 2: Migrate selector — proves the engine registry pattern end-to-end

**Status:** Implemented on 2026-05-24.

**Implementation note:** `definitions/selector.phase.ts` now exports the executable `SELECTOR_PHASE` `AIPhase` and a temporary `SELECTOR_PIPELINE_DEFINITION` metadata bridge for `core/pipeline-registry.ts`. The bridge preserves the existing shared `PipelineDefinition` catalog used by effective config/developer tooling while selector execution moves to the definition-first `AIPhase` shape. User-visible selector behavior is unchanged.

**Goal:** Selector is fully migrated to `definitions/`. Every direct call in selector's phase-level hooks becomes a registered engine. `definitions/selector.phase.ts` is pure config.

**Done criteria:**

- `engines/input/selector-scope.ts` registered and referenced by ID
- `engines/input/broker-coverage.ts` registered and referenced by ID
- `engines/input/prediction-market-candidates.ts` registered and referenced by ID
- `engines/entry-mode/manual-shortlist.ts` registered and referenced by ID
- `engines/cache/selector-instrument-cache.ts` registered and referenced by ID
- `engines/finalizer/selector-risk-filter.ts` registered (adapter over `signal/scoring/selector-risk-filter.ts`)
- `engines/finalizer/selector-submission-builder.ts` registered (adapter over `signal/scoring/selector-submission-builder.ts`)
- `definitions/selector.phase.ts` has zero imports from `signal/scoring/`, zero `finalize()`, zero entry mode closures
- `definitions/selector.schemas.ts` exists
- All deleted: `implementations/selector/selector-analysis.ts`, `implementations/selector/selector-schemas.ts`, `implementations/inputs/selector-scope.ts`, `implementations/inputs/broker-coverage.ts`, `implementations/inputs/prediction-market-candidates.ts`, `implementations/inputs/manual-shortlist.ts`, `implementations/cache/selector-instrument-cache.ts`
- `pipeline-discovery-config.ts` selector section removed
- `implementations/registry/cache-policy-registry.ts` — selector cache policy entry removed
- `implementations/registry/input-builder-registry.ts` — selector input builder entries removed
- All existing selector tests pass

**Rollback:** Revert file moves. Engine registrations are additive.

---

### Phase 3: Migrate technical and fundamental — eliminate the factory

**Status:** Implemented on 2026-05-23.

**Goal:** `pipeline-discovery-config.ts` is deleted. `createAggregatorAIPhase()` factory is eliminated for technical and fundamental. Both phases are raw `AIPhase` definitions with inline worker arrays.

**Done criteria:**

- `engines/finalizer/technical-aggregator.ts` registered (adapter: calls `runEngineForWorker` + `ENGINE_BINDINGS.technicalAggregatorFinalize`)
- `engines/finalizer/fundamental-aggregator.ts` registered (same pattern)
- `definitions/technical.phase.ts` rewritten — raw `AIPhase`, workers inline, `finalizeEngineIds: ["technical-aggregator"]`
- `definitions/fundamental.phase.ts` rewritten — same pattern
- `pipeline-discovery-config.ts` deleted entirely
- `implementations/trade/phase-analyses.ts` — TECHNICAL_PLAN and FUNDAMENTAL_PLAN sections removed
- `implementations/trade/aggregator-phase-plan.ts` NOT deleted yet (review + decision still use it)
- All tests pass

**Rollback:** Revert file moves. Keep `pipeline-discovery-config.ts` until confirmed.

---

### Phase 4: Migrate review and decision

**Status:** Implemented on 2026-05-23.

**Implementation note:** The temporary `AIPhase.finalize?` legacy fallback was removed from `phases/types.ts` and `phases/interpreter.ts` once all five phases registered finalizer engines. Boot is now manifest-driven via `definitions/index.ts` (`registerAllPhases()`).

**Goal:** All five phases live in `definitions/` as real `AIPhase` configs. `implementations/trade/` is stripped of phase definitions. Factory is eliminated.

**Done criteria:**

- `engines/finalizer/review-aggregator.ts` registered
- `engines/finalizer/trade-signal-aggregator.ts` registered
- `definitions/review.phase.ts` rewritten — raw `AIPhase`, workers inline
- `definitions/decision.phase.ts` rewritten — raw `AIPhase`, workers inline, mock scenario logic preserved
- `implementations/trade/phase-analyses.ts` deleted
- `implementations/trade/aggregator-phase-plan.ts` deleted
- `implementations/registry/cache-policy-registry.ts` deleted (now empty)
- `implementations/registry/input-builder-registry.ts` deleted (now empty)
- `implementations/registry/register-phases.ts` deleted — replaced by `definitions/index.ts`
- `definitions/index.ts` finalized — all five phases in manifest
- All tests pass

**Decision phase special case:** The mock scenario check (`isMockSession && mockScenarioKind === "clean_breakout"`) in DECISION_PLAN must be preserved. Move into the `trade-signal-aggregator` finalizer engine where it reads from `ctx.toolContext`. Do not silently drop.

**Rollback:** Revert file moves. Review and decision are the simplest phases; low risk.

---

## 8. Risk Register

| #   | Risk                                                                                         | Likelihood | Impact | Mitigation                                                                                                     |
| --- | -------------------------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | `AIPhase` is in shared type graph; Phase 1 becomes a breaking shared change                  | Low        | High   | Already confirmed: `AIPhase` is in `phases/types.ts`, not `@electron/shared`. Run grep to be sure.             |
| 2   | `inspect` field removal breaks `analysis-resolver.ts`                                        | Certain    | Medium | Update `analysis-resolver.ts` in same commit as type change. Already identified all usages.                    |
| 3   | Hidden callers of `isManualSelectorMode` or `buildManualShortlistSelection` outside selector  | Low        | Medium | Workspace-wide import scan before deleting `manual-shortlist.ts`                                               |
| 4   | `pipeline-discovery-config.ts` has callers we missed                                         | Low        | Medium | `grep -r "pipeline-discovery-config"` before deleting                                                          |
| 5   | `signal/scoring/` or `signal/aggregators/` imported directly by renderer diagnostics         | Low        | Medium | `grep -r "signal/scoring\|signal/aggregators"` across all non-pipeline services before wrapping               |
| 6   | Finalizer engine state threading is incorrect (last engine output ≠ TOutput)                 | Medium     | Medium | Define the state threading contract in Phase 1 before any engine is written. Test with selector in Phase 2.    |
| 7   | Merge conflicts with in-flight work touching selector or pipeline-discovery-config            | Medium     | Medium | Do each phase in a short-lived branch, merge fast                                                              |

---

## 9. Success Criteria

| Goal                                            | Metric                                                    | Baseline                                                     | Target        | How Measured |
| ----------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ------------- | ------------ |
| All five phases have single source of truth     | Files needed to understand any one phase's full lifecycle | 8 (selector), 5 (technical/fundamental), 3 (review/decision) | 1–2 per phase | Manual count |
| No phase has a special-case folder              | Phase-named directories outside `definitions/[name]*`    | 1 (`implementations/selector/`)                              | 0             | `find`       |
| Shared input folders contain only shared inputs | Files in `implementations/inputs/` not used by 2+ phases | 4 (selector-only)                                            | 0             | Code audit   |
| Pipeline config scatter eliminated              | `pipeline-discovery-config.ts` exists                     | Yes                                                          | No            | `ls`         |
| Phase definitions are real AIPhase configs      | `definitions/*.phase.ts` use `AIPhase<>` not `PipelineDefinition<>` | No                                               | Yes           | Code audit   |
| `register-phases.ts` is a manifest loop         | Lines of code                                             | ~32                                                          | 0 (replaced by definitions/index.ts) | `wc -l` |
| All tests pass                                  | Test suite                                                | Passing                                                      | Passing       | `pnpm test`  |

Leading indicators (Phase 2 done — selector migrated):

- 8 files → 2 files for selector
- No imports of `implementations/selector/selector-analysis` anywhere in the codebase

Lagging indicators (Phase 4 done — system complete):

- Adding a new phase: create `definitions/[name].phase.ts` + one line in `definitions/index.ts`. Nothing else.
- Adding a new entry mode: add an engine file in `engines/entry-mode/`, import in `engines/index.ts`, add ID to phase definition.
- Adding phase-specific input context: same pattern as entry modes.

---

## 10. Open Questions

| #   | Question                                                                                                                              | Owner   | Needed By      | Status                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- | ------------------------------------------------------------------------ |
| 1   | Does finalizer state thread as `TState | TOutput` per engine call, or does the last engine always produce `TOutput`?                  | Kenneth | Phase 1        | **Recommended:** each engine receives the previous engine's return value as `state`; the first receives post-stage `TState`; the last produces `TOutput`. For selector, `selector-risk-filter` must pass through `discoveredCount` / `verifiedCount` so `selector-submission-builder` can build diagnostics. |
| 2   | Should `initialState()` become optional with a default of `() => ({} as TState)`, or stay required?                                  | Kenneth | Phase 1        | Open — optional with default is cleaner; need to confirm no phase relies on validation inside initialState |
| 3   | Does anything outside `selector-analysis.ts` import `isManualSelectorMode` or `buildManualShortlistSelection`?                       | Kenneth | Before Phase 2 | Open — run `grep -r "manual-shortlist\|isManualSelectorMode\|buildManualShortlistSelection" --include="*.ts"` |
| 4   | Does anything outside `phase-analyses.ts` and `selector-analysis.ts` call `selectorDiscoveryWorkersForMode`, `technicalWorkersForMode`, or `fundamentalWorkersForMode`? | Kenneth | Before Phase 3 | Open — run `grep -r "pipeline-discovery-config" --include="*.ts"` |
| 5   | Should `InputProvider` replace `InputBuilder` as the interface name, or keep `InputBuilder` for continuity?                           | Kenneth | Phase 1        | Open                                                                     |

---

## 11. Alternatives Rejected

| Option                                                         | Why Rejected                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option A — Status quo                                          | Pain grows with each new phase; decision phase complexity is coming                                                                                               |
| Option B — Consolidate selector only                           | Fixes the symptom (selector scatter) but not the system pattern; same problem recurs for decision phase                                                           |
| Auto-discovery of phase files at startup (no manifest)         | Adds build-time complexity (glob at module load, or a code-gen step). A five-line manifest array is simpler and explicit                                          |
| Merge `AIPhase` and `PipelineDefinition` into one unified type | `PipelineDefinition` is in `@electron/shared` and used by the renderer for display metadata. Merging risks shared-package changes. Out of scope for this refactor |
| Move everything into one giant `pipeline.ts`                   | Solves the scatter problem but creates a monolith. Phase-level files are the right granularity                                                                    |
| Move `signal/scoring/` and `signal/aggregators/` into `engines/finalizer/` | These files are well-tested standalone units with their own test suites. Moving them breaks that structure for no gain. Adapters are the right pattern. |
| Make `applyResults()` use engines too (stage reducer pattern)  | Adds engine kind complexity for limited gain. Stage-local state transformation is not the same class of problem as phase-level hooks. `applyResults()` is exempt. |

# Framework Design: What the Framework Owns

The framework owns the execution path. Phases own nothing except worker declarations and engine ID references. This document defines the config shape for phases and the contracts the framework enforces.

---

## The Two Layers

```
phases/       ← Runtime. Already exists. Runs one AI phase: fans out workers, collects outputs,
                finalizes into one typed result, handles cache. The AIPhaseRunner in
                phases/interpreter.ts is the execution engine. Updated by this refactor to
                resolve engine IDs from definitions instead of calling separate registries.

definitions/  ← Config. Already exists as dead PipelineDefinition<> stubs.
                This refactor rewrites them as real AIPhase<> objects with engine ID
                references and worker declarations. Zero business logic.

engines/      ← Business logic. New folder. All logic the runtime can invoke, by kind.
                No phase owns an engine. Referenced by ID only.
                signal/scoring/ and signal/aggregators/ files STAY IN PLACE.
                Engine files here are thin adapters that import from them.
```

The runtime (`phases/interpreter.ts`) reads a definition (`definitions/`), resolves each engine ID from the registry (`engines/registry.ts`), and executes in a fixed sequence:

1. Check `entryEngineIds` in order → short-circuit if match (resolveOutput returned, stages skipped)
2. Check `cacheEngineId` → return cached output if hit (stages skipped)
3. Resolve `inputEngineIds` → build context string, inject into worker prompts
4. Call `initialState(ctx)` → initialize stage accumulator
5. Run stages (workers fan out, results collected; each stage's `applyResults()` updates state)
6. Run `finalizeEngineIds` in order → produce typed output
7. Write cache
8. Return phase result

**Why this order?** Entry modes are checked first because they short-circuit everything — no point reading cache or building expensive inputs if the phase is going to return a manual shortlist. Cache is checked before input build because a cache hit also skips everything. Input is only built when stages will actually run.

**Behavior change from today:** `AIPhaseRunner` currently checks cache before entry modes. This refactor reverses that so manual shortlist and other entry modes cannot be bypassed by a stale cache hit.

A definition file contains no `if` statements, no direct function calls to business logic, no imports from `signal/`, `scoring/`, or any non-type concern.

---

## `AIPhase<TState, TOutput>` — Before and After

### Current type (before refactor)

```ts
export interface AIPhase<TState, TOutput> {
  phase: PipelinePhase;
  inputBuilderIds?: readonly string[]; // ← ID-based, but separate registry
  cachePolicyId?: string; // ← ID-based, but separate registry
  persistAggregate?: boolean;
  entryModes: readonly AIPhaseEntryMode[]; // ← inline objects, not IDs
  initialState(ctx: AIPhaseContext): TState | Promise<TState>;
  stages: readonly AIWorkerBatch<TState>[];
  finalize(ctx, state, workerTraces): Promise<{ output: TOutput; aggregate? }>;
  filterOutput?(output: TOutput, ctx: AIPhaseContext): TOutput;
  inspect: AIPhaseMetadata; // ← manually duplicates the ID lists above
}
```

### Target type (after refactor)

```ts
export interface AIPhase<TState, TOutput> {
  phase: PipelinePhase;

  // ── Engine ID declarations ────────────────────────────────────────────────

  /**
   * IDs of registered `kind: "input"` engines.
   * Framework invokes each in order, concatenates non-null results into
   * the worker prompt context block. Renamed from inputBuilderIds.
   */
  inputEngineIds?: readonly string[];

  /**
   * IDs of registered `kind: "entry_mode"` engines.
   * Framework checks each in order before running stages.
   * First engine whose `matches(ctx)` returns true short-circuits:
   * the framework calls `resolve(ctx)` and returns the output directly,
   * skipping cache read, stages, finalizers, and cache write.
   * Replaces: entryModes: readonly AIPhaseEntryMode[]
   */
  entryEngineIds?: readonly string[];

  /**
   * ID of a registered `kind: "cache"` engine.
   * Framework calls `read(ctx, fingerprint)` before stages.
   * On cache hit, returns cached output and skips stages + finalizers.
   * Framework calls `write(ctx, fingerprint, output, meta)` after finalize.
   * Renamed from cachePolicyId.
   */
  cacheEngineId?: string;

  /**
   * IDs of registered `kind: "finalizer"` engines, in execution order.
   * Framework runs these after all stages complete.
   * Each engine receives accumulated stage state + all worker results and
   * produces the next state. The last engine in the chain produces TOutput.
   * Replaces: finalize(ctx, state, workerTraces)
   */
  finalizeEngineIds?: readonly string[];

  // ── Stage declarations ────────────────────────────────────────────────────

  /**
   * Optional initial state factory. Defaults to `() => ({} as TState)`.
   * May read from ctx.input to validate required inputs.
   * This is structural state setup, not business logic — it stays on the definition.
   */
  initialState?(ctx: AIPhaseContext): TState | Promise<TState>;

  /**
   * Worker stages. Executed sequentially; workers within a stage run concurrently.
   * Each stage's applyResults() accumulates worker results into state.
   * applyResults() is stage-local transformation — direct utility calls are fine there.
   */
  stages: readonly AIWorkerBatch<TState>[];

  // ── Post-output filter ────────────────────────────────────────────────────

  /**
   * Optional post-output filter applied after finalize engines complete.
   * Lightweight filtering only (e.g. instrumentClass filter, count cap).
   * Stays on the definition — it's a final constraint, not business logic.
   */
  filterOutput?(output: TOutput, ctx: AIPhaseContext): TOutput;

  // ── Metadata ─────────────────────────────────────────────────────────────

  /** When false, aggregate trace is returned but not persisted. */
  persistAggregate?: boolean;
}
```

### What changed and why

| Field                                     | Change                                                  | Reason                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputBuilderIds`                         | **Renamed** to `inputEngineIds`                         | Unified into the engine registry; separate input-builder-registry.ts deleted                                                                                                |
| `cachePolicyId`                           | **Renamed** to `cacheEngineId`                          | Unified into the engine registry; separate cache-policy-registry.ts deleted                                                                                                 |
| `entryModes: readonly AIPhaseEntryMode[]` | **Replaced** by `entryEngineIds?: readonly string[]`    | Inline mode objects encode logic in the definition; engine IDs don't                                                                                                        |
| `finalize()`                              | **Replaced** by `finalizeEngineIds?: readonly string[]` | Direct function calls in finalize are the problem; engine IDs are the solution                                                                                              |
| `inspect: AIPhaseMetadata`                | **Removed**                                             | Manually duplicated the ID lists. Now redundant — runtime reads fields directly. `analysis-resolver.ts` reads `inputEngineIds`, `cacheEngineId` from the definition object. |
| `initialState()`                          | **Made optional** (default: `() => ({} as TState)`)     | Structural state setup, not business logic. Stays on definition.                                                                                                            |
| `filterOutput?()`                         | **Unchanged**                                           | Lightweight post-output constraint, not business logic. Stays on definition.                                                                                                |
| `stages`                                  | **Unchanged**                                           | `applyResults()` inside stages is stage-local — exempt from engine registry rule.                                                                                           |

---

## What `applyResults()` Is (and Is Not)

`applyResults(ctx, state, results): TState` is a method on each `AIWorkerBatch`. It takes the raw worker results for that stage and accumulates them into the phase state.

**`applyResults()` is stage-local transformation and is explicitly exempt from the engine registry rule.** It is the stage's way of expressing "how do collected worker results become part of the phase state." Direct utility function calls inside `applyResults()` are fine.

Example from selector's discovery stage (correct pattern):

```ts
applyResults: (ctx, state, results) => {
  const merged = mergeDiscoveryCandidates(results); // direct call — this is fine
  const scored = scoreSelectorCandidates(merged);   // direct call — this is fine
  return { ...state, candidatesForVerification: scored.slice(0, 5) };
},
```

These utility functions (`mergeDiscoveryCandidates`, `scoreSelectorCandidates`) live in `signal/scoring/` and are called directly. They do not need to be registered engines. The engine registry applies to phase-level hooks only.

---

## Engine Registry

The engine registry is the single source of truth for **phase-level** business logic the framework can invoke. Lives at `engines/registry.ts`. Replaces `cache-policy-registry.ts` and `input-builder-registry.ts` (both deleted after migration).

Worker-level engines (`kind: "context"`, `"policy"`, `"validator"`, `"transformer"`) remain in `services/signal/registry/` and are referenced via `ENGINE_BINDINGS` on workers — they are **not** part of this registry.

```ts
export type PhaseEngineKind =
  | "input" // builds context string for worker prompts
  | "entry_mode" // short-circuit condition + output resolver
  | "cache" // fingerprint, read, write
  | "finalizer"; // post-stage processing, output assembly

export interface Engine {
  id: string;
  kind: PhaseEngineKind;
}

const REGISTRY = new Map<string, Engine>();

export function registerEngine(engine: Engine): void {
  REGISTRY.set(engine.id, engine);
}

export function resolveEngine<T extends Engine>(
  id: string,
  kind: PhaseEngineKind,
): T {
  const engine = REGISTRY.get(id);
  if (!engine) throw new Error(`Engine '${id}' is not registered`);
  if (engine.kind !== kind)
    throw new Error(
      `Engine '${id}' is kind '${engine.kind}', expected '${kind}'`,
    );
  return engine as T;
}
```

Each engine file calls `registerEngine(...)` at the bottom. No exports needed — the side-effect import in `engines/index.ts` is sufficient.

---

## Engine Kind Contracts

### `kind: "input"`

Produces a context string injected into the worker system prompt. Returns `null` to be skipped.

```ts
export interface InputEngine extends Engine {
  kind: "input";
  build(ctx: AIPhaseContext): Promise<string | null>;
}
```

Framework behavior: calls each `inputEngineIds` entry in order, filters nulls, joins with `\n\n`, injects into worker prompt context.

---

### `kind: "entry_mode"`

Short-circuits stage execution. Framework checks in `entryEngineIds` order — first match wins.

```ts
export interface EntryModeEngine extends Engine {
  kind: "entry_mode";
  matches(ctx: AIPhaseContext): boolean | Promise<boolean>;
  resolve(ctx: AIPhaseContext): unknown | Promise<unknown>;
}
```

Framework behavior: before running stages (and before cache read), iterates `entryEngineIds`, calls `matches()`. If true, calls `resolve()`, returns output directly. All subsequent steps skipped.

---

### `kind: "cache"`

Fingerprints the phase run and reads/writes a cached output.

```ts
export interface CacheEngine<TOutput> extends Engine {
  kind: "cache";
  fingerprint(ctx: AIPhaseContext): string;
  read(ctx: AIPhaseContext, fingerprint: string): TOutput | null;
  write(
    ctx: AIPhaseContext,
    fingerprint: string,
    output: TOutput,
    meta: { agentRunId: string; cycleId: string },
  ): void;
}
```

Framework behavior:

1. Calls `fingerprint(ctx)` to get a hash
2. Calls `read(ctx, hash)` — if non-null, returns immediately (source: `"cache"`)
3. After finalizers complete, calls `write(ctx, hash, output, meta)`

---

### `kind: "finalizer"`

Post-stage processing. Finalizers run in the order declared in `finalizeEngineIds`. Each receives the accumulated stage state and all worker results and produces the next state. The last finalizer produces `TOutput`.

```ts
export interface FinalizerEngine<
  TState = unknown,
  TOutput = unknown,
> extends Engine {
  kind: "finalizer";
  run(
    ctx: AIPhaseContext,
    state: TState,
    workerResults: WorkerResult[],
  ): Promise<TState | TOutput>;
}
```

**Order matters.** For selector: `selector-risk-filter` must run before `selector-submission-builder` (risk filter evaluates candidates; submission builder builds output from accepted candidates). When chaining finalizers, pass any fields the next engine needs — e.g. risk-filter returns `{ accepted, rejected, discoveredCount, verifiedCount }` so submission-builder can populate diagnostics without access to the original `SelectorPlanState`.

**Finalizer engines may make LLM calls.** For technical/fundamental/review/decision, the aggregator finalizer engines call `runEngineForWorker()` internally (with `ENGINE_BINDINGS.*AggregatorFinalize`). This is an LLM call — `run()` is async and may be slow. The phase definition doesn't care; it just declares the engine ID.

`assembleAggregateTrace()` and aggregate persistence are framework concerns called by `AIPhaseRunner` after all finalizer engines complete (today this logic lives inside each phase's `finalize()`). Finalizer engines return phase output only; they do not call `assembleAggregateTrace()` directly.

---

### `kind: "context"` — worker-level context (existing pattern, unchanged)

Already implemented as `ENGINE_BINDINGS` in `ai-phase-config.ts`. These are engines referenced on individual workers (`engines: [ENGINE_BINDINGS.riskSummaryRead]`), not on phases. Unchanged by this refactor — already follows the right pattern.

---

## Framework Execution Order

For any phase, the runtime executes in this fixed sequence:

```
1. Check entry mode engines (in entryEngineIds order)
   → if match: call resolve(), return output, DONE
2. Check cache engine
   → if hit: return cached output, DONE
3. Resolve input engines (in inputEngineIds order)
   → build context string, inject into ctx.input.selectionInstructions
4. Call initialState(ctx) → initialize stage accumulator
5. Run stages (in frontier order, workers concurrent within each stage)
   → each stage's applyResults() updates state
6. Run finalizer engines (in finalizeEngineIds order)
   → state threads through; last engine produces TOutput
7. Apply filterOutput() if defined
8. Assemble aggregate trace + persist (if persistAggregate !== false)
9. Write cache engine output (if cacheEngineId set and output is non-empty)
10. Return phase result
```

No phase can change this order. No phase injects logic between these steps. If a phase needs something between steps, it registers an engine of the appropriate kind.

---

## Folder Layout

```
engines/
  registry.ts                     ← register/resolve
  input/
    selector-scope.ts
    broker-coverage.ts
    prediction-market-candidates.ts
  entry-mode/
    manual-shortlist.ts
  cache/
    selector-instrument-cache.ts
  finalizer/
    selector-risk-filter.ts           ← adapter over signal/scoring/selector-risk-filter.ts
    selector-submission-builder.ts    ← adapter over signal/scoring/selector-submission-builder.ts
    technical-aggregator.ts           ← adapter: calls runEngineForWorker + ENGINE_BINDINGS
    fundamental-aggregator.ts         ← same pattern
    review-aggregator.ts              ← same pattern
    trade-signal-aggregator.ts        ← same pattern
  index.ts                        ← imports all engine files at boot

definitions/
  selector.phase.ts             ← AIPhase config, worker declarations
  selector.schemas.ts           ← zod schemas for worker output
  technical.phase.ts
  fundamental.phase.ts
  review.phase.ts
  decision.phase.ts
  index.ts                      ← ALL_PHASES manifest + boot registration
```

**Note:** definitions stay flat — no subfolders per phase. Each phase is one `.phase.ts` file and optionally one `.schemas.ts` file.

---

## Boot Sequence

```ts
// main boot — engines must register before phases are resolved
import "../engines"; // registers all engines (side-effect imports)
import "../definitions"; // registers all phases
```

```ts
// engines/index.ts — one import per engine file (self-registers on import)
import "./input/selector-scope";
import "./input/broker-coverage";
import "./input/prediction-market-candidates";
import "./entry-mode/manual-shortlist";
import "./cache/selector-instrument-cache";
import "./finalizer/selector-risk-filter";
import "./finalizer/selector-submission-builder";
import "./finalizer/technical-aggregator";
import "./finalizer/fundamental-aggregator";
import "./finalizer/review-aggregator";
import "./finalizer/trade-signal-aggregator";
// Worker-level context engines (ENGINE_BINDINGS) register via services/signal/registry/ — not here
```

```ts
// definitions/index.ts — replaces register-phases.ts
import { registerAIPhase } from "../phases/registry";
import { SELECTOR_PHASE } from "./selector.phase";
import { TECHNICAL_PHASE } from "./technical.phase";
import { FUNDAMENTAL_PHASE } from "./fundamental.phase";
import { REVIEW_PHASE } from "./review.phase";
import { DECISION_PHASE } from "./decision.phase";

export const ALL_PHASES = [
  SELECTOR_PHASE,
  TECHNICAL_PHASE,
  FUNDAMENTAL_PHASE,
  REVIEW_PHASE,
  DECISION_PHASE,
] as const;

for (const phase of ALL_PHASES) {
  registerAIPhase(phase);
}
```

`implementations/registry/register-phases.ts` is deleted and replaced by `definitions/index.ts`. `cache-policy-registry.ts` and `input-builder-registry.ts` are deleted — their functionality moves to `engines/registry.ts`.

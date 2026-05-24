# pipeline/engines

Phase-level engine registry for the definition-first pipeline. These engines are the named capabilities that `AIPhaseRunner` resolves from an `AIPhase` object: input context, entry-mode short-circuits, cache policies, and finalizers.

## Current State

All five phases are fully migrated. Every phase-level hook is a registered engine; no logic lives in `phases/interpreter.ts`.

- `registry.ts` exposes `registerEngine()`, `resolveEngine()`, and `clearEngineRegistry()` (test isolation only).
- Supported kinds: `input`, `entry_mode`, `cache`, `finalizer`.
- Selector input engines live under `input/`.
- `manual-shortlist` lives under `entry-mode/`.
- `selector-instrument-cache` lives under `cache/`.
- Selector finalizer engines (`selector-risk-filter`, `selector-submission-builder`) live under `finalizer/`.
- Trade-phase finalizer engines (`technical-aggregator`, `fundamental-aggregator`, `review-aggregator`, `trade-signal-aggregator`) live under `finalizer/`.

## Contracts

- **Input engine**: `build(ctx)` returns a prompt-context string or `null`.
- **Entry-mode engine**: `matches(ctx)` decides whether to short-circuit; `resolve(ctx)` returns the phase output. Optional `source?: AIPhaseSource` declares what `AIPhaseResult.source` will be set to (defaults to `"phase"` if absent).
- **Cache engine**: `fingerprint(ctx)`, `read(ctx, fingerprint)`, and `write(ctx, fingerprint, output, meta)` control cache reuse. Optional `shouldWrite?(output): boolean` guards the write — return `false` to skip (e.g. output is empty). Defaults to writing whenever `output != null`.
- **Finalizer engine**: `run(ctx, state, workerResults)` transforms accumulated stage state into the final phase output. Finalizers run sequentially; each receives the previous engine's return value as `state`. The last finalizer's return value becomes the phase output.

## Rule

New phase-level behavior belongs here, not in `phases/interpreter.ts` and not as a direct call inside a phase-level hook. Add an engine, import it from `engines/index.ts`, and reference its ID from the phase definition.

Stage-local `applyResults()` logic is exempt — it only transforms one worker batch's results into phase state and is declared inline in the phase file.

# pipeline/engines

Phase-level engine registry for the definition-first pipeline migration. These engines are the named capabilities that `AIPhaseRunner` can resolve from an `AIPhase` object: input context, entry-mode short-circuits, cache policies, and finalizers.

## Current State

- Phase 1 added `registry.ts`; Phase 2 added concrete selector engines and imports them from `index.ts`.
- `registry.ts` exposes `registerEngine()` and `resolveEngine()`.
- Supported kinds are `input`, `entry_mode`, `cache`, and `finalizer`.
- Selector input engines live under `input/`.
- `manual-shortlist` lives under `entry-mode/`.
- `selector-instrument-cache` lives under `cache/`.
- Selector finalizer adapters live under `finalizer/`.
- Trade-phase finalizer engines are still pending for Phases 3-4.

## Contracts

- **Input engine**: `build(ctx)` returns a prompt-context string or `null`.
- **Entry-mode engine**: `matches(ctx)` decides whether to short-circuit; `resolve(ctx)` returns the phase output.
- **Cache engine**: `fingerprint(ctx)`, `read(ctx, fingerprint)`, and `write(ctx, fingerprint, output, meta)` control cache reuse.
- **Finalizer engine**: `run(ctx, state, workerResults)` transforms accumulated stage state; finalizers run sequentially and the last result is the phase output.

## Rule

New phase-level behavior belongs here, not in `phases/interpreter.ts` and not as a direct call inside a phase-level hook. Add an engine, import it from `engines/index.ts`, and reference its ID from the phase definition.

Stage-local `applyResults()` logic is exempt because it only transforms one worker batch's results into phase state.

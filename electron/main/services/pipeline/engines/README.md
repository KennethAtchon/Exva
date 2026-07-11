# pipeline/engines

Phase-level engine registry for the definition-first pipeline. These engines are the named capabilities that `AIPhaseRunner` resolves from an `AIPhase` object: input context, entry-mode short-circuits, cache policies, and finalizers.

## Current state

All five phases are fully migrated. Every phase-level hook is a registered engine; no logic lives in `phases/interpreter.ts`.

- `registry.ts` exposes `registerEngine()`, `resolveEngine()`, and `clearEngineRegistry()` (test isolation only).
- Supported kinds: `input`, `entry_mode`, `cache`, `finalizer`.
- `index.ts` registers selector shared engines (input, entry-mode, cache, selector finalizers). Imported as a side effect from `definitions/index.ts` at boot.
- Selector input engines live under `input/` (`selector-scope`, `broker-coverage`, `prediction-market-candidates`).
- `manual-shortlist` lives under `entry-mode/`.
- `selector-instrument-cache` lives under `cache/`.
- Selector finalizer engines (`selector-risk-filter`, `selector-submission-builder`) live under `finalizer/`.
- Trade-phase finalizer engines (`technical-aggregator`, `fundamental-aggregator`, `review-aggregator`, `trade-signal-aggregator`) live under `finalizer/` and self-register via side-effect imports in each `definitions/*.phase.ts`.

## Registered engines by phase

| Phase       | Input                                                         | Entry            | Cache                     | Finalizers                                        |
| ----------- | ------------------------------------------------------------- | ---------------- | ------------------------- | ------------------------------------------------- |
| selector    | selector-scope, broker-coverage, prediction-market-candidates | manual-shortlist | selector-instrument-cache | selector-risk-filter, selector-submission-builder |
| technical   | —                                                             | —                | —                         | technical-aggregator                              |
| fundamental | —                                                             | —                | —                         | fundamental-aggregator                            |
| review      | —                                                             | —                | —                         | review-aggregator                                 |
| decision    | —                                                             | —                | —                         | trade-signal-aggregator                           |

Finalizer engines delegate to deterministic functions in `services/signals/aggregators/` and `services/signals/scoring/`. This folder is the orchestration boundary; signal compute stays in `signals/`.

## Contracts

- **Input engine**: `build(ctx)` returns a prompt-context string or `null`.
- **Entry-mode engine**: `matches(ctx)` decides whether to short-circuit; `resolve(ctx)` returns the phase output. Optional `source?: AIPhaseSource` declares what `AIPhaseResult.source` will be set to (defaults to `"phase"` if absent).
- **Cache engine**: `fingerprint(ctx)`, `read(ctx, fingerprint)`, and `write(ctx, fingerprint, output, meta)` control cache reuse. Optional `shouldWrite?(output): boolean` guards the write — return `false` to skip (e.g. output is empty). Defaults to writing whenever `output != null`.
- **Finalizer engine**: `run(ctx, state, workerResults)` transforms worker outputs into the final phase output. Finalizers run sequentially; each receives the previous engine's return value as `state`. The last finalizer's return value becomes the phase output.

## Rule

New phase-level behavior belongs here, not in `phases/interpreter.ts` and not as a direct call inside a phase-level hook. Add an engine, register it (from `engines/index.ts` or a phase file side-effect import), and reference its ID from the phase definition.

Stage-local `applyResults()` logic is exempt — it only transforms one worker batch's results into phase state and is declared inline in the phase file.

## Two engine systems

This registry (`pipeline/engines/`) is separate from the worker-level signal engine registry (`pipeline/engines/signal-registry/`). Phase engines are orchestration hooks referenced by ID on `AIPhase`. Signal engines are deterministic functions referenced by `ENGINE_BINDINGS` for per-worker prompt enrichment and instrument-analysis engine steps.

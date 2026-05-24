# pipeline/phases

Runs one AI phase from start to finish. A phase is the unit that checks entry-mode engines, reads cache, builds deterministic input context, fans out workers, collects their outputs, finalizes them into one typed result, filters output, assembles aggregate traces, and optionally writes a cache entry.

## How it works

- `interpreter.ts` exports `AIPhaseRunner`, the runner for executable `AIPhase` objects.
- `types.ts` defines the phase contracts: `AIPhase`, `AIWorkerBatch`, `AIWorkerTrace`, `AIPhaseContext`, and `AIPhaseResult`.
- `registry.ts` stores executable phases. Selector is registered by `definitions/index.ts`; unmigrated trade phases are still registered by `implementations/registry/register-phases.ts`.
- `services.ts` lists the repositories and services a phase can use, such as selector settings, AI phase config, instrument cache, agent run/message repos, broker routing, and strategy context.
- A phase starts by building an `AIPhaseContext` from session data, strategy context, tool context, runtime services, and caller input.
- `entryEngineIds` are checked first. A matching entry engine short-circuits cache, input building, workers, finalizers, and cache write. The current selector registers `manual-shortlist` during startup.
- If `cacheEngineId` is present, the runner computes a fingerprint and returns cached output before input engines or workers run.
- `inputEngineIds` append deterministic text sections to phase input before workers run. Selector input engines now live under `pipeline/engines/input/`.
- Worker batches run in order. Each batch resolves workers, builds a task payload, calls the injected `AIWorkerRunner`, enforces partial-failure rules, records worker traces, and updates phase state.
- `finalizeEngineIds` run after worker stages and thread state through registered finalizer engines. During the migration window, phases with no `finalizeEngineIds` fall back to legacy `finalize?`.
- Cache writes happen only when the phase has a cache policy, aggregate trace metadata exists, and the output is non-empty.
- `filterOutput()` is the final phase-level safety hook; the selector uses it to remove instruments outside the effective class set and cap results by max concurrent trades.

## Flow

```mermaid
sequenceDiagram
    participant Runtime as PipelineRuntime
    participant Runner as AIPhaseRunner
    participant Entry as Entry Engine
    participant Cache as Cache Engine
    participant Inputs as Input Engines
    participant Workers as AIWorkerRunner
    participant Finalize as Phase Finalizer
    participant Repos as Agent Repos

    Runtime->>Runner: run(AIPhase, context, input)
    Runner->>Entry: matches + resolve
    alt entry match
        Entry-->>Runner: direct output
        Runner-->>Runtime: AIPhaseResult(source=manual_shortlist | phase)
    else no entry match
        Runner->>Cache: fingerprint + read
    end
    alt cache hit
        Cache-->>Runner: cached output
        Runner-->>Runtime: AIPhaseResult(source=cache)
    else cache miss
        Runner->>Inputs: build(inputEngineIds)
        loop for each AIWorkerBatch
            Runner->>Workers: executeGroup(worker tasks)
            Workers-->>Runner: worker outputs + traces
            Runner->>Runner: applyResults(state)
        end
        Runner->>Finalize: finalizeEngineIds or legacy finalize?
        Finalize-->>Runner: output
        Runner->>Repos: persist aggregate run/message
        Runner->>Cache: write non-empty selector output
        Runner-->>Runtime: AIPhaseResult(source=ai_picker | phase)
    end
```

## Terms

- **AIPhase** - executable definition of one phase, including engine IDs, worker batches, optional legacy finalizer, and output filter.
- **AIWorkerBatch** - group of workers run together with one concurrency setting and one result-application function.
- **entry engine** - shortcut path that can return output without cache or worker execution, such as manual selector mode.
- **cache engine** - read/write policy that decides whether a previous phase output can be reused.
- **AIWorkerTrace** - per-worker trace metadata used to build an aggregate phase trace.
- **source** - `AIPhaseResult.source`, describing where output came from: cache, manual shortlist, AI picker, or a direct phase run.

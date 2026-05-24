# Definition-First Pipeline Refactor

> **Status:** Phase 2 implemented — 2026-05-24
> **Goal:** Replace the scattered, file-per-concern pipeline with a two-layer system: an engine registry the framework owns, and phase definitions that are pure config referencing engine IDs.

---

## Current State

Phases 1 and 2 are implemented. The framework has the new phase-engine registry, and selector is fully migrated to a definition-first `AIPhase` with registered input, entry-mode, cache, and finalizer engines.

Implemented now:

- `electron/main/services/pipeline/engines/registry.ts` defines `registerEngine()` / `resolveEngine()` and the `input`, `entry_mode`, `cache`, and `finalizer` engine contracts.
- `AIPhase` now declares `inputEngineIds`, `entryEngineIds`, `cacheEngineId`, and `finalizeEngineIds` instead of `inputBuilderIds`, inline `entryModes`, `cachePolicyId`, and `inspect` metadata.
- `AIPhaseRunner` resolves entry engines before cache, then input engines, worker stages, finalizer engines, output filtering, aggregate trace assembly, aggregate persistence, and cache write.
- Existing input builders and cache policies are bridged into the engine registry by their legacy registries so the app remains runnable during migration.
- `manual-shortlist` is registered as an entry-mode engine during startup.
- `definitions/index.ts` registers the migrated selector phase.
- `definitions/selector.phase.ts` is the executable selector phase definition.
- Selector-specific input builders, manual shortlist handling, selector cache, and finalization adapters live under `pipeline/engines/`.

Still transitional:

- Technical, fundamental, review, and decision executable phase objects still live under `implementations/trade` until Phases 3-4 move them into `definitions/`.
- `AIPhase.finalize?` remains as a temporary fallback for unmigrated trade phases. The runner prefers `finalizeEngineIds`; if none are configured, it calls legacy `finalize?`.
- `implementations/registry/input-builder-registry.ts` and `cache-policy-registry.ts` still exist as compatibility registries, but selector no longer registers through them.
- `definitions/selector.phase.ts` also exports `SELECTOR_PIPELINE_DEFINITION` as a temporary metadata bridge for the shared `PipelineDefinition` catalog.

---

## The Three Layers

```
phases/          ← Runtime. Runs phases: entry engines, cache engines, input engines,
                   worker stages, finalizer engines, output filtering, aggregate traces,
                   persistence, and cache writes. During migration it also supports a
                   legacy finalize? fallback for unmigrated phases.

definitions/     ← Target config home. Today it still mostly contains static
                   PipelineDefinition<> files plus an empty ALL_PHASES manifest stub.
                   Phases 2-4 move executable AIPhase<> objects here.

engines/         ← Phase-level business logic registry. Selector input, entry-mode,
                   cache, and finalizer engines are implemented here. Later phases
                   add trade-phase finalizer engines.
```

**Do not confuse `phases/` with where definitions live.** `phases/` is the runtime — it runs phases. `definitions/` is where phase configs live. These two folders exist for different reasons and are not interchangeable.

Target state: a phase definition never imports phase-level business logic directly. It declares which engine IDs to invoke. The runtime resolves and calls them. Adding new logic = register a new engine, add its ID to a phase config. The execution path never changes.

---

## Documents in This Folder

| File | What it covers |
|---|---|
| [framework-design.md](./framework-design.md) | What the framework owns, `AIPhase` config shape before and after, engine registry kinds and contracts |
| [selector-files.md](./selector-files.md) | Complete inventory of all selector-specific files, disposition for each, what the final selector definition looks like |
| [engine-registry.md](./engine-registry.md) | How engines are structured, how to register one, all current engine kinds with examples |
| [other-phases.md](./other-phases.md) | Migration plan for technical, fundamental, review, decision — factory elimination |
| [implementation-order.md](./implementation-order.md) | Phased rollout: what to do first, done criteria per phase, rollback plan |

---

## The Rule

> **New business logic in a phase-level hook (inputs, entry modes, cache, finalize) = register an engine, reference the ID. Never add a direct call inside those hooks.**
>
> Stage `applyResults()` is exempt — it's stage-local state transformation, not a phase-level hook.

No `if (phase === "selector")`. No `if (isManualSelectorMode)`. No `scoreCandidate()` called from inside `finalize()`. All of that lives in `engines/` and is invoked by the framework when it sees the ID in the phase config.

During the migration window, legacy phase files may still contain `finalize?` implementations. Do not add new logic to those fallback finalizers; move new phase-level behavior into an engine instead.

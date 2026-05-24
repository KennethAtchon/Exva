# Definition-First Pipeline Refactor

> **Status:** Complete — 2026-05-23
> **Goal:** Replace the scattered, file-per-concern pipeline with a two-layer system: an engine registry the framework owns, and phase definitions that are pure config referencing engine IDs.

---

## Current State

All phases are migrated. Five executable `AIPhase` objects live in `definitions/*.phase.ts`, registered at boot via `registerAllPhases()`. Every phase-level hook is a registered engine in `pipeline/engines/`. `AIPhaseRunner` is generic glue with no phase-specific if-chains.

Implemented:

- `pipeline/engines/registry.ts` — `registerEngine()` / `resolveEngine()` with `input`, `entry_mode`, `cache`, and `finalizer` kinds.
- `definitions/all-phases.ts` — canonical list: selector → technical → fundamental → review → decision.
- `definitions/phase-catalog.ts` — derives `PipelineDefinition` metadata from `AIPhase.resolveWorkersForMode()`.
- `definitions/index.ts` — boot registration + optional `validatePhaseEngines()`.
- Selector engines in `engines/index.ts` (input, entry, cache, selector finalizers).
- Trade-phase finalizer engines self-register via side-effect imports in each `*.phase.ts`.
- `implementations/selector/` deleted; trade-cycle wiring remains in `implementations/trade/`.
- Boot validates catalog via `assertValidPipelineDefinitionCatalog()` in `app-services.ts`.

See `docs/architecture/pipeline-runtime.md` §4.1 and `docs/reviews/definition-first-pipeline-review.md` for the full post-migration picture.

---

## The Three Layers

```
phases/          ← Runtime. Generic AIPhaseRunner: entry → cache → input → worker
                   batches → finalizers → filter → trace → cache write.

definitions/     ← Executable AIPhase config. One file per phase + all-phases.ts
                   manifest + phase-catalog.ts for tooling metadata.

engines/         ← Phase-level business logic registry. Input, entry-mode, cache,
                   and finalizer engines referenced by ID from phase definitions.
```

**Do not confuse `phases/` with where definitions live.** `phases/` is the runtime — it runs phases. `definitions/` is where phase configs live.

A phase definition never imports phase-level business logic directly. It declares engine IDs. The runtime resolves and calls them. Adding new logic = register a new engine, add its ID to a phase config.

---

## Documents in This Folder

| File | What it covers |
|---|---|
| [framework-design.md](./framework-design.md) | Framework design, `AIPhase` config shape, engine registry kinds |
| [selector-files.md](./selector-files.md) | Historical selector file inventory and migration disposition |
| [engine-registry.md](./engine-registry.md) | Engine structure, registration, kinds with examples |
| [other-phases.md](./other-phases.md) | Historical migration plan for trade phases |
| [implementation-order.md](./implementation-order.md) | Phased rollout plan and done criteria |

These planning docs describe the migration path. For current architecture, prefer `docs/architecture/pipeline-runtime.md`.

---

## The Rule

> **New business logic in a phase-level hook (inputs, entry modes, cache, finalize) = register an engine, reference the ID. Never add a direct call inside those hooks.**
>
> Stage `applyResults()` is exempt — it's stage-local state transformation, not a phase-level hook.

No `if (phase === "selector")`. No `if (isManualSelectorMode)`. All phase-level behavior lives in `engines/` and is invoked when the framework sees the ID in the phase config.

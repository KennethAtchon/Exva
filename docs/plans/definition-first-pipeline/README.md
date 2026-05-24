# Definition-First Pipeline Refactor

> **Status:** Draft — 2026-05-23
> **Goal:** Replace the scattered, file-per-concern pipeline with a two-layer system: an engine registry the framework owns, and phase definitions that are pure config referencing engine IDs.

---

## The Three Layers

```
phases/          ← Runtime. Already exists. Runs phases: fans out workers, collects outputs,
                   finalizes, handles cache. The interpreter.ts in this folder is the main
                   execution engine. UNCHANGED by this refactor except to resolve engine IDs
                   from the phase definition instead of calling separate registries.

definitions/     ← Config. Already exists as dead stubs. This refactor makes them real:
                   AIPhase<> objects with engine ID references and worker declarations.
                   Zero business logic. Zero direct imports from signal/ or scoring/.

engines/         ← Business logic. New folder. Organized by kind. No phase owns an engine.
                   Referenced by ID only. signal/scoring/ and signal/aggregators/ files
                   STAY IN PLACE — engine files here are thin adapters that import from them.
```

**Do not confuse `phases/` with where definitions live.** `phases/` is the runtime — it runs phases. `definitions/` is where phase configs live. These two folders exist for different reasons and are not interchangeable.

A phase definition never imports business logic directly. It declares which engine IDs to invoke. The runtime resolves and calls them. Adding new logic = register a new engine, add its ID to a phase config. The execution path never changes.

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

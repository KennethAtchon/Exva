# Why Selector Has So Many Custom Configurations

> **Date:** 2026-05-19  
> **Updated:** 2026-05-19 — consolidated into `PhasePlanInterpreter` (see Resolution below)  
> **Context:** Phase 2 initially added selector-specific layers under `pipeline-runtime/selector/`. That has been replaced by generic plan infrastructure. This doc explains why the interim state happened and what was fixed.  
> **Audience:** Exva engineering  
> **Question this answers:** Why did selector accumulate so many custom configurations — and how was it consolidated?

---

## Resolution (2026-05-19)

Selector now runs through **`PhasePlanInterpreter`** with three shared registries:

| Registry | Location | Selector registration |
|----------|----------|----------------------|
| Input builders | `plan/input-builder-registry.ts` | `selector-scope`, `broker-coverage`, `prediction-market-candidates` |
| Cache policies | `plan/cache-policy-registry.ts` | `selector-instrument-cache` |
| Phase plans | `plan/phase-plan-registry.ts` | `SELECTOR_PLAN` in `plan/plans/selector-plan.ts` |

**Removed:** `SelectorPhaseRunner`, `AiRuntime.runSelector()`, `SELECTOR_PHASE.run()`, entire `pipeline-runtime/selector/` folder.

**Entrypoint:** `AiRuntime.runPhasePlan("selector", sessionId, cycleId)` — generic for any future plan-backed phase.

**Effective config** now derives scheduling/input/cache metadata from the registered plan, not hardcoded `if (phase === "selector")` branches.

---

## Executive Summary (historical)

Selector is not uniquely complex because instrument picking is inherently harder than technical analysis or trade decision. It is uniquely complex because **we keep solving the same pipeline-runtime problems with selector-only implementations** while the generic executor remains too thin to absorb them.

The codebase now has **multiple parallel descriptions of the same selector behavior** (declarative config, procedural phase hook, dedicated phase runner, discovery worker tables, orchestration hash, UI cache service). Most of the new Phase 2 code is **real logic that belongs in the runtime** — but it was added as **selector-shaped copies** of mechanisms that other phases will eventually need too.

That is the ballooning pattern: not twelve copies of identical code, but **twelve incompatible ways to express “how a phase runs.”**

---

## The Parallel Implementations (Today)

| Layer | Selector-specific artifact | What it actually does | Generic equivalent that doesn't exist yet |
|-------|---------------------------|----------------------|----------------------------------------|
| Entrypoint | `AiRuntime.runSelector()` | Special API vs `runPhase()` | `runPhase()` with phase plan + entry modes |
| Orchestration | `resolveInstruments()` | Maps `InstrumentSelection` → scheduling type, emits events | Generic cycle result adapter |
| Phase runner | `SelectorPhaseRunner` | Cache read → manual bypass → input build → `runPhase` → cache write | `PhasePlanRunner` with configured pre/post hooks |
| Declarative config | `SELECTOR_PHASE_CONFIG` | Documents input builders, cache, variants, finalizers | **Not wired to runtime** — informational only |
| Phase definition | `SELECTOR_PHASE.run()` | 3-stage discovery → verification → score → filter → submit | Generic multi-frontier graph executor |
| Worker variants | `selectorDiscoveryWorkersForMode()` in `pipeline-discovery-config.ts` | Picks workers by `discoveryMode` | Variant resolution in effective config / stage plan |
| Duplicate variant config | `SELECTOR_PHASE_CONFIG.variants` | Same worker lists as discovery config | Single source of truth |
| Input assembly | 4 files under `selector/input-builders/` | Builds NL prompt sections | Registered `InputBuilder` catalog + `buildPhaseInput(phase, ctx)` |
| Manual bypass | `manual-shortlist-builder.ts` + `isManualSelectorMode()` | Skips workers, returns output directly | Phase `entryMode: "manual_shortlist" \| "ai"` in plan |
| Cache | `selector/cache/selector-cache-policy.ts` | Hash, TTL, read/write instrument cache | `CachePolicy` registry keyed by phase/stage |
| Fingerprint | `orchestration/selector-definition-hash.ts` | Cache invalidation identity | Generic `DefinitionFingerprintBuilder` |
| UI cache view | `InstrumentCacheService` | Staleness display for Strategy tab | Same fingerprint builder, shared module |
| Effective config | `if (phase === "selector")` branches | Injects `inputBuilders`, `cachePolicy` | All stages expose plan metadata uniformly |
| Engines | 4 selector engines + direct imports in `selector.phase.ts` | Merge, score, filter, submit | Finalizer bindings executed by generic runner |
| Dynamic workers | `verificationWorkers(candidate)` inside `run()` | Spawns per-symbol worker defs at runtime | Config-driven worker templates + expansion rules |

**Count:** 14 selector-specific mechanisms. **Wired generically:** ~2 (partially — worker execution and spend tracking via `PipelineRuntime.run`).

---

## Root Causes

### 1. The generic runtime stops at “execute these workers”

`PipelineRuntime.run()` supports two paths:

1. **Standard path:** flat or dependency-graph worker scheduling, aggregate output, assemble trace.
2. **Escape hatch:** `definition.run()` — full custom orchestration inside the phase file.

Selector uses the escape hatch for its core AI workflow (discovery frontiers, dynamic verification workers, partial failure tolerance, rescoring). Phase 2 added **another escape hatch outside the runtime** (`SelectorPhaseRunner`) for cache, manual mode, and input building.

So selector now has **two custom orchestration layers** stacked on top of a generic executor that was never extended to handle:

- Pre-phase input resolution
- Pre-phase cache lookup
- Post-phase cache persistence
- Non-AI entry modes (manual shortlist)
- Multi-frontier scheduling with dynamic worker expansion

Every time we need one of those for a new phase, the path of least resistance is another `FooPhaseRunner`.

---

### 2. “Configuration” was added without replacing procedure

Phase 2 introduced `SELECTOR_PHASE_CONFIG` and input builder IDs that mirror the architecture review’s target shape. But:

- **`SELECTOR_PHASE_CONFIG` does not drive execution.** `SelectorPhaseRunner` and `SELECTOR_PHASE.run()` hardcode the same behavior in TypeScript.
- **`WorkerInputBuilderId` exists in shared types** (`pipeline-phase.ts:19`, `WorkerDefinition.inputBuilder`) but there is **no input builder registry** and no runtime call to resolve builders by ID.
- **Variant workers are declared twice:** in `SELECTOR_PHASE_CONFIG.variants` and in `pipeline-discovery-config.ts` (the latter is what actually runs).

This creates the worst of both worlds: **the maintenance cost of config plus the maintenance cost of custom code**, with no single source of truth.

---

### 3. Incremental migration preserves duplicate ownership

The architecture review correctly warned against big-bang refactors. Phase 2’s constraint was: *move ownership without breaking live trade cycles*. That produced:

| Concern | Old owner | New owner | Still duplicated? |
|---------|-----------|-----------|-------------------|
| Input instructions | orchestration | `input-builders/` | Yes — also built in `SelectorPhaseRunner` before `runPhase` |
| Cache | orchestration | `selector/cache/` | Yes — fingerprint still in `orchestration/selector-definition-hash.ts` |
| Manual shortlist | orchestration branch | `manual-shortlist-builder` | Yes — branch logic in `isManualSelectorMode()` + runner |
| Worker pipeline | `SELECTOR_PHASE.run()` | unchanged | Yes — Phase 2 didn’t touch it |
| Agent run persistence | orchestration | `SelectorPhaseRunner` | Moved, but only for selector |
| Scheduling type mapping | orchestration | `instrument-resolver.ts` | Still orchestration-specific |

Migration moved **lines of code** without collapsing **concepts**. Selector behavior is now spread across `pipeline-runtime/selector/`, `definitions/selector.phase.ts`, `pipeline-discovery-config.ts`, `orchestration/cycle/selector/`, and `AiRuntime` — five locations for one product phase.

---

### 4. Selector was the first pipeline phase and accumulated special cases

Selector predates the phase-first runtime design. Legacy decisions still echo:

- **`tool_terminal` output mode** — only selector uses terminal-tool submission; the generic path assumes object aggregation.
- **`session_instrument_cache` table** — selector-specific persistence; no generic “phase output cache” abstraction.
- **`selectionMode` / `aiPickerEnabled`** — session-level product concepts that short-circuit the pipeline; no generic “phase entry mode.”
- **`InstrumentSelection` vs `ResolvedInstrument`** — two output shapes requiring an adapter at the orchestration boundary; trade phases don’t have this split because they never lived in orchestration.
- **Research burst / selector cycle** — orchestration lifecycle wrapper that exists because selector runs outside the trade cycle graph.

Each special case was reasonable in isolation. Together they mean **selector cannot be expressed as “just another `PipelineDefinition`”** without first generalizing those concepts.

---

### 5. Other phases have the same disease — selector is just further along

Selector looks worse because Phase 2 added a whole folder. But the same pattern exists elsewhere:

| Phase | Custom `run()` hook | Variant worker switching | Finalizer |
|-------|--------------------|--------------------------|-----------|
| selector | Yes — 3-stage dynamic graph | `selectorDiscoveryWorkersForMode` | Direct engine imports (merger, scorer, filter, builder) |
| technical | Yes — collect outputs by schema type | `technicalWorkersForMode` | `runEngineBinding` (Phase 4 fixed this one) |
| fundamental | Yes | `fundamentalWorkersForMode` | `runEngineBinding` |
| review | Yes | static workers | `runEngineBinding` |
| decision | Yes | static workers | `runEngineBinding` |

**Every phase bypasses the generic graph executor.** Selector is unique only in having *an additional* custom runner outside the phase definition.

When Phase 3 adds `runCycle()` for trade pipelines, the risk is a third layer: `TradeCycleRunner` + `runAiPipeline()` + per-phase `run()` hooks — unless the cycle runner subsumes them.

---

### 6. Schema duplication signals missing shared abstractions

The same Zod shapes appear in multiple files:

- `candidateOutputSchema` — defined in both `selector.phase.ts` and `pipeline-discovery-config.ts`
- Discovery worker lists — `STANDARD_SELECTOR_DISCOVERY` / `EVENT_SELECTOR_DISCOVERY` and `SELECTOR_PHASE_CONFIG.variants`
- Scoring weights / risk rules — in `pipeline-config.ts` defaults but applied via direct imports in `selector.phase.ts`, not via engine bindings listed in config

Duplication is a symptom: **there is no “worker catalog” or “schema registry” that phase plans reference by ID.** Each phase file inlines what it needs.

---

### 7. Effective config exposes the gap

`resolveEffectivePipelineConfig()` special-cases selector:

```ts
inputBuilders: input.phase === "selector" ? [...SELECTOR_PHASE_CONFIG.inputBuilders] : undefined,
cachePolicy: input.phase === "selector" ? SELECTOR_PHASE_CONFIG.cache.ttlPolicy : undefined,
```

And it **under-reports** selector reality:

- Shows discovery workers only — verification workers and the 3-stage graph are invisible
- Shows `custom_run` scheduling but not frontiers, dynamic expansion, or failure policy
- Lists finalizers in `SELECTOR_PHASE_CONFIG` but the phase definition doesn’t use engine bindings for them

The inspectability goal of Phase 1 is undermined when selector’s effective config is **partially derived, partially hardcoded, and partially fiction.**

---

## Why We Keep Choosing Custom Over Generic

These are the practical forces — not excuses — that led to the current shape:

1. **Shipping pressure.** A working selector with a custom `run()` hook ships faster than building a graph executor that supports dynamic worker templates, cache policies, and entry modes.

2. **Migration safety.** Moving orchestration logic into `SelectorPhaseRunner` is a smaller diff than teaching `PipelineRuntime` about cache and manual bypass for all phases.

3. **Selector-specific product semantics.** Manual shortlist, instrument cache TTL by holding style, and prediction-market prefeed feel like “selector features,” so they get selector folders.

4. **Incomplete Phase 4 engine routing.** Finalizers work through bindings for technical→decision, but selector still calls merger/scorer/filter/submission directly inside `run()`. `SELECTOR_PHASE_CONFIG.finalizers` is aspirational.

5. **No forcing function for registry patterns.** Types mention `inputBuilder`, `EngineBinding`, `PipelineFinalizerId`, but nothing resolves them at runtime except ad hoc code paths.

6. **Tests anchor legacy shapes.** Orchestrator tests, instrument cache UI, and selector-definition-hash all assume selector-specific modules exist.

---

## What “Generalized” Would Look Like (Contrast)

Instead of `selector/input-builders/`, `selector/cache/`, `SelectorPhaseRunner`, and `runSelector()`:

```ts
// One phase plan drives pre/run/post
const SELECTOR_PLAN: PhasePlan = {
  phase: "selector",
  entryModes: [
    { id: "manual_shortlist", builder: "manual-shortlist", skipsWorkers: true },
    { id: "ai_picker", builder: "selector-input-composite" },
  ],
  cache: { fingerprint: "selector-definition", ttlPolicy: "holding-style" },
  stages: [
    { frontier: 0, workers: { variant: "discoveryMode", map: DISCOVERY_VARIANTS }, concurrency: 3, toleratePartialFailure: true },
    { frontier: 1, workers: { expand: "verification-template", from: "topScored", count: 5 }, concurrency: 4, toleratePartialFailure: true },
  ],
  finalizer: { engine: "selector-submission-builder", inputs: ["merged", "scored", "filtered"] },
};

// One entrypoint for all phases
await ai.runPhasePlan("selector", { sessionId, cycleId });
```

Phase 2 moved code **toward** this shape in naming (`inputBuilders`, `cachePolicy`, `variants`) but **not in mechanism** (no registry, no plan interpreter).

---

## Cost of the Current Approach

### Immediate

- **Onboarding a selector change** still requires knowing 5+ file locations
- **Adding cache to another phase** means copying `selector/cache/` patterns
- **Adding an input builder for technical** means inventing `technical/input-builders/` or inlining in trade cycle
- **Effective config lies by omission** for selector verification stage

### Compounding (if unaddressed)

| Next feature | Likely implementation without generalization |
|--------------|---------------------------------------------|
| Phase 3 trade cycle | `TradeCycleRunner`, `runCycle()`, `TRADE_CYCLE_CONFIG` |
| Candidate validation stage | `CandidateValidationRunner` or orchestration call |
| Per-phase retry | Copy `ExecutionStepRunner` retry logic into each runner |
| New discovery mode | Edit `pipeline-discovery-config.ts` + `SELECTOR_PHASE_CONFIG.variants` + maybe `run()` |
| Phase output caching elsewhere | Copy `selector-cache-policy.ts` |

That is the “12 implementations” trajectory: **one bespoke runner/config folder per concern per phase.**

---

## Recommendations (Ordered)

### Stop adding selector-only layers

Before Phase 3, declare: **no new `*PhaseRunner` classes, no new `run*()` methods on `AiRuntime`, no new phase-specific config constants unless they plug into a registry.**

### Build three shared registries (small, high leverage)

1. **`InputBuilderRegistry`** — resolve `InputBuilderId` → `(ctx) => string | object | null`; composite builder for phase input
2. **`CachePolicyRegistry`** — resolve fingerprint builder + TTL policy + repo binding; used by any phase that caches
3. **`PhasePlanInterpreter`** — frontiers, variant worker maps, dynamic expansion templates, finalizer binding — subsumes custom `run()` for selector first, then others

### Collapse duplicate config sources

- Delete or wire `SELECTOR_PHASE_CONFIG.variants` — single source in worker catalog
- Move `selector-definition-hash.ts` under `pipeline-runtime/cache/` (shared fingerprint builders)
- Route selector finalizers through engine bindings; delete direct imports from `selector.phase.ts`

### Make effective config honest

Either effective config is generated **from the plan interpreter** or it should not claim to show input builders, finalizers, and stages it does not actually execute.

---

## Bottom Line

Selector has so many custom configurations because **we are migrating toward a configuration-based architecture using procedural, phase-specific implementations** — and each migration step adds a new procedural layer rather than extending the generic one.

The folder structure (`pipeline-runtime/selector/`) looks like progress. Functionally, it is **selector’s third custom orchestrator** (after orchestration’s old resolver and `SELECTOR_PHASE.run()`), with a fourth declarative config that mostly documents intent.

Until `PipelineRuntime` owns input resolution, cache, entry modes, multi-frontier graphs, and finalizers **for any phase**, every phase that needs those capabilities will get its own folder, runner, and config constant. Selector is just the first one far enough down that path to make the pattern visible.

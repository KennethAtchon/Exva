# Multiple Pipelines, Routed by Signal Source — Feature Specification

> **Date:** 2026-06-06
> **Status:** Implemented (branch `feat/multi-pipeline-signal-routing`)
> **Feature area:** Pipeline / analysis runtime (`electron/main/services/pipeline`, `electron/main/services/orchestration/cycle`)
> **Depends on:** Cycle-plan registry (`analysis/registry.ts`), phase pool (`ai-phase.ts`), signal-source model (`shared/domain/signals.ts`)
> **Audience:** Developers. End users never define or select pipelines.

---

## 1. Summary

Previously the system ran exactly one analysis pipeline. Every signal — regardless of source — was funneled through the selector and then the single `default-trade-cycle` plan, whose id was a string literal in `run-trade-pipeline.ts`.

This feature lets developers define **multiple named pipelines** and **routes each incoming signal to a pipeline by its signal source type**. A pipeline is the **per-instrument trade-cycle plan** (`technical → fundamental → review → decision` + engine chains). The selector remains a **shared, source-adaptive front-door**: it already short-circuits self-describing signals (`signal-seeded` entry engine) and swaps discovery worker sets by processing mode, so it is _not_ part of a pipeline.

Phases stay a shared, global pool. A pipeline declares which signal-producing phases it runs; it does not invent phases. Adding a new phase to the pool remains a separate, out-of-scope act.

### Why "pipeline = trade-cycle plan", not selector + cycle

The selector and the trade-cycle are two distinct runtime objects: the selector is a `runPlan("selector")` fan-out pre-step (1 signal → N instruments, `AIPhaseRunner`); the cycle is `runPlan("default-trade-cycle")` run once per instrument (`InstrumentAnalysisRunner`). They are different registries and different interpreters. Unifying them was rejected as a large refactor of a live trading path with no current need: the existing sources already "select differently" via entry-engine + worker-set variants _inside_ the one selector. So the routable unit is the cycle.

---

## 2. User Story

> **As a** developer extending the trading engine,
> **I want to** define a new trade-cycle pipeline and bind it to one or more signal source types,
> **So that** signals from different sources run the analysis flow that fits them, without forking the orchestrator or touching phases/selector.

Secondary:

> **As a** developer, **I want** a signal with no matching pipeline to fall back to the default, **so that** adding pipelines is purely additive and never breaks existing sources.

---

## 3. Scope

**In scope (delivered):**

- `PipelineDescriptor` (`implementations/registry/pipeline-router.ts`): `id`, `displayName`, `phases` (the cycle's signal phases), `signalSources`, `isDefault`, `plan`.
- A router: `registerPipeline`, `resolvePipelineIdForSource(sourceType)`, `requirePipelineDescriptor`, `requiredSignalPhasesForPipeline`, and a boot-time `validatePipelineRegistry`.
- De-hardcoded orchestrator: `run-trade-pipeline.ts` calls `runPlan(context.pipelineId ?? DEFAULT_PIPELINE_ID, …)`; `pipelineId` is resolved from the signal's source type in `run-selector.ts` and threaded through `ResolvedInstrument → TradeCycleContext`.
- Required-output check (`requirePipelineAiResults`) derives its required set from the active pipeline's declared phases.
- A second real pipeline: `edgar-8k-cycle` for `edgar_8k`, identical AI phases to the default but dropping the `candidate_validation` engine stage (the filing already establishes the instrument).
- Loud validation: unknown phase, phases≠plan, duplicate id, duplicate-source conflict, not-exactly-one default — all throw (registration or boot).

**Out of scope:**

- Adding new phases to the pool (`PipelinePhase` union + `PHASE_DEFAULTS` edit).
- End-user UI / per-session pipeline override fields. Routing is by source type only.
- Unifying the selector and cycle interpreters.
- Making the `decision` phase tolerate a missing `review` (so pipelines cannot yet omit `review` — see §9, Open Questions).
- Schema/DB changes — none required.

---

## 4. Developer Interface — Authoring a Pipeline

### 4.1 `PipelineDescriptor` (as implemented)

```typescript
export interface PipelineDescriptor {
  id: string; // also the cycle-plan id for runPlan()
  displayName: string; // logs/diagnostics; not user-facing
  phases: readonly PipelinePhase[]; // must equal plan.inspect.phaseStages
  signalSources: readonly SignalSourceType[]; // each type claimed by ≤1 pipeline
  isDefault?: boolean; // exactly one across all descriptors
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
}
```

### 4.2 Files to add a pipeline

| Step | File                                        | What you write                                                                                                                                                                                  |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `implementations/<name>/<name>-analysis.ts` | The `InstrumentAnalysis`. Reuse `buildTradeAnalysisSteps(stages)` / `tradeCycleInspectMetadata(stages)` with a stage list (these now accept a `stages` param, defaulting to the default cycle). |
| 2    | `implementations/registry/pipelines.ts`     | The `PipelineDescriptor`, added to `ALL_PIPELINES`.                                                                                                                                             |

`register-analyses.ts` already loops `ALL_PIPELINES` → `registerPipeline` → `validatePipelineRegistry()`. No edits to `ai-phase.ts`, the orchestrator, the selector, or any phase file.

### 4.3 Worked example — the shipped `edgar-8k-cycle`

```typescript
// implementations/filing/edgar-8k-analysis.ts
const EDGAR_8K_STAGES = DEFAULT_TRADE_CYCLE_STAGES.filter(
  (stage) => stage.id !== "candidate_validation",
);
export const EDGAR_8K_TRADE_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "edgar-8k-cycle",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: tradeCycleInspectMetadata(EDGAR_8K_STAGES),
    stages: buildTradeAnalysisSteps(EDGAR_8K_STAGES),
  };

// implementations/registry/pipelines.ts
export const EDGAR_8K_PIPELINE: PipelineDescriptor = {
  id: "edgar-8k-cycle",
  displayName: "EDGAR 8-K (self-describing)",
  phases: ["technical", "fundamental", "review", "decision"],
  signalSources: ["edgar_8k"],
  plan: EDGAR_8K_TRADE_CYCLE,
};
```

The default pipeline (`default-trade-cycle`, `isDefault: true`, serves `web_search` + `manual`) wraps the unchanged `DEFAULT_TRADE_CYCLE`.

---

## 5. Flows

### 5.1 Routing

```mermaid
flowchart TD
    A[Signal delivery queued] --> B[Selector cycle: read signalTrigger.sourceType]
    B --> C[resolvePipelineIdForSource → pipelineId]
    C --> D[Stamp pipelineId on each ResolvedInstrument]
    D --> E[Per-instrument trade cycle]
    E --> F[runPlan(pipelineId): technical → … → decision → risk_gate]
```

1. A signal delivery flips to `queued`; the selector cycle runs (`run-selector.ts`) with `signalTrigger.sourceType`.
2. `resolvePipelineIdForSource(sourceType)` returns the descriptor whose `signalSources` includes it, else the default id. Signal-less cycles (initial / trade-closed research) pass `undefined` → default.
3. The resolved id is stamped on every `ResolvedInstrument`.
4. `runTradeCycle` copies it to `TradeCycleContext.pipelineId`; `runTradePipeline` runs `runPlan(pipelineId, …)`.

### 5.2 Required-output check

`requirePipelineAiResults(result, pipelineId)` computes the missing set from `requiredSignalPhasesForPipeline(pipelineId)` (the pipeline's phases ∩ `{technical, fundamental, review, decision}`) and reports it. It then still asserts all four are present, because the downstream trade-persistence path (`effect-runner`) consumes all four — a pipeline omitting any fails loud here (see §9).

### 5.3 Selector boundary

The selector is untouched. For self-describing sources (`edgar_8k`) it already short-circuits via the `signal-seeded` entry engine — zero discovery/verification workers, zero AI calls — and returns the named ticker. The `edgar-8k-cycle` therefore differs from the default only in the cycle (no `candidate_validation`), which is exactly the signal-first distinction.

---

## 6. Files Changed

| File                                                         | Change                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `pipeline/implementations/registry/pipeline-router.ts`       | **New** — descriptor, registry, router, validation                            |
| `pipeline/implementations/registry/pipelines.ts`             | **New** — `DEFAULT_PIPELINE`, `EDGAR_8K_PIPELINE`, `ALL_PIPELINES`            |
| `pipeline/implementations/filing/edgar-8k-analysis.ts`       | **New** — edgar cycle plan                                                    |
| `pipeline/implementations/__tests__/pipeline-router.test.ts` | **New** — routing + validation tests                                          |
| `pipeline/implementations/registry/register-analyses.ts`     | Register pipelines + `validatePipelineRegistry()`                             |
| `pipeline/implementations/trade/default-analysis-steps.ts`   | `tradeCycleInspectMetadata` / `buildTradeAnalysisSteps` take a `stages` param |
| `orchestration/cycle/types.ts`                               | `pipelineId?` on `ResolvedInstrument` + `TradeCycleContext`                   |
| `orchestration/cycle/selector/run-selector.ts`               | Resolve + stamp `pipelineId`                                                  |
| `orchestration/cycle/trade/trade-cycle.ts`                   | Thread `pipelineId` into the trade context + `requirePipelineAiResults`       |
| `orchestration/cycle/trade/run-trade-pipeline.ts`            | `runPlan(pipelineId)`; pipeline-aware required-output check                   |

`PipelinePhase` union, `PHASE_DEFAULTS`, `PIPELINE_PHASES`, selector, and all phase definitions are untouched. No schema/migration.

---

## 7. Registration & Validation Contract

`registerPipeline` (per descriptor): rejects duplicate id; phase not in `PIPELINE_PHASES`; `descriptor.phases ≠ plan.inspect.phaseStages`. `validatePipelineRegistry` (once at boot): rejects not-exactly-one `isDefault`; any signal source claimed by two pipelines. A bad pipeline crashes startup, not a mid-cycle signal.

`resolvePipelineIdForSource` is total — it returns the registered default, or the canonical `DEFAULT_PIPELINE_ID` when the registry is unpopulated (isolated unit tests). The boot validation is the real guarantee that a default exists in production.

---

## 8. Permissions & Access Control

Not applicable. Developer-only, code-level; no runtime API, IPC, or UI.

---

## 9. Error States, Edge Cases & Open Questions

| Scenario                                                     | Behavior                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Source has no mapped pipeline / signal-less cycle            | Falls back to default pipeline.                                                                                      |
| Two pipelines claim the same source                          | Boot crash (`claimed by both`).                                                                                      |
| Duplicate pipeline id / unknown phase / phases≠plan          | Registration throws.                                                                                                 |
| Pipeline omits a signal phase consumed downstream (`review`) | Fails loud in `requirePipelineAiResults`. **Not yet supported** — `decision`'s input builder hard-requires `review`. |
| Self-describing source mis-mapped to a discovery-heavy cycle | Runs the cycle as configured; selector still short-circuits discovery. No crash.                                     |

**Open questions (deferred):**

1. To allow a pipeline to omit `review` (or `fundamental`), make `decision`'s `buildInput` and `effect-runner` tolerate the missing signal. Until then, pipelines must keep all four phases.
2. Should a self-describing source mapped to a discovery cycle be a soft warning or a boot error?
3. Persist `pipelineId` on the trade / `agent_runs` record for audit?

---

## 10. Verification

- `bun run typecheck` — clean.
- `bun run vitest run electron/main/services/pipeline electron/main/services/orchestration` — 24 files / 129 + 8 new router tests passing.
- New tests cover: edgar_8k→edgar pipeline, web_search/manual/undefined→default, required-phase derivation, and all registration/boot validation failures.

# Other Phase Migrations

Technical, fundamental, review, and decision phases. Each is simpler than selector but all have the same structural problems: workers in `pipeline-discovery-config.ts`, execution objects in `implementations/trade/phase-analyses.ts`, metadata stubs in `definitions/`, and a factory wrapper (`createAggregatorAIPhase`) that prevents them from expressing full capabilities.

---

## The Factory Problem

`createAggregatorAIPhase()` in `implementations/trade/aggregator-phase-plan.ts` is a convenience wrapper that builds an `AIPhase` from a simplified config struct. It handles the flat-parallel-workers + LLM-aggregator pattern. It does not support:
- Multi-stage execution
- Entry modes
- Cache policies
- Input engines

When selector needed multi-stage, it couldn't use the factory. So selector got its own folder and raw `AIPhase` definition, creating the split that the rest of this refactor is undoing.

**The fix is not to extend the factory.** The fix is to eliminate it. All five phases use raw `AIPhase` definitions. The factory saves ~30 lines per phase at the cost of making phases unable to express full capability. That's the wrong tradeoff.

---

## State Type for Aggregator Phases

The factory currently uses `AggregatorPlanState`:
```ts
type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};
```

Each phase's new `definitions/*.phase.ts` file declares this type inline (or imports it from a shared location). The finalizer engine receives this state and extracts outputs by matching worker schemas — the same logic currently inside `collectWorkerOutputs` in the factory config.

---

## `pipeline-discovery-config.ts` — Full Deletion

This file holds worker arrays for three phases across two discovery modes (6 arrays + 3 resolver functions). It exists because worker arrays needed to be mode-switchable and nobody put them in the definition files.

**After migration:** this file is deleted. Worker arrays move inline to their phase definition files. Mode-switching is a single ternary in `resolveWorkers`.

---

## Technical Phase

### Files involved

| File | Role | Disposition |
|---|---|---|
| `definitions/technical.phase.ts` | `PipelineDefinition` metadata stub | **Replaced** — same path, new content: real `AIPhase` |
| `pipeline-discovery-config.ts` (technical section) | `STANDARD_TECHNICAL`, `EVENT_TECHNICAL`, `technicalWorkersForMode()` | **Deleted** — arrays move inline |
| `implementations/trade/phase-analyses.ts` (TECHNICAL_PLAN) | `AIPhase` via `createAggregatorAIPhase` | **Deleted** — replaced by `definitions/technical.phase.ts` |
| `signal/aggregators/technical-aggregator.ts` | LLM aggregation called from TECHNICAL_PLAN finalize | **Stays in place** — wrapped by `engines/finalizer/technical-aggregator.ts` |

### After

```ts
// definitions/technical.phase.ts

type TechnicalAggregatorState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};

const STANDARD_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  // chart-pattern worker
  // momentum worker
  // volume worker
];

const EVENT_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  // event-specific variants
];

export const TECHNICAL_PHASE: AIPhase<TechnicalAggregatorState, TechnicalSignal> = {
  phase: "technical",
  persistAggregate: false,
  finalizeEngineIds: ["technical-aggregator"],
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers: (ctx) =>
        ctx.strategyContext.researchPosture.discoveryMode === "event_contract_scan"
          ? EVENT_TECHNICAL_WORKERS
          : STANDARD_TECHNICAL_WORKERS,
      buildTask: (ctx) => ({
        instrumentSymbol: ctx.input.instrumentSymbol,
        selectorEvidence: ctx.input.selectorEvidence ?? null,
      }),
      concurrency: 3,
      toleratePartialFailure: false,
      applyResults: (ctx, _state, results) => ({
        workers: STANDARD_TECHNICAL_WORKERS, // or resolved from ctx
        workerResults: results,
      }),
    },
  ],
};
```

### What the finalizer engine looks like (LLM-calling)

```ts
// engines/finalizer/technical-aggregator.ts
import { registerEngine } from "../registry";
import type { FinalizerEngine } from "../types";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
  pickWorkerOutput,
} from "../../../signal/aggregators/technical-aggregator";

registerEngine<FinalizerEngine>({
  id: "technical-aggregator",
  kind: "finalizer",
  async run(ctx, state) {
    // This engine makes an LLM call. It is async and may be slow.
    const workerPayload = {
      chartPattern: pickWorkerOutput(state.workerResults, chartPatternOutputSchema),
      momentum: pickWorkerOutput(state.workerResults, momentumOutputSchema),
      volume: pickWorkerOutput(state.workerResults, volumeOutputSchema),
    };
    return runEngineForWorker<TechnicalSignal>({
      phase: "technical",
      sessionId: ctx.sessionId,
      cycleId: ctx.cycleId,
      strategyContext: ctx.strategyContext,
      bindings: [],
      binding: ENGINE_BINDINGS.technicalAggregatorFinalize,
      task: {
        symbol: ctx.input.instrumentSymbol as string,
        workers: workerPayload,
      },
    });
  },
});
```

`signal/aggregators/technical-aggregator.ts` is not moved. Only the schemas and `pickWorkerOutput` helper are imported.

---

## Fundamental Phase

### Files involved

| File | Role | Disposition |
|---|---|---|
| `definitions/fundamental.phase.ts` | Metadata stub | **Replaced** (same path, new content) |
| `pipeline-discovery-config.ts` (fundamental section) | `STANDARD_FUNDAMENTAL`, `EVENT_FUNDAMENTAL`, `fundamentalWorkersForMode()` | **Deleted** — arrays move inline |
| `implementations/trade/phase-analyses.ts` (FUNDAMENTAL_PLAN) | `AIPhase` via factory | **Deleted** |
| `signal/aggregators/fundamental-aggregator.ts` | LLM aggregation | **Stays in place** — wrapped by `engines/finalizer/fundamental-aggregator.ts` |

### After

Same structure as technical. Worker arrays inline. Single stage. `finalizeEngineIds: ["fundamental-aggregator"]`. Finalizer engine calls `runEngineForWorker` with `ENGINE_BINDINGS.fundamentalAggregatorFinalize`.

---

## Review Phase

### Files involved

| File | Role | Disposition |
|---|---|---|
| `definitions/review.phase.ts` | `PipelineDefinition` stub — workers ARE defined here and referenced from REVIEW_PLAN | **Replaced** (same path, new content) |
| `implementations/trade/phase-analyses.ts` (REVIEW_PLAN) | `AIPhase` via factory, uses `REVIEW_PHASE.workers` | **Deleted** |
| `signal/aggregators/review-aggregator.ts` | LLM aggregation | **Stays in place** — wrapped by `engines/finalizer/review-aggregator.ts` |

**Note:** Review phase workers are currently declared in `definitions/review.phase.ts` (unlike technical/fundamental which use `pipeline-discovery-config.ts`). No mode-switching. Two workers: `conflict-detector`, `risk-assessor`. The migration simply promotes these into a real `AIPhase` in the same file.

### After

```ts
// definitions/review.phase.ts

type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};

const REVIEW_WORKERS: readonly WorkerDefinition[] = [
  { id: "conflict-detector", ... },
  { id: "risk-assessor", ... },
];

export const REVIEW_PHASE: AIPhase<AggregatorPlanState, ReviewSignal> = {
  phase: "review",
  persistAggregate: false,
  finalizeEngineIds: ["review-aggregator"],
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers: () => REVIEW_WORKERS,
      buildTask: (ctx) => ({
        instrumentSymbol: ctx.input.instrumentSymbol,
        technicalSignal: JSON.stringify(signalForWorkerPrompt(ctx.input.technical as TechnicalSignal)),
        fundamentalSignal: JSON.stringify(signalForWorkerPrompt(ctx.input.fundamental as FundamentalSignal)),
      }),
      concurrency: 2,
      toleratePartialFailure: false,
      applyResults: (_ctx, _state, results) => ({ workers: REVIEW_WORKERS, workerResults: results }),
    },
  ],
};
```

---

## Decision Phase

### Files involved

| File | Role | Disposition |
|---|---|---|
| `definitions/decision.phase.ts` | `PipelineDefinition` stub — workers ARE defined here | **Replaced** (same path, new content) |
| `implementations/trade/phase-analyses.ts` (DECISION_PLAN) | `AIPhase` via factory, has mock scenario special case | **Deleted** |
| `signal/aggregators/trade-signal-aggregator.ts` | LLM aggregation | **Stays in place** — wrapped by `engines/finalizer/trade-signal-aggregator.ts` |

**Special case:** DECISION_PLAN has a mock scenario check:
```ts
const mockRelaxedEntryTiming =
  ctx.toolContext.isMockSession === true &&
  ctx.toolContext.mockScenarioKind === "clean_breakout";
```
This gets passed as part of the `buildFinalizeTask` payload. After migration this moves into the `trade-signal-aggregator` finalizer engine, which reads from `ctx.toolContext`. Do not silently drop. Verify the test that covers mock scenario behavior still passes.

### After

```ts
// definitions/decision.phase.ts

type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};

const DECISION_WORKERS: readonly WorkerDefinition[] = [
  { id: "signal-classifier", ... },
  { id: "entry-timer", ... },
];

export const DECISION_PHASE: AIPhase<AggregatorPlanState, TradeSignal> = {
  phase: "decision",
  persistAggregate: false,
  finalizeEngineIds: ["trade-signal-aggregator"],
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers: () => DECISION_WORKERS,
      buildTask: (ctx) => ({
        instrumentSymbol: ctx.input.instrumentSymbol,
        // ... other inputs
      }),
      concurrency: 2,
      toleratePartialFailure: false,
      applyResults: (_ctx, _state, results) => ({ workers: DECISION_WORKERS, workerResults: results }),
    },
  ],
};
```

---

## `implementations/trade/phase-analyses.ts` — Deletion Plan

This file holds `TECHNICAL_PLAN`, `FUNDAMENTAL_PLAN`, `REVIEW_PLAN`, `DECISION_PLAN` and `registerTradeAnalysisAIPhases()`. Each section migrates to its phase file. The file is deleted when all four sections are moved.

**Order:** Technical + fundamental together (Phase 3). Review + decision together (Phase 4). File deleted after Phase 4.

---

## `implementations/trade/aggregator-phase-plan.ts` — Deletion Plan

The `createAggregatorAIPhase()` factory. Review and decision use it until Phase 4 completes.

**Do not delete in Phase 3.** Review and decision still depend on it. Delete after Phase 4 completes.

---

## What Does NOT Change

`implementations/trade/default-analysis.ts` and `implementations/trade/default-analysis-steps.ts` are instrument-level analysis (the trade cycle runner), not phase definitions. They are NOT part of this refactor and are not touched.

`implementations/registry/register-analyses.ts` registers trade cycle analyses. Also NOT part of this refactor.

`analysis/` folder (`analysis/interpreter.ts`, `analysis/registry.ts`, etc.) — this is the instrument analysis runtime, separate from the phase runtime in `phases/`. Not touched.

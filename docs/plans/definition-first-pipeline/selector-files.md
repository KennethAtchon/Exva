# Selector File Inventory & Migration

Every file that currently exists because of the selector phase. What it does, what's wrong with it, and exactly what happens to it.

---

## The Problem in One Sentence

Selector's complexity was externalised into 8+ files across 6 folders instead of being expressed through the framework's existing primitives. None of these files needed to exist as standalone files. They exist because the framework had no engine registry and the phase had no uniform config shape.

---

## Complete File Inventory

### `definitions/selector.phase.ts`
**What it does:** 22-line stub declaring `SELECTOR_PHASE` as a `PipelineDefinition`. Imports workers from `pipeline-discovery-config.ts`. Never used for execution — the real `AIPhase` is `SELECTOR_PLAN` in `implementations/selector/selector-analysis.ts`.

**Why it exists:** The `definitions/` folder implied all phases should have a file here. This file satisfies that structural expectation without doing anything.

**Disposition:** **Replaced.** The stub content is deleted and replaced with a real `AIPhase<SelectorPlanState, InstrumentSelection>` config object. Same file path — new content. The old 22-line stub disappears. See "What `definitions/selector.phase.ts` looks like after" below.

---

### `implementations/selector/selector-analysis.ts`
**What it does:** The real `AIPhase<SelectorPlanState, InstrumentSelection>` definition (~400 lines). Contains: discovery stage (workers + `buildTask` + `applyResults` with `mergeDiscoveryCandidates` and `scoreSelectorCandidates`), verification stage (same pattern), `initialState()`, `finalize()` with direct calls to `SelectorRiskFilter` and `buildInstrumentSelection`, `filterOutput()`, `entryModes` array with `isManualSelectorMode` and `buildManualShortlistSelection`.

**Why it exists:** Selector needed multi-stage execution and couldn't use `createAggregatorAIPhase()` (which only handles flat parallel workers). So it got its own folder and raw `AIPhase` definition.

**Disposition:** **Deleted.** Content distributes as follows:

| What in this file | Goes to |
|---|---|
| Stage declarations (discovery, verification) | `definitions/selector.phase.ts` |
| `initialState()` | `definitions/selector.phase.ts` (optional function) |
| `filterOutput()` | `definitions/selector.phase.ts` (optional function) |
| `SelectorRiskFilter.evaluate()` call in `finalize()` | `engines/finalizer/selector-risk-filter.ts` (adapter over `signal/scoring/selector-risk-filter.ts`) |
| `buildInstrumentSelection()` call in `finalize()` | `engines/finalizer/selector-submission-builder.ts` (adapter over `signal/scoring/selector-submission-builder.ts`) |
| `buildSelectorEvidence()` call in `finalize()` | Moves into `engines/finalizer/selector-risk-filter.ts` (pre-processes candidates before filter evaluates) |
| `isManualSelectorMode` / `buildManualShortlistSelection` in `entryModes` | `engines/entry-mode/manual-shortlist.ts` |
| `mergeDiscoveryCandidates()` in discovery `applyResults()` | Stays as direct call inside the stage definition in `definitions/selector.phase.ts` — `applyResults()` is stage-local, exempt from engine registry |
| `scoreSelectorCandidates()` helper | Moves to `definitions/selector.phase.ts` as a local function or imports from `signal/scoring/selector-scoring-engine.ts` |
| `applyVerificationResults()` helper | Moves to `definitions/selector.phase.ts` as a local function |
| `assembleAggregateTrace()` call in `finalize()` | Framework concern — `AIPhaseRunner` handles this after finalizers complete |

Note: `finalize()` itself is deleted. There is no finalize function in the new definition. `finalizeEngineIds` replaces it.

---

### `implementations/selector/selector-schemas.ts`
**What it does:** Zod schemas for candidate output and verification output (`candidateOutputSchema`, `verificationOutputSchema`).

**Disposition:** **Moved** to `definitions/selector.schemas.ts`. These are the output contracts for selector workers and belong with the phase definition.

---

### `implementations/inputs/selector-scope.ts`
**What it does:** `InputBuilder` that produces the scope instruction string — either "full universe discovery" or the session's `instrumentScope` value.

**Disposition:** **Moved** to `engines/input/selector-scope.ts`. Registered as `kind: "input"` engine with ID `"selector-scope"`. Referenced on `definitions/selector.phase.ts` via `inputEngineIds: ["selector-scope", ...]`.

---

### `implementations/inputs/broker-coverage.ts`
**What it does:** `InputBuilder` that produces broker assignment and coverage constraint text — which instrument classes are tradable via which brokers.

**Disposition:** **Moved** to `engines/input/broker-coverage.ts`. Registered as `kind: "input"` engine with ID `"broker-coverage"`. Any phase that needs broker context can reference this ID — it is not selector-specific in principle.

---

### `implementations/inputs/prediction-market-candidates.ts`
**What it does:** `InputBuilder` that fetches prediction market candidates from the broker and injects them as a constrained candidate list.

**Disposition:** **Moved** to `engines/input/prediction-market-candidates.ts`. Registered as `kind: "input"` engine with ID `"prediction-market-candidates"`.

---

### `implementations/inputs/manual-shortlist.ts`
**What it does:** Two exported functions — `isManualSelectorMode(ctx)` and `buildManualShortlistSelection(session, maxConcurrentTrades)`. Does NOT implement `InputBuilder`. Called directly from `selector-analysis.ts` inside the `entryModes` array.

**What's wrong with it:** Floating utility file with no interface contract, doesn't conform to any framework type, can only be used by selector. The `if (isManualSelectorMode)` check inside selector-analysis is exactly the kind of conditional the engine registry eliminates.

**Disposition:** **Moved and promoted** to `engines/entry-mode/manual-shortlist.ts`. Implemented as a proper `EntryModeEngine` with `matches(ctx): boolean` and `resolve(ctx): InstrumentSelection`. Registered with ID `"manual-shortlist"`. Referenced on `definitions/selector.phase.ts` via `entryEngineIds: ["manual-shortlist"]`.

---

### `implementations/cache/selector-instrument-cache.ts`
**What it does:** `CachePolicy<InstrumentSelection>` — fingerprinting (hashes session config + broker routing + model), read (checks TTL + hash match), write (persists with TTL by holding style). ~195 lines.

**Disposition:** **Moved** to `engines/cache/selector-instrument-cache.ts`. Registered as `kind: "cache"` engine with ID `"selector-instrument-cache"`. Referenced on `definitions/selector.phase.ts` via `cacheEngineId: "selector-instrument-cache"`.

---

### `pipeline-discovery-config.ts` (selector section)
**What it does:** Exports `selectorDiscoveryWorkersForMode(discoveryMode)` — returns either `STANDARD_SELECTOR_DISCOVERY` or `EVENT_SELECTOR_DISCOVERY` worker arrays.

**Disposition:** **Selector section deleted.** Worker arrays (`STANDARD_SELECTOR_DISCOVERY`, `EVENT_SELECTOR_DISCOVERY`, `verificationWorkers()`) move inline to `definitions/selector.phase.ts`. Mode-switching is a single ternary in `resolveWorkers`.

---

### `services/session/preflight/selector-config-check.ts`
**What it does:** Preflight validation checking selector settings before a session starts.

**Disposition:** **Evaluate separately.** Session preflight concern, not a phase execution concern. Does not move to `engines/`. If it validates phase config, it may become a `kind: "validator"` engine. Review during Phase 2.

---

### `signal/scoring/selector-risk-filter.ts`
**What it does:** `SelectorRiskFilter` class — evaluates candidates against broker routing, instrument class constraints, and risk rules. Produces `{ accepted, rejected }`.

**Disposition:** **Stays in place.** An adapter file at `engines/finalizer/selector-risk-filter.ts` imports it and wraps it as a `FinalizerEngine`. Tests for `SelectorRiskFilter` remain in `signal/scoring/`.

---

### `signal/scoring/selector-submission-builder.ts`
**What it does:** `buildInstrumentSelection()` — builds the final `InstrumentSelection` output from accepted candidates.

**Disposition:** **Stays in place.** An adapter at `engines/finalizer/selector-submission-builder.ts` imports it and wraps it as a `FinalizerEngine`.

---

### `signal/scoring/selector-candidate-merger.ts`
**What it does:** `mergeDiscoveryCandidates()` — deduplicates candidates from multiple discovery workers by symbol.

**Disposition:** **Stays in place.** Called directly from the discovery stage's `applyResults()` in `definitions/selector.phase.ts`. `applyResults()` is stage-local — no engine wrapping needed.

---

### `signal/scoring/selector-scoring-engine.ts`
**What it does:** `scoreCandidate()` — scores a single candidate using weighted signals (volume, liquidity, catalyst, risk flags).

**Disposition:** **Stays in place.** Called directly from `scoreSelectorCandidates()` helper inside the stage `applyResults()` functions. Stage-local — no engine wrapping needed.

---

## What `definitions/selector.phase.ts` Looks Like After

All phase-level business logic is gone. Workers and stage functions are declared inline. Everything else is an engine ID.

```ts
// definitions/selector.phase.ts

import type { AIPhase } from "../phases/types";
import type { InstrumentSelection } from "@/lib/schemas";
import type { SelectorPlanState } from "./selector.schemas";
import {
  candidateOutputSchema,
  verificationOutputSchema,
  STANDARD_DISCOVERY_WORKERS,
  EVENT_DISCOVERY_WORKERS,
} from "./selector.schemas";
import {
  mergeDiscoveryCandidates,
  type SelectorCandidate,
} from "../../signal/scoring/selector-candidate-merger";
import { scoreCandidate } from "../../signal/scoring/selector-scoring-engine";
import { DEFAULT_SCORING_WEIGHTS } from "@electron/shared/ai/ai-phase-config";
import { AppError } from "@electron/shared/infra/errors";

// Stage-local helpers — allowed because they're inside applyResults(), not finalize()
function scoreSelectorCandidates(candidates: SelectorCandidate[]): SelectorCandidate[] {
  return candidates
    .map(c => ({ ...c, finalScore: scoreCandidate(c, DEFAULT_SCORING_WEIGHTS) }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}

function applyVerificationResults(
  candidates: SelectorCandidate[],
  results: Array<{ worker: WorkerDefinition; result: LLMRunResult<VerificationOutput> }>,
): SelectorCandidate[] {
  // ... merge verification outputs into candidate records ...
}

export const SELECTOR_PHASE: AIPhase<SelectorPlanState, InstrumentSelection> = {
  phase: "selector",

  // Framework resolves these from engines/input/ and concatenates into worker prompt context
  inputEngineIds: ["selector-scope", "broker-coverage", "prediction-market-candidates"],

  // Framework checks these before running stages; first match short-circuits
  entryEngineIds: ["manual-shortlist"],

  // Framework handles cache read before stages, cache write after finalize
  cacheEngineId: "selector-instrument-cache",

  // Framework runs these in order after all stages complete
  finalizeEngineIds: ["selector-risk-filter", "selector-submission-builder"],

  initialState(ctx) {
    const selectionInstructions = ctx.input.selectionInstructions;
    if (typeof selectionInstructions !== "string" || selectionInstructions.length === 0) {
      throw new AppError("Selector phase input requires selectionInstructions.", "VALIDATION_FAILED");
    }
    return {
      selectionInstructions,
      discoveryWorkerIds: [],
      candidatesForVerification: [],
      verifiedCandidates: [],
    };
  },

  stages: [
    {
      id: "discovery",
      frontier: 0,
      resolveWorkers: (ctx) =>
        ctx.strategyContext.researchPosture.discoveryMode === "event_contract_scan"
          ? EVENT_DISCOVERY_WORKERS
          : STANDARD_DISCOVERY_WORKERS,
      buildTask: (ctx) => ({
        selectionInstructions: ctx.input.selectionInstructions,
        instrumentClasses: ctx.instrumentClasses,
        discoveryMode: ctx.strategyContext.researchPosture.discoveryMode,
      }),
      concurrency: 3,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults: (ctx, state, results) => {
        // applyResults is stage-local — direct utility calls are correct here
        const merged = mergeDiscoveryCandidates(results.map(...));
        const scored = scoreSelectorCandidates(merged);
        return { ...state, discoveryWorkerIds: results.map(({worker}) => worker.id), candidatesForVerification: scored.slice(0, 5) };
      },
    },
    {
      id: "verification",
      frontier: 1,
      resolveWorkers: (_ctx, state) =>
        state.candidatesForVerification.flatMap(verificationWorkersForCandidate),
      buildTask: (_ctx, state, worker) => {
        const symbol = worker.id.split(":")[1] ?? "";
        const candidate = state.candidatesForVerification.find(c => c.symbol === symbol);
        return { selectionInstructions: state.selectionInstructions, candidate };
      },
      concurrency: 4,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults: (_ctx, state, results) => {
        const verified = applyVerificationResults(state.candidatesForVerification, results);
        return { ...state, verifiedCandidates: scoreSelectorCandidates(verified) };
      },
    },
  ],

  filterOutput: (output, ctx) => ({
    ...output,
    instruments: output.instruments
      .filter(row => ctx.instrumentClasses.includes(row.instrumentClass))
      .slice(0, ctx.strategyContext.riskConfig.maxConcurrentTrades),
  }),
};
```

**No imports from `signal/scoring/` for risk filter or submission builder.** Those are engine IDs now. `mergeDiscoveryCandidates` and `scoreCandidate` are still imported directly — they're called inside `applyResults()` which is stage-local. `finalize()` is gone entirely. No `entryModes` array. No cache policy object. Just config + stage declarations.

---

## What the Finalizer Adapter Engines Look Like

```ts
// engines/finalizer/selector-risk-filter.ts
import { registerEngine } from "../registry";
import type { FinalizerEngine } from "../types";
import { SelectorRiskFilter } from "../../../signal/scoring/selector-risk-filter";
import { buildSelectorEvidence } from "../../../signal/scoring/selector-risk-filter"; // or separate helper
import type { SelectorPlanState } from "../../definitions/selector.schemas";

registerEngine<FinalizerEngine<SelectorPlanState>>({
  id: "selector-risk-filter",
  kind: "finalizer",
  async run(ctx, state) {
    // buildSelectorEvidence was previously called inside finalize() before the filter
    const withEvidence = state.verifiedCandidates.map(c => ({
      ...c,
      selectorEvidence: buildSelectorEvidence(c),
    }));
    return new SelectorRiskFilter({
      sessionId: ctx.sessionId,
      instrumentClasses: ctx.instrumentClasses,
      strategyContext: ctx.strategyContext,
      brokerRouting: ctx.toolContext.brokerRouting,
    }).evaluate(withEvidence);
    // returns { accepted, rejected } — fed as state to selector-submission-builder
  },
});
```

```ts
// engines/finalizer/selector-submission-builder.ts
import { registerEngine } from "../registry";
import type { FinalizerEngine } from "../types";
import { buildInstrumentSelection } from "../../../signal/scoring/selector-submission-builder";

registerEngine<FinalizerEngine>({
  id: "selector-submission-builder",
  kind: "finalizer",
  async run(ctx, evaluationResult) {
    const output = {
      ...buildInstrumentSelection(
        evaluationResult.accepted,
        ctx.strategyContext.riskConfig.maxConcurrentTrades,
      ),
      diagnostics: {
        acceptedCount: evaluationResult.accepted.length,
        rejected: evaluationResult.rejected,
        // workerToolCoverage is assembled by AIPhaseRunner using workerResults
      },
    };
    return output; // TOutput — InstrumentSelection
  },
});
```

The files in `signal/scoring/` are not touched. The engine files are thin call-throughs.

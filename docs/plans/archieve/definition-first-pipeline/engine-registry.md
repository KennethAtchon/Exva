# Engine Registry

The engine registry is how the framework exposes capabilities that phases can opt into. Every engine is a named, typed object registered once at boot. Phases reference engines by ID. The framework resolves and invokes them.

---

## The Pattern

**Wrong:**

```ts
// Inside selector-analysis.ts finalize():
const scored = scoreCandidate(candidates, DEFAULT_SCORING_WEIGHTS);
const filtered = new SelectorRiskFilter(ctx).evaluate(scored);
const output = buildInstrumentSelection(filtered.accepted, maxConcurrentTrades);
```

Direct calls. Hardcoded in the selector execution path. Adding another step means editing this function and adding another import.

**Right:**

```ts
// In selector.phase.ts:
finalizeEngineIds: ["selector-risk-filter", "selector-submission-builder"]

// mergeDiscoveryCandidates / scoreSelectorCandidates run inside stage applyResults() — not finalizers

// In engines/finalizer/selector-risk-filter.ts:
registerEngine({
  id: "selector-risk-filter",
  kind: "finalizer",
  run(ctx, state) { ... }
});
```

The phase config declares what runs. The engine implements how. The framework connects them.

---

## How to Add a New Engine

1. Create a file in `engines/[kind]/[engine-id].ts`
2. Implement the engine interface for that kind
3. Call `registerEngine(engine)` at the bottom of the file
4. Import the file from `engines/index.ts`
5. Add the engine ID to any phase definition that needs it

That's it. No changes to the runtime. No changes to any phase's execution flow.

---

## Engine Kinds

### `input` — context injection

Builds a string block injected into the worker's system prompt before execution. Used to provide the AI with session-specific context it needs to do its job.

**Interface:**

```ts
interface InputEngine extends Engine {
  kind: "input";
  build(ctx: AIPhaseContext): Promise<string | null>;
}
```

**Returns `null`** to opt out (e.g. `prediction-market-candidates` returns null if no prediction_market instruments are in scope).

**Current engines:**

| ID                             | File                                            | What it injects                                                      |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| `selector-scope`               | `engines/input/selector-scope.ts`               | Scope instruction: full-universe or constrained to `instrumentScope` |
| `broker-coverage`              | `engines/input/broker-coverage.ts`              | Which instrument classes are tradable via which brokers              |
| `prediction-market-candidates` | `engines/input/prediction-market-candidates.ts` | Pre-fetched canonical prediction market rows                         |

**Example:**

```ts
// engines/input/broker-coverage.ts
registerEngine<InputEngine>({
  id: "broker-coverage",
  kind: "input",
  async build(ctx) {
    const brokers = ctx.services.sessionBrokerAssignmentsRepo
      .listBrokerAccountIds(ctx.session.id)
      .map((id) => ctx.services.brokerAccountsRepo.find(id))
      .filter(Boolean);
    // ... build and return coverage string
    return coverageString;
  },
});
```

---

### `entry_mode` — short-circuit

Checked before stages run. If `matches()` returns true, the framework calls `resolve()` and returns the output directly. Stages, finalizers, and cache write are all skipped.

**Interface:**

```ts
interface EntryModeEngine extends Engine {
  kind: "entry_mode";
  matches(ctx: AIPhaseContext): boolean | Promise<boolean>;
  resolve(ctx: AIPhaseContext): unknown | Promise<unknown>;
}
```

**Current engines:**

| ID                 | File                                     | Condition                                                                             |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `manual-shortlist` | `engines/entry-mode/manual-shortlist.ts` | `session.selectionMode === "manual_shortlist"` or `!selectorSettings.aiPickerEnabled` |

**Example:**

```ts
// engines/entry-mode/manual-shortlist.ts
registerEngine<EntryModeEngine>({
  id: "manual-shortlist",
  kind: "entry_mode",
  matches(ctx) {
    const settings = ctx.services.sessionSelectorSettingsRepo.get(
      ctx.sessionId,
    );
    return (
      ctx.session.selectionMode === "manual_shortlist" ||
      !settings.aiPickerEnabled
    );
  },
  resolve(ctx) {
    return buildManualShortlistSelection(
      ctx.session,
      ctx.strategyContext.riskConfig.maxConcurrentTrades,
    );
  },
});
```

---

### `cache` — result reuse

Fingerprints the phase inputs, checks for a valid cached result, writes the result after completion.

**Interface:**

```ts
interface CacheEngine<TOutput> extends Engine {
  kind: "cache";
  fingerprint(ctx: AIPhaseContext): string;
  read(ctx: AIPhaseContext, fingerprint: string): TOutput | null;
  write(
    ctx: AIPhaseContext,
    fingerprint: string,
    output: TOutput,
    meta: { agentRunId: string; cycleId: string },
  ): void;
}
```

**Current engines:**

| ID                          | File                                         | What it caches                                                           |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `selector-instrument-cache` | `engines/cache/selector-instrument-cache.ts` | `InstrumentSelection` keyed by session config hash, TTL by holding style |

---

### `finalizer` — post-stage processing

Runs after all stages complete. Multiple finalizers run in the order declared in `finalizeEngineIds`. Each receives stage results + current state and produces the next state. Last finalizer produces the phase output.

**Interface:**

```ts
interface FinalizerEngine<TState = unknown, TOutput = unknown> extends Engine {
  kind: "finalizer";
  run(
    ctx: AIPhaseContext,
    state: TState,
    workerResults: WorkerResult[],
  ): Promise<TState | TOutput>;
}
```

**Execution is sequential.** Output of engine N is the `state` input to engine N+1.

**Current engines (selector chain):**

| ID                            | File                                               | What it does                                                                           |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `selector-risk-filter`        | `engines/finalizer/selector-risk-filter.ts`        | Adds selector evidence, then filters by broker routing + instrument class + risk rules |
| `selector-submission-builder` | `engines/finalizer/selector-submission-builder.ts` | Builds `InstrumentSelection` from accepted candidates                                  |

**Not finalizer engines (stage-local only):**

- `mergeDiscoveryCandidates` — called directly in discovery stage `applyResults()`, not through registry
- `scoreCandidate` / `scoreSelectorCandidates` — called directly in both stage `applyResults()` functions, not through registry

**Current engines (trade analysis phases):**

| ID                        | File                                           | Phase       |
| ------------------------- | ---------------------------------------------- | ----------- |
| `technical-aggregator`    | `engines/finalizer/technical-aggregator.ts`    | technical   |
| `fundamental-aggregator`  | `engines/finalizer/fundamental-aggregator.ts`  | fundamental |
| `review-aggregator`       | `engines/finalizer/review-aggregator.ts`       | review      |
| `trade-signal-aggregator` | `engines/finalizer/trade-signal-aggregator.ts` | decision    |

---

### `context` — worker-level context (existing pattern)

Already implemented as `ENGINE_BINDINGS` in `ai-phase-config.ts`. These are engines referenced on individual workers (`engines: [ENGINE_BINDINGS.riskSummaryRead]`), not on phases. This kind is unchanged by this refactor — it already follows the right pattern.

---

## Engine ID Naming Convention

```
[domain]-[action]

broker-coverage           ← domain: broker, action: coverage
selector-scope            ← domain: selector, action: scope
manual-shortlist          ← domain: manual, action: shortlist
selector-instrument-cache ← domain: selector-instrument, action: cache
selector-risk-filter      ← domain: selector-risk, action: filter
selector-submission-builder ← domain: selector-submission, action: builder
technical-aggregator      ← domain: technical, action: aggregator
```

Stage-local utilities (`mergeDiscoveryCandidates`, `scoreSelectorCandidates`) are **not** registered engines — they stay as direct calls inside `applyResults()`.

IDs are lowercase kebab-case. They don't need to include the engine kind (the registry enforces kind at resolution time).

---

## What an Engine File Looks Like

Minimal structure — implement, register, done. Engine files are adapters: they import from wherever the logic lives and wrap it in the engine interface.

```ts
// engines/finalizer/selector-risk-filter.ts
import { registerEngine } from "../registry";
import type { FinalizerEngine } from "../types";
import { SelectorRiskFilter } from "../../../signal/scoring/selector-risk-filter";
import type { SelectorPlanState } from "../../definitions/selector.schemas";

// buildSelectorEvidence() moves here from selector-analysis.ts — it is not exported from signal/
function buildSelectorEvidence(candidate: SelectorCandidate): SelectorEvidence { ... }

registerEngine<FinalizerEngine<SelectorPlanState>>({
  id: "selector-risk-filter",
  kind: "finalizer",
  async run(ctx, state) {
    const withEvidence = state.verifiedCandidates.map(c => ({
      ...c,
      selectorEvidence: buildSelectorEvidence(c),
    }));
    const evaluation = new SelectorRiskFilter({
      sessionId: ctx.sessionId,
      instrumentClasses: ctx.instrumentClasses,
      strategyContext: ctx.strategyContext,
      brokerRouting: ctx.toolContext.brokerRouting,
    }).evaluate(withEvidence);
    // Pass counts forward — submission-builder no longer receives full SelectorPlanState
    return {
      ...evaluation,
      discoveredCount: state.candidatesForVerification.length,
      verifiedCount: state.verifiedCandidates.length,
    };
  },
});
```

The file has one job: implement and register. No exports needed — the side-effect import in `engines/index.ts` is enough.

**Note on `selector-scoring`:** `scoreCandidate()` from `signal/scoring/selector-scoring-engine.ts` is NOT a finalizer engine. It is called directly inside stage `applyResults()` functions in `definitions/selector.phase.ts`. Stage-local calls do not go through the engine registry.

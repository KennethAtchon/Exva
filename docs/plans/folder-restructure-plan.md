# Folder & Naming Restructure Plan

> **Goal:** Make every folder, file, class, type, and function name self-explanatory. A developer reads a name and immediately knows what it is and what it does — no context required.
> Created: 2026-05-23

---

## The Core Problem

Two categories of rot, both need fixing together:

**Structural rot** — Folders are buckets (`ai/`, `orchestration/`) that hide what's inside. Related things are scattered; unrelated things are grouped.

**Naming rot** — The word `plan` does triple duty. `cycle` means the trading tick AND the outer AI pipeline. `phase` is a pipeline concept AND a DB column. `stage` means a frontier of workers AND a step in a cycle. `engine` appears in `ai-runtime`, `pipeline-runtime`, `engines/`, and `orchestration/`. Nobody reading a class name knows what it owns.

These are fixed in one complete pass, not incrementally.

---

## Change 1: Split `services/llm/` — the biggest problem

`services/llm/` is a bucket containing six distinct subsystems with no obvious relationship to each other. It gets split entirely.

### Current structure (the problem)

```
services/llm/
├── ai-runtime/        # raw LLM calls
├── pipeline/  # multi-phase analysis pipeline
├── engines/           # signal aggregation + scoring
├── adapters/          # model provider normalization
├── search/            # web search providers
└── tools/             # LLM-callable tool definitions
```

### New structure

```
services/
├── llm/               # was: ai/llm/ + ai/adapters/
├── pipeline/          # was: ai/pipeline/
├── signal/            # was: ai/engines/
├── search/            # was: ai/search/ — promoted, unchanged
└── tools/             # was: ai/tools/ — promoted, unchanged
```

---

## Change 2: `services/llm/` — LLM invocation layer

**Was:** `services/llm/` + `services/llm/adapters/`

**What it owns:** One job — talk to an LLM API. Send messages, receive a response, handle retries, detect tool-call loops, record a trace.

### Folder rename

```
services/llm/
├── runtime.ts               # was: ai-runtime/runtime.ts
├── runtime-retry.ts         # unchanged
├── runtime-trace.ts         # unchanged
├── tool-loop-guard.ts       # unchanged
├── llm-types.ts             # was: ai-runtime/ai-runtime-types.ts
├── index.ts
└── adapters/                # was: ai/adapters/ — moved here
    ├── llm-adapter.ts       # was: anthropic-adapter.ts (see type renames below)
    ├── anthropic-adapter.ts # unchanged name — it's a concrete implementation
    ├── openai-adapter.ts
    └── openrouter-adapter.ts
```

### Type and class renames

| Old | New | Why |
|-----|-----|-----|
| `AiRuntime` | `LLMRuntime` | Consistent casing; direct |
| `RuntimeAgentMessage` | `LLMMessage` | "RuntimeAgent" is noise — it's a message to/from an LLM |
| `RunTrace<T>` | `LLMCallTrace<T>` | A trace of one LLM call |
| `StepTrace` | `LLMToolStepTrace` | One tool call within an LLM call |
| `ToolCallRecord` | `LLMToolCall` | — |
| `AgentResult<T>` | `LLMRunResult<T>` | "Agent" bleeds from Anthropic API naming; internally it's an LLM run result |
| `withProviderRetry` | `withLLMRetry` | — |
| `ProviderRetryContext` | `LLMRetryContext` | — |
| `toRunFromTrace` | `traceToRunRecord` | Verb-object order; direction is clear |
| `buildTraceMessage` | `buildLLMTraceMessage` | — |

---

## Change 3: `services/pipeline/` — AI analysis pipeline

**Was:** `services/ai/pipeline-runtime/`

**What it owns:** The multi-phase AI trade analysis logic. Builds prompts, sequences phases, runs workers, tracks spend, aggregates outputs.

The `-runtime` suffix is dropped — "pipeline" is the concept; "runtime" is redundant (everything in `services/` runs at runtime).

### Folder rename

```
services/pipeline/
├── core/              # framework: PipelineRuntime, concurrent runner, types
├── definitions/       # static phase definitions — what workers exist per phase
├── phases/            # was: plan/phase/ — AIPhaseRunner + AIPhase types
├── analysis/          # was: plan/cycle/ — InstrumentAnalysisRunner + InstrumentAnalysis types
├── execution/         # WorkerExecutor, AISpendTracker, TraceAssembler
├── prompting/         # WorkerPromptBuilder, strategy guidance
├── worker-tools/      # builds the tool set for each worker run
├── prompts/           # worker markdown prompt files
│   ├── selector/      # was: selector-workers/
│   ├── technical/     # was: technical-workers/
│   ├── fundamental/   # was: fundamental-workers/
│   ├── review/        # was: review-workers/
│   └── decision/      # was: decision-workers/
└── implementations/   # was: analyses/ — concrete trading-specific implementations
    ├── selector/      # HOW the selector analysis runs: discovery → verification → finalize + caching
    ├── trade/         # HOW the trade analysis runs: technical → fundamental → review → decision → risk
    ├── inputs/        # was: input-builders/ + engine-input-builders/ (merged — same concept)
    ├── cache/         # selector result cache policy
    └── registry/      # was: registry/ + register/ + unified/ — wires everything together, dispatches by ID
```

#### What moved where in `plan/`

The current `plan/` has 10 subdirectories with overlapping names. All collapsed:

```
Old path                              New path
plan/phase/                       →   pipeline/phases/
plan/cycle/                       →   pipeline/analysis/
plan/plans/selector/              →   pipeline/implementations/selector/
plan/plans/trade/                 →   pipeline/implementations/trade/
plan/engine/                      →   pipeline/execution/                      (merged — plan executor IS execution)
plan/engine-input-builders/       →   pipeline/implementations/inputs/         (merged with input-builders/)
plan/input-builders/              →   pipeline/implementations/inputs/         (merged above)
plan/cache/                       →   pipeline/implementations/cache/
plan/registry/ + plan/register/   →   pipeline/implementations/registry/       (two folders, one concept)
plan/unified/                     →   pipeline/implementations/registry/       (dispatcher folded into registry)
```

#### Framework vs. implementations — why the split

`core/`, `phases/`, `analysis/`, `execution/`, `prompting/`, `worker-tools/` are the **framework** — generic machinery that knows nothing about trading. You could swap in a different domain and reuse all of it.

`implementations/` is everything **specific to this trading system**: the selector logic (two-stage: discover instruments, then verify top candidates), the trade analysis sequence (technical → fundamental → review → decision → risk gate), the input builders that pull session state to feed each phase, and the registry that wires it all together.

#### Why selector and trade are both top-level under `implementations/`

They are two distinct analyses, not nested:
- `selector/` — finds instruments worth trading (runs once per session tick, before any trade analysis)
- `trade/` — analyzes one specific instrument to decide whether to trade it (runs per instrument)

They run at different times, serve different purposes, and have different execution logic. Parallel siblings, not parent/child.

### Type and class renames

#### Outer pipeline (was "CyclePlan")

Not a "plan." Not a "cycle." It's the definition of a full instrument analysis — the ordered sequence of steps that runs when the orchestrator picks an instrument to evaluate.

| Old | New | Why |
|-----|-----|-----|
| `CyclePlan<TState>` | `InstrumentAnalysis<TState>` | What it is: a definition of how to analyze one instrument |
| `CyclePlanStage<TState>` | `AnalysisStep<TState>` | One step in the analysis sequence |
| `CyclePlanInterpreter` | `InstrumentAnalysisRunner` | Runs an instrument analysis |
| `CyclePlanInterpreterRunInput` | `InstrumentAnalysisRunInput` | — |
| `CyclePlanRunContext` | `InstrumentAnalysisContext` | — |
| `TradeCyclePlanState` | `InstrumentAnalysisState` | State accumulated as each step completes |
| `CyclePausedError` | `AnalysisPausedError` | — |
| `CycleStageFailedError` | `AnalysisStepFailedError` | — |
| `registerCyclePlan` / `getCyclePlan` | `registerInstrumentAnalysis` / `getInstrumentAnalysis` | — |
| `CyclePlanServices` | `InstrumentAnalysisServices` | — |
| `buildCycleStageExecute` | `buildAnalysisStepExecute` | — |
| `runDeclarativeStage` | `runAnalysisStep` | — |
| `CyclePlanInspectMetadata` | `InstrumentAnalysisMetadata` | — |
| `CycleStepRunner` | `AnalysisStepRunner` | — |
| `TradePipelineResult` | `InstrumentAnalysisResult` | Consistent with new naming |

#### AI phases (was "PhasePlan")

A `PhasePlan` IS an AI phase — "plan" is the wrong word.

| Old | New | Why |
|-----|-----|-----|
| `PhasePlan<TState, TOutput>` | `AIPhase<TState, TOutput>` | Direct |
| `PhasePlanInterpreter` | `AIPhaseRunner` | Runs a phase |
| `PhasePlanInterpreterRunInput` | `AIPhaseRunInput` | — |
| `PhasePlanRunContext` | `AIPhaseContext` | — |
| `PhasePlanRunResult<TOutput>` | `AIPhaseResult<TOutput>` | — |
| `PhasePlanStage<TState>` | `AIWorkerBatch<TState>` | A group of workers at the same dependency level |
| `PhasePlanWorkerTrace` | `AIWorkerTrace` | — |
| `PhasePlanSource` | `AIPhaseSource` | — |
| `PhasePlanInspectMetadata` | `AIPhaseMetadata` | — |
| `PhasePlanServices` | `AIPhaseServices` | — |
| `registerPhasePlan` / `getPhasePlan` | `registerAIPhase` / `getAIPhase` | — |
| `PhaseEntryMode` | `AIPhaseEntryMode` | — |
| `PhaseRunInput` | `AIPhaseRunInput` | — |
| `PhaseRunResult` | `AIPhaseResult` | — |
| `PhaseConfigResolver` | `AIPhaseConfigResolver` | — |

#### Workers and execution

| Old | New | Why |
|-----|-----|-----|
| `executeWorker` | `runAIWorker` | Verb-first; matches pattern |
| `WorkerExecutorDeps` | `AIWorkerRunnerDeps` | — |
| `WorkerRunOptions` | `AIWorkerRunOptions` | — |
| `WorkerOutputContract` | `AIWorkerOutputSchema` | It's a Zod schema + inferred type, not a "contract" |
| `WorkerGraphNode` | `AIWorkerNode` | — |
| `WorkerGraphScheduleResult` | `AIWorkerSchedule` | — |
| `buildWorkerSchedule` | `scheduleWorkersByDependency` | Says what it does |
| `executeByFrontier` | `runWorkerBatches` | "frontier" is internal jargon |
| `PipelineWorkerRunner` | `AIWorkerRunner` | — |
| `runConcurrentGroup` | `runWorkersConcurrently` | — |
| `ResolvedWorkerRuntimeConfig` | `WorkerExecConfig` | "Resolved" is always implied — drop it |
| `EngineContextRunInput` | `EngineInjectionInput` | — |
| `runReadEngineContext` | `injectEngineResults` | What it does: injects engine output into prompt context |
| `runEngineBinding` | `runEngineForWorker` | — |

#### Spend tracking

| Old | New | Why |
|-----|-----|-----|
| `PipelineSpendTracker` | `AISpendTracker` | "Pipeline" is obvious from context |
| `PipelineSpendTrackerOptions` | `AISpendTrackerOptions` | — |
| `SpendCapKind` | `SpendCapLevel` | "kind" is vague; "level" (phase/pipeline/session) is what it means |
| `SpendCapExceeded` | `SpendCapExceededError` | Should be an Error, not a plain object |

#### Prompts and envelopes

| Old | New | Why |
|-----|-----|-----|
| `PromptEnvelope` | `WorkerPromptMessages` | "Envelope" is metaphor — it's literally the messages array sent to the model |
| `PromptEnvelopeInput` | `WorkerPromptInput` | — |
| `PromptEnvelopeSizeReport` | `PromptSizeReport` | — |
| `buildPromptEnvelope` | `buildWorkerPrompt` | — |
| `envelopeToMessages` | Remove — fold into `buildWorkerPrompt` return | Pointless indirection |
| `measurePromptEnvelope` | `measureWorkerPrompt` | — |
| `buildPresetBehaviorGuidance` | `buildStrategyGuidance` | "Preset behavior" is a DB concept leaking into prompting |

#### Tools and context

| Old | New | Why |
|-----|-----|-----|
| `ToolBuildContext` | `WorkerToolContext` | "Build context" sounds like a constructor arg — it IS the worker's tool context |
| `buildToolSet` | `buildWorkerTools` | — |
| `buildToolContext` | `resolveWorkerToolContext` | — |
| `ToolContextBuilderDeps` | `WorkerToolResolverDeps` | — |
| `context/` (folder) | `worker-tools/` | "context" in AI means token window/knowledge — not tool dependencies |
| `analyses/` (folder) | `implementations/` | Clearer — it holds HOW the selector and trade analyses are implemented |
| `unified/` (folder) | dissolved into `implementations/registry/` | "unified" says nothing; it's a dispatcher folded into the registry |
| `PlanInterpreter` | `AnalysisDispatcher` | Given any ID, dispatches to the right runner (AIPhaseRunner or InstrumentAnalysisRunner) |
| `UnifiedPlanDefinition` | `AnyAnalysisDefinition` | Discriminated union of a phase or full instrument analysis |
| `UnifiedPlanInspectMetadata` | `AnalysisInspectMetadata` | — |
| `resolveUnifiedPlan` | `resolveAnalysis` | — |
| `requireUnifiedPlan` | `requireAnalysis` | — |
| `listUnifiedPlanIds` | `listAnalysisIds` | — |
| `inspectUnifiedPlan` | `inspectAnalysis` | — |
| `PlanKind` | `AnalysisKind` | — |
| `HarnessToolAvailability` | `WorkerToolAvailability` | "Harness" is an internal framework word leaking into domain names |
| `TerminalOutputToolSpec` | `SubmitOutputToolSpec` | "Terminal" means "final" here — "Submit" is explicit |
| `DEFAULT_TERMINAL_TOOL_DESCRIPTION` | `DEFAULT_SUBMIT_TOOL_DESCRIPTION` | — |
| `extractTerminalSubmission` | `extractWorkerSubmission` | — |
| `resolveStructuredWorkerOutput` | `parseWorkerOutput` | — |
| `StructuredOutputAttempt` | `WorkerOutputAttempt` | — |

---

## Change 4: `services/signal/` — post-LLM signal processing

**Was:** `services/signal/`

**What it owns:** Deterministic TypeScript logic that runs after AI workers — aggregates outputs, scores candidates, filters by risk, builds execution profiles. No AI calls.

### Folder rename

```
services/signal/
├── aggregators/         # unchanged — merges worker outputs per phase
│   ├── technical-aggregator.ts
│   ├── fundamental-aggregator.ts
│   ├── review-aggregator.ts
│   └── trade-signal-aggregator.ts
├── scoring/             # was: selector/ — scoring + filtering engines
│   ├── selector-scoring-engine.ts
│   ├── selector-candidate-merger.ts
│   ├── selector-risk-filter.ts
│   ├── selector-submission-builder.ts
│   └── prediction-market-candidate-engine.ts
├── execution/           # unchanged — execution profile engine
│   └── trade-execution-profile.ts   # was: execution-profile-engine.ts
└── registry/            # unchanged
    ├── signal-engine-registry.ts    # was: engine-registry.ts
    ├── register-trade-signal-engines.ts  # was: register-pipeline-engines.ts
    └── register-default-engines.ts
```

### Type and class renames

| Old | New | Why |
|-----|-----|-----|
| `EngineDefinition` | `SignalEngineDefinition` | Scoped — "engine" alone is used everywhere |
| `EngineRunContext` | `SignalEngineContext` | — |
| `AnyEngineDefinition` | `AnySignalEngine` | — |
| `registerEngine` / `getEngine` | `registerSignalEngine` / `getSignalEngine` | Avoids collision with future engine types |
| `registerPipelineEngines` | `registerTradeSignalEngines` | What it registers |
| `RiskFilter` | `SelectorRiskFilter` | Scoped — disambiguates from `risk-engine.ts` in `services/risk/` |
| `RiskFilterDeps` | `SelectorRiskFilterDeps` | — |
| `RiskFilterEvaluation` | `SelectorRiskFilterResult` | — |
| `ExecutionProfile` | `TradeExecutionProfile` | "Execution" alone collides with orchestration execution |
| `ExecutionProfileInput` | `TradeExecutionProfileInput` | — |
| `computeExecutionProfile` | `computeTradeExecutionProfile` | — |
| `WorkingCandidate` | `SelectorCandidate` | "Working" implies temp state — these are candidate instruments |
| `mergeCandidates` | `mergeDiscoveryCandidates` | Distinguishes from other merge operations |

---

## Change 5: `electron/shared/ai/` — shared AI type contracts

**What it owns:** Types and constants shared between the main process (pipeline) and the renderer (UI display of pipeline state). No logic.

### File renames

| Old file | New file | Why |
|----------|----------|-----|
| `pipeline-config.ts` | `ai-phase-config.ts` | Configures per-phase AI model settings |
| `effective-pipeline-config.ts` | `effective-ai-phase-config.ts` | — |
| `pipeline-observability.ts` | `ai-phase-trace.ts` | Contains `PhaseTraceV1` — it's trace data |
| `pipeline-phase.ts` | `ai-phase.ts` | — |
| `pipeline-signals.ts` | `trade-signals.ts` | These are trade signals: `TechnicalSignal`, `FundamentalSignal`, etc. |
| `signal-prompt-payload.ts` | `worker-prompt-payload.ts` | — |
| `selector-pipeline-candidate.ts` | `selector-candidate.ts` | "pipeline" is noise |

### Type renames

| Old | New | Why |
|-----|-----|-----|
| `PhaseTraceV1` | `AIPhaseTrace` | Drop version from type name — version lives as an internal field |
| `PipelineRunContext` | `AIPhaseRunContext` | Consistent with new phase naming |

---

## Change 6: `services/orchestration/` — trading cycle loop

Orchestration keeps its name but gets internal surgery. The word "cycle" here means **one tick of the live trading loop** — not the AI analysis pipeline. These two uses of "cycle" are the main source of confusion in the codebase.

### Folder changes

```
services/orchestration/
├── cycle/             # unchanged — live per-tick execution
├── lifecycle/         # unchanged — session start/stop
└── policy/            # unchanged — pre-trade gates

services/replay/       # PROMOTED from replay/
services/analytics/    # absorbs analytics/
```

`replay/` is offline analysis of historical sessions. It does not belong inside the live execution loop. Promoted to a top-level service.

`post-trade/` (trade autopsy) is analytics. Merged into `services/analytics/` alongside `paper-scorecard-service.ts`.

### Type renames — remove "cycle" ambiguity

| Old | New | Why |
|-----|-----|-----|
| `OrchestratorContext` | `TradingCycleContext` | "Orchestrator" is the service name, not the context object |
| `ExecutionStepRunner` | `TradingStepRunner` | "Execution step" collides with pipeline execution step |
| `StepResult<T>` | `TradingStepResult<T>` | Scoped to trading cycle |
| `StepRunnerDeps` | `TradingStepRunnerDeps` | — |
| `StepRunOptions` | `TradingStepRunOptions` | — |
| `ScheduledRetry` | `StepRetrySchedule` | — |

---

## Change 7: `electron/main/ipc/` — group by domain

Flat bag of 15 files → grouped by domain. No logic changes.

```
ipc/
├── handle.ts                # unchanged
├── register.ts              # unchanged
├── environment-guards.ts    # unchanged
├── session/
│   ├── session.ts
│   ├── templates.ts
│   └── replay.ts
├── trading/
│   ├── trades.ts
│   ├── approvals.ts
│   └── broker-accounts.ts
├── workspace/
│   ├── workspace.ts
│   ├── config.ts
│   └── accounts.ts
└── system/
    ├── dashboard.ts
    ├── events.ts
    └── developer.ts
```

---

## Change 8: Inline prompts into worker definitions — delete `prompts/` folder

**Problem:** Every worker's configuration is split across two files. The definition file declares the worker (tools, schema, engine bindings) and references a path string. The actual prompt lives in a separate `.md` file in a nested folder. To understand one worker you jump between two locations.

**Fix:** Inline the prompt text directly into the worker definition file as a template literal. One file = complete worker config. Delete the entire `prompts/` folder.

### Before

```
pipeline/definitions/technical.phase.ts     ← declares worker, references path
pipeline/prompts/technical/chart-pattern.md ← actual prompt lives here
```

```typescript
// technical.phase.ts
{
  id: "chart-pattern",
  promptAssetPath: "technical-workers/chart-pattern.md",  // file reference
  tools: ["get_ohlcv"],
  outputSchema: chartPatternOutputSchema,
}
```

### After

```
pipeline/definitions/technical.phase.ts     ← declares worker + contains full prompt
```

```typescript
// technical.phase.ts
const CHART_PATTERN_PROMPT = `
You are a technical analyst...
[full prompt text here]
`;

{
  id: "chart-pattern",
  prompt: CHART_PATTERN_PROMPT,              // inline string, no file reference
  tools: ["get_ohlcv"],
  outputSchema: chartPatternOutputSchema,
}
```

### What gets deleted

- `pipeline/prompts/` — entire folder and all `.md` files (25 files)
- `pipeline/prompt-asset-loader.ts` — file loader no longer needed
- `promptAssetPath` field on worker definitions — replaced by `prompt: string`

### What changes

- `WorkerExecConfig` loses `promptAssetPath`, gains `prompt: string`
- `runAIWorker` no longer calls `loadPromptAsset()` — reads `worker.prompt` directly
- Phase definition files (`technical.phase.ts`, etc.) grow larger but are now the single source of truth for a worker
- Each definition file gets one exported `const` per worker prompt at the top of the file

### Packaging note

Previously prompts were loaded from disk at runtime which required them to be bundled as file assets in the Electron app (`out/.../Resources/prompts/`). With inline strings they are compiled into the JS bundle — no asset copying needed, simpler packaging config.

---

## Change 9: Remaining small fixes

| What | Change | Why |
|------|--------|-----|
| `electron/shared/instruments/` | Rename → `electron/shared/instruments/` | "catalog" doesn't communicate "instrument types" |
| `services/workspace/` (1 file) | Dissolve — move `environment-scope.ts` into `services/session/` | One file is not a module |
| `electron/prompts/` | Delete — build artifact, no longer needed after Change 8 | Prompts are now inline strings compiled into the bundle |

---

## README Standard

Every folder under `services/` gets a `README.md`. Every README follows this exact structure — no exceptions.

### Section 1 — Plain English (required, comes first)

Write it like you're telling a new teammate what this folder does over lunch. Not a job description. Not bullet points. One or two sentences max.

**Bad:**
> This module facilitates the orchestration and sequential dispatch of AI worker invocations across dependency-ordered frontier batches.

**Good:**
> Runs one instrument through all its AI analysis phases in order. Gets AAPL, fires technical → fundamental → review → decision one after another, hands back a complete picture of whether to trade it.

The test: read it out loud. If it sounds like a legal document, rewrite it.

### Section 2 — Technical detail (required)

Goes deeper: what are the inputs, what are the outputs, what are the important rules or constraints, what should you know before touching this code. Can use bullet points here.

### Section 3 — Flow diagram (required for anything non-trivial)

Mermaid sequence or flowchart showing how the code moves. If the folder has more than two collaborators or a non-obvious execution order, it needs a diagram.

```markdown
​```mermaid
sequenceDiagram
    participant Orchestrator
    participant InstrumentAnalysisRunner
    participant AIPhaseRunner
    Orchestrator->>InstrumentAnalysisRunner: run(AAPL, session)
    InstrumentAnalysisRunner->>AIPhaseRunner: runPhase(technical)
    AIPhaseRunner-->>InstrumentAnalysisRunner: TechnicalSignal
    InstrumentAnalysisRunner->>AIPhaseRunner: runPhase(fundamental)
    AIPhaseRunner-->>InstrumentAnalysisRunner: FundamentalSignal
    InstrumentAnalysisRunner-->>Orchestrator: InstrumentAnalysisResult
​```
```

### Section 4 — Glossary (required if the folder has domain-specific terms)

Any word that isn't obvious to someone who hasn't read the codebase gets a one-line definition.

```markdown
## Terms
- **AIPhase** — the definition of one analysis phase: what workers run, in what order, how to merge their outputs
- **WorkerBatch** — a group of AI workers that run in parallel because none depends on the others
- **InstrumentAnalysisState** — the accumulated results as each phase completes; passed forward into the next phase
```

### Example README

```markdown
# pipeline/analysis

Runs one instrument through all its AI analysis phases in order. Gets a symbol like AAPL, fires
technical → fundamental → review → decision one after another, collects all the results, and
hands back a complete picture of whether to trade it.

## How it works

- Entry point: `InstrumentAnalysisRunner.run(analysis, input)`
- Walks the `AnalysisStep[]` list defined in the `InstrumentAnalysis` object in sequence — no concurrency at this level
- Each step is either an `AIPhaseRunner` call (runs AI workers) or a signal engine call (deterministic, no AI)
- Accumulates results into `InstrumentAnalysisState` after each step
- If a required step fails, the whole analysis throws. Optional steps log a warning and continue.
- Supports `seedState` to resume a partial analysis from a checkpoint (used by replay)

## Flow

​```mermaid
sequenceDiagram
    participant Caller
    participant Runner as InstrumentAnalysisRunner
    participant Phase as AIPhaseRunner
    participant Engine as SignalEngine

    Caller->>Runner: run(analysis, {symbol, sessionId})
    Runner->>Runner: initialState(seed)
    loop for each AnalysisStep
        alt phase step
            Runner->>Phase: runPhase(technical | fundamental | review | decision)
            Phase-->>Runner: AIPhaseResult
        else engine step
            Runner->>Engine: run(state)
            Engine-->>Runner: updated state
        end
        Runner->>Runner: applyStepResult(state)
    end
    Runner-->>Caller: InstrumentAnalysisResult
​```

## Terms

- **InstrumentAnalysis** — static definition of the full analysis: the ordered list of steps to run
- **AnalysisStep** — one step: either an AI phase or a signal engine call
- **InstrumentAnalysisState** — mutable accumulator; each step reads from it and writes its output into it
- **seedState** — optional pre-populated state used to resume a partial analysis (e.g. replay from step 3)
- **required step** — a step where failure aborts the whole analysis (vs. optional steps that are skipped on failure)
```

---

## Naming Rules — Enforce on All New Code

1. **Domain-prefix when the same word appears in multiple domains.** `RiskFilter` (selector scoring) vs `RiskEngine` (services/risk/) — both "risk", completely different things. Selector types get `Selector` prefix. LLM types get `LLM` prefix. Trading cycle types get `Trading` prefix.

2. **No "Runtime" in class names unless the object holds live mutable state.** `PipelineRuntime` (holds session spend map) → OK. `AiRuntime` (stateless API caller) → `LLMRuntime`.

3. **No "Plan" unless it IS a static plan object.** Runners, interpreters, and executors are not plans.

4. **Verb-first for functions.** `buildWorkerPrompt`, `runAIWorker`, `scheduleWorkersByDependency`. Not `promptEnvelopeBuilder`, `workerExecutor`.

5. **"Stage" is banned.** Use `step` (sequential position in a pipeline), `batch` (parallel group of workers), or `phase` (named analysis domain: technical, fundamental, etc.).

6. **"Cycle" means the trading loop tick only.** The analysis that runs inside a tick is an `InstrumentAnalysis`. Never `CyclePlan`.

---

## Execution

Done in three commits. The codebase will be broken between commits. That is expected and acceptable.

### Status (2026-05-23)

| Commit | Scope | Status |
|--------|-------|--------|
| **A** | Folder moves (Changes 1–7, 9) + import path fixes | **Done** — `bun typecheck` passes |
| **A** | Change 8 — inline prompts, delete `prompts/` | **Done** |
| **A** | README files per folder | **Not started** |
| **B** | Full symbol rename pass | **Not started** |
| **C** | Tests, architecture docs, `folder-structure.md` | **Not started** |

Import path fix scripts live in `scripts/fix-restructure-imports-pass*.mjs` (pass 1–8). Safe to delete after Commit B.

### Commit A — Folder moves (Changes 1–8)

Move every file to its new location. Do not rename any symbols yet. All `import` paths will break. `bun typecheck` will fail. That is expected.

Completion gate: every file is in its new location.

### Commit B — Full symbol rename pass

With all files in their new locations, rename every symbol in the tables above. This is done in a single session.

Process per rename:
1. TypeScript language server rename (VS Code F2) — catches all typed references including re-exports
2. `grep -rn "OldName" electron/ src/` — catches string literals, logger names, comments, dynamic references the TS server misses
3. Fix everything grep finds

Do not commit partially renamed. Rename everything, then commit once.

Completion gate: `bun typecheck` passes with zero errors.

### Commit C — Tests and docs

1. `bun test` — fix any failures from renamed types
2. Update `docs/architecture/pipeline-runtime.md` — replace all old names
3. Update `docs/architecture/ai-runtime.md` — replace all old names
4. Update `docs/folder-structure.md` — reflects new structure

Final verification — zero occurrences of any banned old name:

```bash
grep -rn "CyclePlan\|PhasePlan\|AiRuntime\|PromptEnvelope\|ToolBuildContext\
\|SpendCapKind\|WorkerOutputContract\|executeByFrontier\|runReadEngineContext\
\|TerminalOutputToolSpec\|HarnessToolAvailability\|WorkingCandidate\
\|pipeline-runtime\|ai-runtime\|engines/" electron/ src/
```

Completion gate: `bun test` passes. Grep returns zero matches. Docs updated.

---

## Final Project Structure (Reference)

The complete target state after all three commits. Every file at its new path.

```
electron/
├── preload/
├── shared/
│   ├── ai/
│   │   ├── ai-phase-config.ts           # was: pipeline-config.ts
│   │   ├── ai-phase-trace.ts            # was: pipeline-observability.ts
│   │   ├── ai-phase.ts                  # was: pipeline-phase.ts
│   │   ├── effective-ai-phase-config.ts # was: effective-pipeline-config.ts
│   │   ├── selector-candidate.ts        # was: selector-pipeline-candidate.ts
│   │   ├── selector-diagnostics.ts
│   │   ├── trade-signals.ts             # was: pipeline-signals.ts
│   │   └── worker-prompt-payload.ts     # was: signal-prompt-payload.ts
│   ├── domain/
│   │   ├── enums.ts
│   │   ├── environment-mode.ts
│   │   ├── mock-scenario.ts
│   │   ├── session.ts
│   │   ├── trade.ts
│   │   └── workspace.ts
│   ├── infra/
│   │   └── errors.ts
│   ├── instruments/                     # was: catalog/
│   │   ├── search-providers.ts
│   │   └── session-instrument-classes.ts
│   ├── ipc/
│   │   ├── channels.ts
│   │   ├── dto.ts
│   │   └── endpoints.ts
│   ├── presets/
│   │   ├── global-strategy.json
│   │   ├── index.ts
│   │   ├── research-posture.json
│   │   ├── risk.json
│   │   ├── timeframe.json
│   │   └── trade-rules.json
│   ├── validation/
│   │   └── schemas.ts
│   └── domain.ts
│
└── main/
    ├── config/
    │   └── env.ts
    ├── index.ts
    │
    ├── db/
    │   ├── schema.ts
    │   ├── client.ts
    │   ├── migrations.ts
    │   ├── migrations-folder.ts
    │   ├── seed.ts
    │   ├── test-helpers.ts
    │   ├── drizzle/
    │   │   ├── 0000_initial.sql
    │   │   └── meta/
    │   └── repositories/
    │       ├── agents/
    │       │   ├── agent-messages-repo.ts
    │       │   └── agent-runs-repo.ts
    │       ├── brokers/
    │       │   ├── broker-accounts-repo.ts
    │       │   └── broker-routing-repo.ts
    │       ├── market/
    │       │   └── instrument-cache-repo.ts
    │       ├── presets/
    │       │   ├── global-presets-repo.ts
    │       │   ├── research-posture-presets-repo.ts
    │       │   ├── risk-presets-repo.ts
    │       │   ├── timeframe-presets-repo.ts
    │       │   └── trade-rule-presets-repo.ts
    │       ├── sessions/
    │       │   ├── session-ai-phases-repo.ts
    │       │   ├── session-ai-settings-repo.ts
    │       │   ├── session-broker-assignments-repo.ts
    │       │   ├── session-execution-steps-repo.ts
    │       │   ├── session-repo.ts
    │       │   ├── session-research-posture-repo.ts
    │       │   ├── session-risk-config-repo.ts
    │       │   ├── session-selector-settings-repo.ts
    │       │   ├── session-strategies-repo.ts
    │       │   ├── session-templates-repo.ts
    │       │   ├── session-timeframe-config-repo.ts
    │       │   └── session-trade-rules-repo.ts
    │       ├── system/
    │       │   ├── api-call-log-repo.ts
    │       │   ├── events-repo.ts
    │       │   ├── mappers.ts
    │       │   └── stats-repo.ts
    │       ├── trades/
    │       │   ├── capital-reservations-repo.ts
    │       │   ├── trade-approvals-repo.ts
    │       │   ├── trade-autopsies-repo.ts
    │       │   └── trades-repo.ts
    │       └── workspace/
    │           ├── provider-accounts-repo.ts
    │           └── workspace-prefs-repo.ts
    │
    ├── ipc/
    │   ├── handle.ts
    │   ├── register.ts
    │   ├── environment-guards.ts
    │   ├── session/
    │   │   ├── session.ts
    │   │   ├── templates.ts
    │   │   └── replay.ts
    │   ├── trading/
    │   │   ├── trades.ts
    │   │   ├── approvals.ts
    │   │   ├── broker-accounts.ts
    │   │   └── broker-account-helpers.ts
    │   ├── workspace/
    │   │   ├── workspace.ts
    │   │   ├── config.ts
    │   │   ├── accounts.ts
    │   │   └── strategy.ts
    │   └── system/
    │       ├── dashboard.ts
    │       ├── events.ts
    │       └── developer.ts
    │
    └── services/
        ├── app-services.ts
        │
        ├── llm/                                    # was: ai/llm/ + ai/adapters/
        │   ├── README.md                           # one job: talk to an LLM API. Send messages, get responses, retry, trace.
        │   ├── runtime.ts                          # was: ai-runtime/runtime.ts — class: LLMRuntime
        │   ├── runtime-retry.ts
        │   ├── runtime-trace.ts
        │   ├── tool-loop-guard.ts
        │   ├── llm-types.ts                        # was: ai-runtime-types.ts
        │   ├── index.ts
        │   └── adapters/
        │       ├── README.md                       # normalizes Anthropic/OpenAI/OpenRouter into one interface
        │       ├── provider-adapter.ts
        │       ├── reasoning-options.ts
        │       ├── run-agent-execute.ts
        │       ├── anthropic-adapter.ts
        │       ├── openai-adapter.ts
        │       └── openrouter-adapter.ts
        │
        ├── pipeline/                               # was: ai/pipeline/
        │   ├── README.md                           # drives multi-phase AI trade analysis: builds prompts, sequences phases, runs workers, tracks spend
        │   ├── core/
        │   │   ├── README.md                       # framework entry point and shared types — start here if you're new to the pipeline
        │   │   ├── pipeline-runtime.ts             # top-level service: PipelineRuntime
        │   │   ├── pipeline-registry.ts
        │   │   ├── concurrent-group-runner.ts
        │   │   ├── worker-graph-scheduler.ts
        │   │   └── types.ts
        │   ├── definitions/                        # static worker definitions per phase
        │   │   ├── README.md                       # declares what AI workers exist in each phase and what tools/schema they use — not execution logic
        │   │   ├── selector.phase.ts
        │   │   ├── technical.phase.ts
        │   │   ├── fundamental.phase.ts
        │   │   ├── review.phase.ts
        │   │   └── decision.phase.ts
        │   ├── phases/                             # was: plan/phase/ — AIPhase + AIPhaseRunner
        │   │   ├── README.md                       # runs one AI phase: fans out workers in parallel batches, collects outputs, merges into one signal
        │   │   ├── types.ts                        # AIPhase, AIWorkerBatch, AIPhaseResult, etc.
        │   │   ├── interpreter.ts                  # AIPhaseRunner
        │   │   ├── registry.ts
        │   │   └── services.ts
        │   ├── analysis/                           # was: plan/cycle/ — InstrumentAnalysis + Runner
        │   │   ├── README.md                       # runs one instrument through all its AI phases in order; sequences technical → fundamental → review → decision → risk and collects the full picture
        │   │   ├── types.ts                        # InstrumentAnalysis, AnalysisStep, InstrumentAnalysisState
        │   │   ├── interpreter.ts                  # InstrumentAnalysisRunner
        │   │   ├── stage-runner.ts                 # runAnalysisStep, buildAnalysisStepExecute
        │   │   ├── registry.ts
        │   │   └── services.ts
        │   ├── execution/                          # worker execution, spend, traces
        │   │   ├── README.md                       # executes a single AI worker call end-to-end: prompt → model → validate output → record trace → track cost
        │   │   ├── worker-executor.ts              # runAIWorker
        │   │   ├── ai-spend-tracker.ts             # was: pipeline-spend-tracker.ts
        │   │   ├── trace-assembler.ts
        │   │   ├── engine-prompt-injector.ts       # was: engine-context-runner.ts
        │   │   ├── worker-structured-output.ts
        │   │   └── worker-tool-requirements.ts
        │   ├── prompting/
        │   │   ├── README.md                       # builds the system + user message payload sent to each AI worker
        │   │   ├── worker-prompt-builder.ts        # was: prompt-envelope-builder.ts
        │   │   └── strategy-guidance.ts            # was: preset-behavior-guidance.ts
        │   ├── worker-tools/                       # was: context/ — builds tool set per worker run
        │   │   ├── README.md                       # assembles the callable tools (market data, web search, etc.) that a worker is allowed to use during its run
        │   │   ├── worker-tool-resolver.ts         # was: tool-context-builder.ts
        │   │   ├── worker-tool-factory.ts          # was: tool-factory-registry.ts
        │   │   ├── resolve-mock-tool-context.ts
        │   │   └── resolve-search-provider.ts
        │   # NOTE: prompts/ folder deleted — all prompt text inlined into definitions/ files (see Change 8)
        │   ├── implementations/                    # was: analyses/ — HOW each analysis is implemented
        │   │   ├── README.md                       # explains selector vs trade split and what inputs/cache/registry do
        │   │   ├── selector/                       # HOW selector runs: discovery → verification → finalize
        │   │   │   ├── README.md
        │   │   │   ├── selector-analysis.ts        # was: plan.ts
        │   │   │   └── selector-schemas.ts         # was: schemas.ts
        │   │   ├── trade/                          # HOW trade analysis runs: technical → fundamental → review → decision → risk
        │   │   │   ├── README.md
        │   │   │   ├── default-analysis.ts         # was: default-cycle.ts
        │   │   │   ├── default-analysis-steps.ts   # was: default-cycle-stages.ts
        │   │   │   ├── phase-analyses.ts           # was: analysis-plans.ts
        │   │   │   └── aggregator-phase-analysis.ts
        │   │   ├── inputs/                         # was: input-builders/ + engine-input-builders/
        │   │   │   ├── README.md
        │   │   │   ├── broker-coverage.ts
        │   │   │   ├── manual-shortlist.ts
        │   │   │   ├── prediction-market-candidates.ts
        │   │   │   ├── selector-scope.ts
        │   │   │   └── trade-engine-inputs.ts      # was: trade-engine-input-builders.ts
        │   │   ├── cache/
        │   │   │   └── selector-instrument-cache.ts
        │   │   └── registry/                       # was: registry/ + register/ + unified/ — wires and dispatches
        │   │       ├── README.md
        │   │       ├── register-analyses.ts        # was: register/cycle-plans.ts
        │   │       ├── register-phases.ts          # was: register/phase-plans.ts
        │   │       ├── cache-policy-registry.ts
        │   │       ├── input-builder-registry.ts
        │   │       ├── analysis-dispatcher.ts      # was: unified/interpreter.ts — class: AnalysisDispatcher
        │   │       ├── analysis-resolver.ts        # was: unified/registry.ts
        │   │       └── analysis-kinds.ts           # was: unified/types.ts — AnyAnalysisDefinition, AnalysisKind
        │   ├── ai-phase-config-resolver.ts         # was: phase-config-resolver.ts
        │   ├── pipeline-discovery-config.ts
        │   └── effective-pipeline-config.ts
        │   # prompt-asset-loader.ts DELETED (Change 8) — prompts inlined into definitions/
        │   # model-pricing.ts MOVED → llm/
        │
        ├── search/                                 # was: ai/search/
        │   ├── README.md                           # abstracts web search providers behind one interface; workers call search_web and this picks the configured provider (Brave, Tavily, DuckDuckGo, MCP)
        │   ├── search-registry.ts
        │   ├── search-types.ts
        │   ├── sanitize-search-query.ts
        │   ├── index.ts
        │   └── adapters/
        │       ├── search-adapter.ts
        │       ├── brave-adapter.ts
        │       ├── duckduckgo-adapter.ts
        │       ├── mcp-adapter.ts
        │       └── tavily-adapter.ts
        │
        ├── tools/                                  # was: ai/tools/
        │   ├── README.md                           # the callable tool functions exposed to AI workers: market data (quote, OHLCV, news), web fetch, search, trending symbols
        │   ├── fetch-url-tool.ts
        │   ├── market-tools.ts
        │   ├── search-tool.ts
        │   ├── search-reddit-tool.ts
        │   └── trending-symbols-tool.ts
        │
        ├── signal/                                 # was: ai/engines/
        │   ├── README.md                           # deterministic post-AI processing: aggregates worker outputs into signals, scores/filters instrument candidates, computes trade execution profiles. No AI calls.
        │   ├── aggregators/
        │   │   ├── README.md                       # merges the outputs of multiple parallel workers into a single typed signal per phase
        │   │   ├── technical-aggregator.ts
        │   │   ├── fundamental-aggregator.ts
        │   │   ├── review-aggregator.ts
        │   │   └── trade-signal-aggregator.ts
        │   ├── scoring/                            # was: signal/scoring/
        │   │   ├── README.md                       # scores, merges, and risk-filters instrument candidates produced by the selector phase
        │   │   ├── selector-scoring-engine.ts
        │   │   ├── selector-candidate-merger.ts
        │   │   ├── selector-risk-filter.ts         # class: SelectorRiskFilter
        │   │   ├── selector-submission-builder.ts
        │   │   └── prediction-market-candidate-engine.ts
        │   ├── execution/
        │   │   ├── README.md                       # computes the trade execution profile (position size, entry/stop/target price levels) from the decision signal and risk config
        │   │   └── trade-execution-profile.ts      # was: execution-profile-engine.ts
        │   └── registry/
        │       ├── README.md                       # registers all signal engines so the pipeline can look them up by ID
        │       ├── signal-engine-registry.ts       # was: engine-registry.ts
        │       ├── register-trade-signal-engines.ts # was: register-pipeline-engines.ts
        │       ├── register-default-engines.ts
        │       └── types.ts
        │
        ├── broker/
        │   ├── README.md                           # connects to live and mock brokers: routes orders, tracks capital, normalizes instrument symbols across exchanges
        │   ├── broker-service.ts
        │   ├── broker-registry.ts
        │   ├── broker-routing-service.ts
        │   ├── broker-capital-service.ts
        │   ├── broker-balance-cache-service.ts
        │   ├── broker-balance-ticker.ts
        │   ├── instrument-normalizer.ts
        │   ├── index.ts
        │   ├── adapters/
        │   │   ├── README.md                       # one adapter per live broker; each implements the same BrokerAdapter interface
        │   │   ├── broker-adapter.ts
        │   │   ├── alpaca-adapter.ts
        │   │   ├── coinbase-advanced-trade-adapter.ts
        │   │   ├── tradovate-adapter.ts
        │   │   └── polymarket-adapter.ts
        │   └── mock/
        │       ├── README.md                       # paper/sandbox broker: simulates fills and market data locally with no real money or live API calls
        │       ├── mock-adapter.ts
        │       ├── mock-market-simulator.ts
        │       ├── mock-discovery-fixtures.ts
        │       └── mock-scenario-fixtures.ts
        │
        ├── orchestration/
        │   ├── README.md                           # the live trading loop: on each tick, picks instruments to analyze, runs the AI pipeline on each, submits approved orders, monitors open positions
        │   ├── index.ts
        │   ├── cycle/
        │   │   ├── README.md                       # one tick of the trading loop: checks market hours, runs the selector to find instruments, then runs the full trade analysis pipeline on each candidate
        │   │   ├── agent-orchestrator.ts
        │   │   ├── market-hours-service.ts
        │   │   ├── orchestrator-context.ts         # class: TradingCycleContext
        │   │   ├── orchestrator-step.ts
        │   │   ├── execution-step-runner.ts        # class: TradingStepRunner
        │   │   ├── types.ts
        │   │   ├── utils.ts
        │   │   ├── scheduling/
        │   │   │   ├── README.md                   # manages the per-session instrument queue and handles trade-closed events to free up slots
        │   │   │   ├── instrument-queue.ts
        │   │   │   └── trade-closed-handler.ts
        │   │   ├── selector/
        │   │   │   ├── README.md                   # triggers the selector analysis pipeline to discover which instruments to trade this tick
        │   │   │   └── run-selector.ts
        │   │   └── trade/
        │   │       ├── README.md                   # handles everything after the AI decides to trade: approval flow, order placement, policy gates, and trade record creation
        │   │       ├── approval-flow.ts
        │   │       ├── approval-recheck.ts
        │   │       ├── effect-runner.ts
        │   │       ├── order-placer.ts
        │   │       ├── order-policy-task.ts
        │   │       ├── post-decision-gates.ts
        │   │       ├── run-trade-pipeline.ts
        │   │       ├── trade-cycle.ts
        │   │       └── trade-record-builder.ts
        │   ├── lifecycle/
        │   │   ├── README.md                       # manages what happens when a session starts or stops: opens/closes positions, monitors live trades
        │   │   ├── position-manager-service.ts
        │   │   └── trade-monitor.ts
        │   └── policy/
        │       ├── README.md                       # pre-trade gates that run before any order is submitted: validates the candidate instrument and enforces order policy rules
        │       ├── candidate-validation-service.ts
        │       └── order-policy-gate.ts
        │
        ├── replay/                                 # was: replay/
        │   ├── README.md                           # replays a historical session tick offline — re-runs the AI pipeline on saved state without placing real orders, used for review and debugging
        │   └── cycle-replay-service.ts
        │
        ├── analytics/                              # absorbs analytics/
        │   ├── README.md                           # post-trade analysis: scores completed trades, generates paper trading scorecards
        │   ├── paper-scorecard-service.ts
        │   └── trade-autopsy-service.ts            # was: post-trade/trade-autopsy-service.ts
        │
        ├── session/
        │   ├── README.md                           # owns session lifecycle: create, start, stop, query sessions; resolves effective strategy config; runs preflight checks before launch
        │   ├── session-service.ts
        │   ├── session-runtime-manager.ts
        │   ├── session-runtime.ts
        │   ├── session-strategy-context-service.ts
        │   ├── session-types.ts
        │   ├── template-service.ts
        │   ├── listing-service.ts
        │   ├── write-service.ts
        │   ├── effective-instrument-classes.ts
        │   ├── environment-scope.ts                # was: workspace/environment-scope.ts
        │   ├── index.ts
        │   └── preflight/
        │       ├── README.md                       # pre-launch checks that must pass before a session can start: broker reachable, provider credentials valid, no instrument conflicts, etc.
        │       ├── broker-allocation-check.ts
        │       ├── broker-reachability-check.ts
        │       ├── instrument-conflict-check.ts
        │       ├── provider-credentials-check.ts
        │       ├── selector-config-check.ts
        │       ├── task-boundary-check.ts
        │       └── index.ts
        │
        ├── risk/
        │   ├── README.md                           # enforces trading risk rules: checks position limits, reserves capital before order placement, evaluates exit conditions, gates live trading readiness
        │   ├── risk-engine.ts
        │   ├── capital-reservation-service.ts
        │   ├── exit-policy-evaluator.ts
        │   ├── broker-allocation-gate.ts
        │   ├── live-readiness-service.ts
        │   └── index.ts
        │
        ├── instrument/
        │   ├── README.md                           # fetches and caches instrument metadata (name, asset class, exchange) to avoid repeated lookups
        │   ├── instrument-cache-service.ts
        │   └── index.ts
        │
        └── infra/
            ├── README.md                           # infrastructure primitives used across all services: structured logging, in-process event bus, OS keychain secrets, desktop notifications
            ├── log.ts
            ├── log-safety.ts
            ├── event-bus.ts
            ├── notification-service.ts
            └── secrets-service.ts
```

### Dissolved / removed

| Old path | Disposition |
|----------|-------------|
| `services/session/environment-scope.ts` | Moved → `services/session/environment-scope.ts` |
| `services/llm/` (entire directory) | Split into `llm/`, `pipeline/`, `signal/`, `search/`, `tools/` |
| `services/replay/` | Promoted → `services/replay/` |
| `services/analytics/` | Merged → `services/analytics/` |
| `services/pipeline/execution/tool-use-harness.ts` | Evaluate: move to `pipeline/execution/` or `tools/` |
| `services/pipeline/prompting/strategy-prompt-context.ts` | Move → `pipeline/prompting/` |
| `services/llm/provider-registry.ts` | Move → `llm/adapters/` |
| `services/llm/resolve-run-cost.ts` | Move → `llm/` |
| `services/pipeline/prompt-asset-loader.ts` | **Delete** — no longer needed after Change 8 (prompts inlined into definitions) |
| `services/llm/model-pricing.ts` | Move → `llm/` |
| `pipeline/prompts/` (entire folder, 25 .md files) | **Delete** — all prompt text inlined into `definitions/` files |
| `electron/shared/instruments/` | Renamed → `electron/shared/instruments/` |
| `services/workspace/` | Dissolved — one file, moved to `session/` |

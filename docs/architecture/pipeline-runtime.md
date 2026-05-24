# Pipeline Runtime - Architecture Design Document

> **Last updated:** 2026-05-23
> **Scope:** Main-process AI pipeline execution: registered analyses, AI phases, worker definitions, prompt assembly, tool construction, spend tracking, signal aggregation, selector caching, and trace persistence. Excludes session lifecycle, renderer UI, broker order placement, and trade monitoring except where those systems call the pipeline.
> **Audience:** Engineers onboarding, reviewers, future maintainers
> **Related docs:** `docs/architecture/ai-runtime.md`, `docs/folder-structure.md`

---

## 1. Executive Summary

The pipeline runtime is the main-process subsystem that turns a session plus an instrument into AI analysis output. `LLMRuntime` in `electron/main/services/llm/runtime.ts` is the public facade, but the actual analysis work is delegated to `PipelineRuntime` in `electron/main/services/pipeline/core/pipeline-runtime.ts`. The runtime has two execution shapes: an `AIPhase` runs one phase such as selector, technical, fundamental, review, or decision; an `InstrumentAnalysis` runs a full ordered trade analysis over one selected instrument. Worker prompts are now compiled inline through `worker.prompt` and `electron/main/services/pipeline/worker-prompts.ts`, not loaded from a runtime `prompts/` asset folder.

---

## 2. System Context

```mermaid
graph TB
    subgraph Main["Electron Main Process"]
        Orchestrator["AgentOrchestrator / Replay / Developer IPC"]
        LLM["LLMRuntime\nservices/llm/runtime.ts"]
        Pipeline["PipelineRuntime\nservices/pipeline/core/pipeline-runtime.ts"]
        PhaseRunner["AIPhaseRunner\nservices/pipeline/phases/interpreter.ts"]
        AnalysisRunner["InstrumentAnalysisRunner\nservices/pipeline/analysis/interpreter.ts"]
        Worker["runAIWorker\nservices/pipeline/execution/worker-executor.ts"]
        Signals["Signal engines\nservices/signal/**"]
        Tools["Worker tools\nservices/tools/**"]
    end
    subgraph Storage["Local Storage"]
        DB[("SQLite")]
        Keychain[("OS Keychain")]
    end
    AI["AI Providers\nAnthropic / OpenAI / OpenRouter"]
    Search["Search Providers\nDuckDuckGo / Brave / Tavily / MCP"]
    Brokers["Broker Adapters\nmarket data + account routing"]

    Orchestrator --> LLM --> Pipeline
    Pipeline --> PhaseRunner
    Pipeline --> AnalysisRunner
    AnalysisRunner --> PhaseRunner
    PhaseRunner --> Worker
    Worker --> AI
    Worker --> Tools
    Tools --> Search
    Tools --> Brokers
    PhaseRunner --> Signals
    AnalysisRunner --> Signals
    Worker --> DB
    PhaseRunner --> DB
    Pipeline --> DB
    LLM --> Keychain
```



`PipelineRuntime` is not an IPC boundary and is not directly called by the renderer. Runtime callers use `AppServices.ai`, which is an `LLMRuntime` facade created in `electron/main/services/app-services.ts`. `ProviderRegistry` resolves AI credentials from `provider_accounts` plus Keychain secrets, while `SearchRegistry` and broker services are exposed to workers only through a `WorkerToolContext`.

---

## 3. Core Concepts & Glossary


| Term                       | Definition                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PipelineRuntime`          | Top-level executor for phase and instrument-analysis runs. It builds strategy/tool/spend context and delegates to the right interpreter.                                                          |
| `LLMRuntime`               | Main-process facade that validates session ids and exposes `runAIPhase`, `runCycle`, `runPlan`, and effective config helpers.                                                                     |
| `AIPhase`                  | Runtime definition for one analysis phase. It owns entry modes, input builders, worker batches, finalization, optional cache policy, and aggregate persistence.                                   |
| `InstrumentAnalysis`       | Runtime definition for a full ordered analysis of one instrument. The default trade analysis runs candidate validation, technical, fundamental, review, decision, then risk/allocation engines.   |
| `WorkerDefinition`         | Static description of one model call: id, inline prompt string, allowed tools, strategy-context request, optional terminal output schema, and tool requirements.                                  |
| `AIPhaseRunner`            | Interpreter for one `AIPhase`. It checks cache, resolves entry modes, builds composite input, runs worker stages, finalizes output, persists aggregate traces, and writes selector cache entries. |
| `InstrumentAnalysisRunner` | Interpreter for one `InstrumentAnalysis`. It walks analysis steps sequentially and can wrap each step with the orchestration `TradingStepRunner`.                                                 |
| `AISpendTracker`           | Per-phase tracker that enforces phase, pipeline, and session spend caps. Sandbox/mock sessions use warn-only budget behavior.                                                                     |
| `WorkerToolContext`        | Runtime dependency bag used to build callable tools: session id, cycle id, search provider, broker routing, mock data, instrument classes, and API-call logging.                                  |
| `Signal engine`            | Deterministic TypeScript logic in `services/signal/` used for aggregation, selector scoring/filtering, execution-profile calculation, and registry lookup. It does not call an LLM.               |
| `Terminal output tool`     | Runtime-created submit tool, usually `submit_result`, whose Zod schema validates structured worker output.                                                                                        |
| `Selector cache`           | `session_instrument_cache` entry managed by `selector-instrument-cache`; only non-empty selector outputs are cached.                                                                              |


---

## 4. High-Level Architecture

```mermaid
graph LR
    subgraph Entry["Entry Points"]
        LLMRuntime["LLMRuntime"]
        Caller["Orchestrator / Replay / Dev tools"]
    end
    subgraph Pipeline["services/pipeline"]
        PR["core/PipelineRuntime"]
        PhaseReg["phases/registry"]
        AnalysisReg["analysis/registry"]
        Resolver["implementations/registry/analysis-resolver"]
        PhaseRunner["phases/AIPhaseRunner"]
        AnalysisRunner["analysis/InstrumentAnalysisRunner"]
        WorkerExecutor["execution/runAIWorker"]
        Prompt["prompting/buildWorkerPrompt"]
        ToolCtx["worker-tools/resolveWorkerToolContext"]
        ToolFactory["worker-tools/buildWorkerTools"]
    end
    subgraph Implementations["Trading-specific implementations"]
        Selector["implementations/selector"]
        Trade["implementations/trade"]
        Inputs["implementations/inputs"]
        Cache["implementations/cache"]
    end
    subgraph External["Boundaries"]
        Providers["ProviderAdapter.runAgent"]
        Tools["search / fetch / market tools"]
        Signals["signal engines"]
        DB[("SQLite repos")]
    end

    Caller --> LLMRuntime --> PR
    PR --> Resolver
    PR --> PhaseReg
    PR --> AnalysisReg
    PR --> PhaseRunner
    PR --> AnalysisRunner
    AnalysisRunner --> PhaseRunner
    PhaseRunner --> Selector
    PhaseRunner --> Trade
    PhaseRunner --> Inputs
    PhaseRunner --> Cache
    PhaseRunner --> WorkerExecutor
    WorkerExecutor --> Prompt
    WorkerExecutor --> ToolFactory
    PR --> ToolCtx
    WorkerExecutor --> Providers
    ToolFactory --> Tools
    Selector --> Signals
    Trade --> Signals
    WorkerExecutor --> DB
    PhaseRunner --> DB
```



**Component responsibilities:**


| Component                       | What it owns                                                                                                                                              | Key files                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Runtime facade                  | Public API, session-id validation, effective config helpers                                                                                               | `electron/main/services/llm/runtime.ts`                              |
| Pipeline runtime                | Strategy context, session lookup, tool context, spend tracker, interpreter dispatch                                                                       | `electron/main/services/pipeline/core/pipeline-runtime.ts`           |
| AI phase interpreter            | Cache check, entry modes, input builders, worker stage execution, aggregate trace/cache writes                                                            | `electron/main/services/pipeline/phases/interpreter.ts`              |
| Instrument analysis interpreter | Sequential trade-analysis step execution and optional `runStep` wrapper                                                                                   | `electron/main/services/pipeline/analysis/interpreter.ts`            |
| Worker executor                 | Provider/model resolution, prompt construction, tool construction, provider call, output validation, trace assembly                                       | `electron/main/services/pipeline/execution/worker-executor.ts`       |
| Prompt builder                  | System/user message assembly from inline prompt, trusted strategy facts, strategy guidance, worker guidance, engine results, task JSON, and sandbox block | `electron/main/services/pipeline/prompting/worker-prompt-builder.ts` |
| Worker tools                    | Runtime creation of `search_web`, `fetch_url`, `search_reddit`, `get_trending_symbols`, `get_quote`, `get_ohlcv`, `get_news`, and terminal submit tools   | `electron/main/services/pipeline/worker-tools/`                      |
| Trading implementations         | Selector phase, default trade analysis, cache policy, input builders, registration                                                                        | `electron/main/services/pipeline/implementations/`                   |
| Signal processing               | Deterministic aggregation, scoring, risk filtering, execution profiles, signal registry                                                                   | `electron/main/services/signal/`                                     |


---

## 5. Data Model

```mermaid
erDiagram
    sessions ||--o{ session_ai_phases : configures
    session_ai_phases ||--o{ session_ai_phase_workers : overrides
    sessions ||--o{ agent_runs : produces
    agent_runs ||--|| agent_messages : records
    sessions ||--|| session_instrument_cache : caches
    sessions ||--o{ session_execution_steps : reports
    trades ||--o{ agent_runs : scopes
```



**Important tables:**


| Table                      | Pipeline use                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_ai_phases`        | Phase-level provider/model/temperature/token/reasoning/prompt config read by `AIPhaseConfigResolver`.                                               |
| `session_ai_phase_workers` | Worker-level overrides for provider/model/max steps/spend/prompt markdown.                                                                          |
| `agent_runs`               | Token, cost, model, provider, finish reason, and duration for persisted worker or aggregate phase runs.                                             |
| `agent_messages`           | Prompt messages, tool calls, output JSON, thinking JSON, strategy snapshot, market snapshot, parse fallback, and cycle id.                          |
| `session_instrument_cache` | Selector result cache with fingerprint, selected cycle, aggregate run id, research briefs, and expiry.                                              |
| `session_execution_steps`  | Written by orchestration around pipeline stages; not owned by `PipelineRuntime`, but `InstrumentAnalysisRunner` accepts the wrapper that drives it. |


Worker-level traces are assembled by `assembleTrace()` in `pipeline/execution/trace-assembler.ts`. Aggregate phase traces are assembled by `assembleAggregateTrace()` and usually persisted by `AIPhaseRunner`, except the trade-analysis phases set `persistAggregate: false` so trade-cycle persistence can happen after the pending trade exists.

---

## 6. Key Flows

### 6.1 Full Trade Analysis

**Trigger:** `AgentOrchestrator` calls `LLMRuntime.runPlan("default-trade-cycle", ...)` from `orchestration/cycle/trade/run-trade-pipeline.ts`.
**Outcome:** `InstrumentAnalysisResult` with accumulated technical, fundamental, review, decision, risk order, and broker allocation state.

```mermaid
sequenceDiagram
    participant Orch as AgentOrchestrator
    participant LLM as LLMRuntime
    participant PR as PipelineRuntime
    participant Runner as InstrumentAnalysisRunner
    participant Phase as AIPhaseRunner
    participant Worker as runAIWorker
    participant Signal as Signal engines

    Orch->>LLM: runPlan("default-trade-cycle", opts)
    LLM->>PR: runPlan(planId, opts)
    PR->>PR: require strategy context + resolve tool context
    PR->>Runner: run(InstrumentAnalysis, context)
    Runner->>Signal: candidate_validation engine
    Runner->>Phase: technical phase
    Phase->>Worker: run technical workers concurrently
    Worker-->>Phase: typed worker outputs + traces
    Phase->>Signal: technical aggregator finalize
    Phase-->>Runner: TechnicalSignal
    Runner->>Phase: fundamental phase
    Phase-->>Runner: FundamentalSignal
    Runner->>Phase: review phase
    Phase-->>Runner: ReviewSignal
    Runner->>Phase: decision phase
    Phase-->>Runner: TradeSignal
    alt decision is trade
        Runner->>Signal: execution profile -> risk gate -> broker allocation
    end
    Runner-->>PR: InstrumentAnalysisResult
    PR-->>LLM: result
    LLM-->>Orch: result
```



**Step-by-step:**

1. `LLMRuntime.runPlan()` validates `sessionId` and delegates to `PipelineRuntime.runPlan()`.
2. `PipelineRuntime` resolves the registered analysis by id through `implementations/registry/analysis-resolver.ts`.
3. For full trade analysis, `PipelineRuntime.runCycle()` loads the `WorkspaceSession`, strategy context, and `WorkerToolContext` once and passes a shared `runAIPhase` callback into `InstrumentAnalysisRunner`.
4. `InstrumentAnalysisRunner` starts from `plan.initialState(ctx, seedState)` and runs the steps built from `DEFAULT_TRADE_CYCLE_STAGES` in `implementations/trade/default-analysis-steps.ts`.
5. Steps with `executionStage` are wrapped by the caller-provided `runStep` function, which lets orchestration persist retry/progress state in `session_execution_steps`.
6. AI steps call back to `PipelineRuntime.runAIPhase()`. Engine steps call deterministic signal-engine bindings through `analysis/stage-runner.ts` and `execution/input-builder-registry.ts`.
7. The final result is the accumulated `InstrumentAnalysisState` plus `totalAiCostUsd`, calculated from run records stored in the state.

**Failure behavior:** required analysis steps rethrow failures. Optional steps log and continue unless the error is a control error such as `AnalysisPausedError` or `AnalysisStepFailedError`. `risk_gate` is skipped when the decision action is `skip`.

### 6.2 Selector Phase

**Trigger:** Orchestration calls `LLMRuntime.runPlan("selector", ...)` from `orchestration/cycle/selector/run-selector.ts`.
**Outcome:** `InstrumentSelection` from cache, manual shortlist, or AI discovery and verification.

```mermaid
sequenceDiagram
    participant PR as PipelineRuntime
    participant Phase as AIPhaseRunner
    participant Cache as selector cache policy
    participant Inputs as Input builders
    participant Worker as runAIWorker
    participant Scoring as Selector scoring/filtering
    participant DB as SQLite

    PR->>Phase: run SELECTOR_PLAN
    Phase->>Cache: read fingerprint
    alt cache hit
        Cache-->>Phase: cached InstrumentSelection
    else manual shortlist
        Phase-->>PR: buildManualShortlistSelection()
    else AI-selected universe
        Phase->>Inputs: selector-scope + broker-coverage + prediction-market-candidates
        Phase->>Worker: discovery workers, concurrency 3
        Worker-->>Phase: candidate outputs
        Phase->>Scoring: mergeDiscoveryCandidates + scoreCandidate
        Phase->>Worker: verification workers, concurrency 4
        Worker-->>Phase: verification outputs
        Phase->>Scoring: SelectorRiskFilter + buildInstrumentSelection
        Phase->>DB: persist aggregate AgentRun/AgentMessage
        Phase->>Cache: write non-empty output
    end
    Phase-->>PR: AIPhaseResult<InstrumentSelection>
```



Selector details are implemented in `pipeline/implementations/selector/selector-analysis.ts`:

- `inputBuilderIds` are `selector-scope`, `broker-coverage`, and `prediction-market-candidates`.
- `manual_shortlist` bypasses AI and returns configured instruments.
- Discovery workers come from `selectorDiscoveryWorkersForMode(ctx.strategyContext.researchPosture.discoveryMode)`.
- Verification creates three workers per candidate: `market-validator:<symbol>`, `catalyst-extractor:<symbol>`, and `liquidity-gate:<symbol>`.
- The final output is filtered to effective session instrument classes and `maxConcurrentTrades`.
- Cache writes only happen when an aggregate trace exists and the selection has at least one instrument.

### 6.3 Single Worker Execution

**Trigger:** `AIPhaseRunner` calls `ctx.runner.execute(worker, task)`.
**Outcome:** One `LLMRunResult<TOutput>` containing a persisted-run shape, persisted-message shape, and parsed output.

```mermaid
sequenceDiagram
    participant Phase as AIPhaseRunner
    participant Worker as runAIWorker
    participant Config as AIPhaseConfigResolver
    participant Prompt as buildWorkerPrompt
    participant Tools as buildWorkerTools
    participant Provider as ProviderAdapter
    participant Trace as assembleTrace
    participant Spend as AISpendTracker

    Phase->>Worker: execute(worker, task)
    Worker->>Spend: canContinue()
    Worker->>Config: resolveWorkerExecConfig + runtime config
    Worker->>Worker: choose session override prompt or worker.prompt
    Worker->>Worker: injectEngineResults()
    Worker->>Prompt: build system/user LLMMessage[]
    Worker->>Tools: build runtime tools + terminal submit tool
    Worker->>Provider: runAgent() through withLLMRetry
    Provider-->>Worker: LLMCallTrace
    Worker->>Worker: extract terminal submission
    alt invalid structured output
        Worker->>Provider: retry provider run once
    end
    Worker->>Worker: enforceWorkerToolRequirements()
    Worker->>Trace: assemble run/message records
    Worker->>Spend: record cost
    Worker-->>Phase: LLMRunResult<TOutput>
```



Worker rules worth knowing before changing this code:

- Prompt text comes from `worker.prompt` unless `session_ai_phase_workers.promptSource === "session_override"` and a non-empty override markdown exists.
- `buildWorkerPrompt()` always emits one system message and one user message.
- User-message blocks are fixed: `<trusted_strategy_facts>`, optional `<trusted_strategy_guidance>`, optional `<session_worker_guidance>`, optional `<engine_results>`, and `<task>`.
- `withLLMRetry()` wraps provider calls with timeout/backoff behavior from `services/llm/runtime-retry.ts`.
- Structured workers submit through a terminal tool. Validation retries once, then throws `VALIDATION_FAILED`.
- Tool requirements are enforced after the provider run so a model cannot claim it researched something without actually calling the required tools.

---

## 7. State & Lifecycle

```mermaid
stateDiagram-v2
    [*] --> ResolvePlan
    ResolvePlan --> PhaseRun: plan.kind = phase
    ResolvePlan --> AnalysisRun: plan.kind = instrument_analysis
    PhaseRun --> CacheCheck
    CacheCheck --> ReturnCached: cache hit
    CacheCheck --> EntryModeCheck: cache miss
    EntryModeCheck --> ReturnEntryMode: manual shortlist
    EntryModeCheck --> BuildInput: no entry mode
    BuildInput --> RunWorkerStages
    RunWorkerStages --> FinalizePhase
    FinalizePhase --> PersistAggregate
    PersistAggregate --> WriteCache
    WriteCache --> [*]
    AnalysisRun --> InitialState
    InitialState --> RunAnalysisStep
    RunAnalysisStep --> RunAnalysisStep: next step
    RunAnalysisStep --> [*]
```



`PipelineRuntime` itself is mostly stateless. The exception is `cycleSpendUsd`, a bounded in-memory `Map` used to carry pipeline-spend totals across phases within a cycle. Durable state lives in SQLite repos; per-call state lives in `AIPhaseContext`, `InstrumentAnalysisContext`, `AISpendTracker`, and the analysis state object.

---

## 8. Configuration & Spend


| Source                                     | What it controls                                                    | Code path                                         |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------- |
| `session_ai_phases`                        | Phase provider/model/temperature/max tokens/reasoning/prompt config | `AIPhaseConfigResolver.resolvePhaseConfig()`      |
| `session_ai_phase_workers`                 | Per-worker provider/model/caps/prompt override                      | `AIPhaseConfigResolver.resolveWorkerExecConfig()` |
| `PHASE_DEFAULTS`                           | Default phase spend caps and worker caps                            | `electron/shared/ai/ai-phase.ts`                  |
| `DEFAULT_PIPELINE_CONFIG`                  | Total pipeline spend cap                                            | `electron/shared/ai/ai-phase-config.ts`           |
| `strategyContext.riskConfig.maxAiSpendUsd` | Session daily AI spend cap                                          | `PipelineRuntime.runAIPhase()`                    |
| `agent_runs`                               | Already-spent daily AI cost                                         | `AgentRunsRepo.dailyAiSpendUsd()`                 |


`AISpendTracker` checks three layers: session daily spend, pipeline spend, and phase spend. For sandbox/mock sessions, `isSandboxBudgetProfile()` raises caps to paper/mock defaults and sets `warnOnly: true`, so budget violations warn instead of aborting workers.

---

## 9. Security & Trust Boundaries

```mermaid
flowchart LR
    SessionConfig["Session config"] --> Strategy["SessionStrategyContext"]
    Strategy --> Prompt["Prompt builder fixed XML blocks"]
    WorkerPrompt["Inline worker.prompt"] --> Prompt
    Prompt --> Provider["AI provider"]
    Provider --> Trace["LLMCallTrace"]
    Trace --> Validation["Zod output validation"]
    Validation --> State["Typed phase/analysis state"]
    Tools["Tool outputs"] --> Provider
```



Security rules encoded by the current design:

- Renderer input reaches the pipeline only through typed IPC and service methods; the renderer never calls provider adapters directly.
- API keys are resolved by `ProviderRegistry` and `SearchRegistry` from Keychain-backed `secretRef` values. Pipeline code sees provider ids, not secrets.
- LLM output is treated as data. Runtime code parses terminal-tool arguments and validates them with Zod schemas; it does not execute model text.
- Prompt construction separates trusted session facts from model-visible task data using fixed tags.
- Tool outputs are passed as tool responses, not as trusted system instructions.
- Mock sessions replace market/search data paths with fixtures where available, but AI provider calls still go to configured AI providers.

---

## 10. Observability & Debugging

```mermaid
graph TD
    Worker["runAIWorker"] --> Trace["assembleTrace"]
    Phase["AIPhaseRunner"] --> Aggregate["assembleAggregateTrace"]
    Trace --> Runs[("agent_runs")]
    Trace --> Messages[("agent_messages")]
    Aggregate --> Runs
    Aggregate --> Messages
    Tools["search/fetch/market tools"] --> Calls[("api_call_log")]
    Orchestration["TradingStepRunner"] --> Steps[("session_execution_steps")]
    Logs["createLogger('pipeline-runtime')"] --> Files["~/.exva/logs"]
```



Debug checklist:

1. Check `session_execution_steps` for the current cycle/stage retry state.
2. Check `events` for user-facing runtime messages and cycle id correlation.
3. Check `agent_runs` for provider/model/token/cost/duration metadata.
4. Check `agent_messages` for `messages_json`, `tool_calls_json`, `output_json`, `thinking_json`, and `parse_fallback`.
5. Check `api_call_log` for search/fetch/market external calls.
6. Check `~/.exva/logs/exva-YYYY-MM-DD.log` for `phase run start`, `phase stage complete`, `worker configured`, `worker complete`, and provider retry logs.

---

## 11. Design Decisions & Trade-offs


| Decision                        | Chosen approach                                                                  | Rationale                                                                                                     | Trade-off                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Split LLM and pipeline services | `services/llm` owns provider calls; `services/pipeline` owns analysis sequencing | Keeps provider normalization separate from trading-analysis orchestration                                     | `LLMRuntime` is now a facade name that can look broader than raw LLM calls.             |
| Two interpreters                | `AIPhaseRunner` and `InstrumentAnalysisRunner`                                   | Phase execution has worker batches/finalization/cache; instrument analysis has sequential heterogeneous steps | More concepts to learn.                                                                 |
| Inline worker prompts           | `WorkerDefinition.prompt` and `worker-prompts.ts`                                | One compiled source of truth; no runtime prompt asset packaging                                               | Definition files and prompt constants are larger.                                       |
| Terminal tool structured output | Zod-validated submit tool                                                        | Reduces brittle text parsing and makes failure explicit                                                       | Requires every structured worker to call the submit tool.                               |
| Selector-only cache             | Cache policy only for selector instrument selection                              | Discovery is expensive and scope-based; trade phases need fresher market state                                | Equivalent discoveries across sessions are not reused.                                  |
| Aggregate trace reuse           | Store aggregate `AIPhaseTrace` in `agent_messages.tool_calls_json`               | Avoids a separate phase-trace table                                                                           | Column shape differs between worker and aggregate messages.                             |
| In-memory pipeline spend        | `cycleSpendUsd` map with 500-entry cap                                           | Simple per-process cycle accounting                                                                           | Restart loses pipeline-level spend, though session daily cap still uses persisted runs. |


---

## 12. Known Limitations

- `cycleSpendUsd` is not durable across process restarts.
- Technical and fundamental phases currently run serially inside `InstrumentAnalysisRunner`, even though their inputs are independent.
- Prompt-size limits are observational; `measureWorkerPrompt()` logs warnings but does not truncate.
- Some method names still use older words such as `runCycle` and internal `stage` fields because those names are still present in code contracts.
- Individual selector worker traces are represented inside the aggregate selector trace instead of every selector worker being a separate top-level persisted run visible as a trade-scoped row.
- Worker-level model overrides are supported by the DB/runtime but are not fully exposed as a polished UI for every worker.

---

## 13. File Reference Map


| Area                                  | Files                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| LLM facade                            | `electron/main/services/llm/runtime.ts`                                                                 |
| Provider registry                     | `electron/main/services/llm/provider-registry.ts`                                                       |
| Provider adapters                     | `electron/main/services/llm/adapters/`                                                                  |
| Pipeline runtime                      | `electron/main/services/pipeline/core/pipeline-runtime.ts`                                              |
| Concurrent runner                     | `electron/main/services/pipeline/core/concurrent-group-runner.ts`                                       |
| Worker graph scheduler                | `electron/main/services/pipeline/core/worker-graph-scheduler.ts`                                        |
| Static phase metadata                 | `electron/main/services/pipeline/definitions/`                                                          |
| AI phase types/interpreter            | `electron/main/services/pipeline/phases/types.ts`, `interpreter.ts`, `registry.ts`                      |
| Instrument analysis types/interpreter | `electron/main/services/pipeline/analysis/types.ts`, `interpreter.ts`, `stage-runner.ts`, `registry.ts` |
| Worker execution                      | `electron/main/services/pipeline/execution/worker-executor.ts`                                          |
| Spend tracking                        | `electron/main/services/pipeline/execution/ai-spend-tracker.ts`                                         |
| Trace assembly                        | `electron/main/services/pipeline/execution/trace-assembler.ts`                                          |
| Engine prompt injection               | `electron/main/services/pipeline/execution/engine-prompt-injector.ts`                                   |
| Prompt builder                        | `electron/main/services/pipeline/prompting/worker-prompt-builder.ts`                                    |
| Strategy guidance                     | `electron/main/services/pipeline/prompting/strategy-guidance.ts`                                        |
| Worker prompts                        | `electron/main/services/pipeline/worker-prompts.ts`                                                     |
| Worker tools                          | `electron/main/services/pipeline/worker-tools/`                                                         |
| Selector implementation               | `electron/main/services/pipeline/implementations/selector/`                                             |
| Trade implementation                  | `electron/main/services/pipeline/implementations/trade/`                                                |
| Input builders                        | `electron/main/services/pipeline/implementations/inputs/`                                               |
| Cache policy                          | `electron/main/services/pipeline/implementations/cache/selector-instrument-cache.ts`                    |
| Analysis registry/dispatcher          | `electron/main/services/pipeline/implementations/registry/`                                             |
| Signal aggregators                    | `electron/main/services/signal/aggregators/`                                                            |
| Signal scoring                        | `electron/main/services/signal/scoring/`                                                                |
| Signal engine registry                | `electron/main/services/signal/registry/`                                                               |



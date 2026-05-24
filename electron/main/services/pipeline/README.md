# pipeline

Runs Exva's AI analysis pipeline. It can run one AI phase by itself, or run one instrument through the full trade analysis path from validation to technical, fundamental, review, decision, and deterministic risk checks.

## How it works

- Entry point: `core/pipeline-runtime.ts`.
- `PipelineRuntime.runAIPhase()` runs one named phase such as `selector`, `technical`, `fundamental`, `review`, or `decision`.
- `PipelineRuntime.runCycle()` runs one instrument through an `InstrumentAnalysis`; the current production analysis id is `default-trade-cycle`.
- `PipelineRuntime.runPlan()` is the compatibility dispatcher that accepts either a phase id or an instrument-analysis id and routes to the right runner.
- `phases/` owns the generic `AIPhaseRunner`; it knows how to run worker batches, handle selector cache reads/writes, and persist aggregate traces.
- `analysis/` owns the generic `InstrumentAnalysisRunner`; it sequences phase calls and deterministic engine steps for one selected instrument.
- `execution/` owns the single-worker path: resolve provider/model, build prompts, assemble tools, invoke the LLM adapter, validate output, assemble traces, and track AI spend.
- `prompting/` builds the trusted system/user messages passed into each worker from prompt markdown, strategy facts, preset guidance, engine context, and task payload.
- `worker-tools/` turns configured tool ids into callable tools like `search_web`, `fetch_url`, `get_quote`, `get_ohlcv`, and terminal submit-output tools.
- `definitions/` describes static worker metadata for each phase, but execution uses the richer `AIPhase` objects registered from `implementations/`.
- `implementations/` is the trading-specific layer: selector discovery, trade-analysis sequence, cache policy, input builders, and boot-time registration.
- `worker-prompts.ts` is the bundled prompt text source for phase workers.
- Deterministic signal engines are part of the pipeline contract. Some run before a worker to enrich prompt context; others run after AI output to aggregate signals, build execution profiles, or gate trades.

## Flow

```mermaid
sequenceDiagram
    participant Orchestrator as Trading Orchestrator
    participant Runtime as PipelineRuntime
    participant Analysis as InstrumentAnalysisRunner
    participant Phase as AIPhaseRunner
    participant Worker as runAIWorker
    participant Engines as Signal Engines

    Orchestrator->>Runtime: runPlan(id, session/cycle/instrument)
    alt phase-only run
        Runtime->>Phase: run(selector | technical | fundamental | review | decision)
        Phase->>Worker: execute workers in batches
        Worker-->>Phase: typed worker output + trace
        Phase->>Engines: finalize aggregate output
        Phase-->>Runtime: AIPhaseResult
    else full instrument analysis
        Runtime->>Analysis: run(default-trade-cycle, instrument)
        Analysis->>Engines: candidate_validation
        Analysis->>Phase: technical
        Phase-->>Analysis: TechnicalSignal
        Analysis->>Phase: fundamental
        Phase-->>Analysis: FundamentalSignal
        Analysis->>Phase: review
        Phase-->>Analysis: ReviewSignal
        Analysis->>Phase: decision
        Phase-->>Analysis: TradeSignal
        Analysis->>Engines: execution_profile + risk_gate + broker_allocation
        Analysis-->>Runtime: InstrumentAnalysisResult
    end
    Runtime-->>Orchestrator: final result
```

## Terms

- **AIPhase** - executable definition of one named AI phase: entry modes, input builders, worker batches, finalizer, cache policy, and output filter.
- **InstrumentAnalysis** - ordered analysis for one selected instrument. It mixes AI phases with deterministic engine steps and returns accumulated state.
- **WorkerDefinition** - static metadata for one AI worker: prompt, tools, strategy context request, output mode, and output schema.
- **PipelineRuntime** - composition root that injects repos, provider registries, search/broker dependencies, strategy context, spend tracking, and tool context into the runners.
- **Signal engine** - deterministic code under `services/signal/` that reads task input and returns typed results without calling an LLM.
- **Cycle id** - current runtime identifier for one trading-loop tick. Some code still uses `cycle` naming because the trading loop owns the outer tick.

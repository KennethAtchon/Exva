# pipeline

Runs the structured AI analysis pipeline. It can run one phase by itself, or run a full instrument analysis that chains technical -> fundamental -> review -> decision and the deterministic gates around them.

## Technical

- `core/pipeline-runtime.ts` is the composition root. It owns `runPlan`, `runCycle`, and `runAIPhase`.
- `phases/` runs one `AIPhase`; `analysis/` runs one `InstrumentAnalysis`.
- `implementations/` holds the trading-specific selector/trade wiring; `core/`, `phases/`, `analysis/`, `execution/`, `prompting/`, and `worker-tools/` are the reusable machinery.
- Prompt text is bundled in `worker-prompts.ts`; message assembly happens in `prompting/worker-prompt-builder.ts`.
- Deterministic engines are part of the pipeline contract. Some enrich worker context, others run as analysis steps after AI output exists.

## Flow

```mermaid
sequenceDiagram
    participant Orchestrator
    participant PipelineRuntime
    participant AIPhaseRunner
    participant InstrumentAnalysisRunner
    participant WorkerExecutor
    Orchestrator->>PipelineRuntime: runPlan(...) or runCycle(...)
    alt phase-only run
        PipelineRuntime->>AIPhaseRunner: run(phase, input)
        AIPhaseRunner->>WorkerExecutor: run workers by dependency batch
        WorkerExecutor-->>AIPhaseRunner: worker results + traces
        AIPhaseRunner-->>PipelineRuntime: phase output
    else full instrument analysis
        PipelineRuntime->>InstrumentAnalysisRunner: run(default-trade-cycle, instrument)
        InstrumentAnalysisRunner->>AIPhaseRunner: run technical/fundamental/review/decision
        InstrumentAnalysisRunner-->>PipelineRuntime: accumulated state
    end
    PipelineRuntime-->>Orchestrator: final result
```

## Terms

- **AIPhase** — definition of one analysis phase (workers, batches, finalize).
- **InstrumentAnalysis** — ordered sequence of phase runs and deterministic engine steps for one instrument.
- **WorkerDefinition** — one AI worker's prompt, tools, output mode, and schema.

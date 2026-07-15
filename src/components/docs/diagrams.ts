export const SYSTEM_ARCHITECTURE_CHART = `graph LR
    subgraph Sources["Signal sources"]
        EDGAR["EDGAR / calendar / scans"]
        Other["Mock / Manual / PM / etc."]
    end
    subgraph Main["Main process"]
        Bus["SignalBus + SQLite"]
        Queue["Session delivery queue"]
        Orch["AgentOrchestrator"]
        Pipe["PipelineRuntime"]
        Risk["Risk gate + broker routing"]
    end
    EDGAR --> Bus
    Other --> Bus
    Bus --> Queue
    Queue --> Orch
    Orch --> Pipe
    Pipe --> Risk`;

export const SIGNAL_END_TO_END_CHART = `sequenceDiagram
    participant Source as Signal Source
    participant Bus as SignalBus
    participant DB as SQLite
    participant Gate as Delivery gate
    participant Queue as Session queue
    participant Orch as AgentOrchestrator
    participant Pipeline as PipelineRuntime

    Source->>Bus: onSignal(SignalEvent)
    Bus->>DB: persist event
    loop each subscribed session
        Bus->>Gate: evaluate compatibility + routing
        alt gate fails
            Gate->>DB: dead letter
        else gate passes
            Gate->>Queue: enqueue delivery
            Note over Queue: queued, or waiting_for_resume if paused
            Queue->>Orch: signal_delivery_updated
            Orch->>Pipeline: run experience pipeline
            Pipeline-->>Orch: trade, reject, or drop
            Orch->>Queue: terminal delivery status
        end
    end`;

export const PIPELINE_RUNTIME_CHART = `sequenceDiagram
    participant Orch as AgentOrchestrator
    participant Runtime as PipelineRuntime
    participant Analysis as InstrumentAnalysisRunner
    participant Phase as AIPhaseRunner
    participant Worker as AI worker
    participant Engines as Phase / signal engines

    Orch->>Runtime: runPlan(pipeline id, instrument)
    alt phase-only run
        Runtime->>Phase: run one phase
        Phase->>Engines: resolve entry, cache, input engines
        Phase->>Worker: execute worker batches
        Worker-->>Phase: typed output + trace
        Phase->>Engines: run finalizer engines
        Phase-->>Runtime: AIPhaseResult
    else full instrument analysis
        Runtime->>Analysis: run instrument analysis plan
        Analysis->>Phase: technical → fundamental → review → decision
        Phase-->>Analysis: phase signals
        Analysis->>Engines: execution profile + risk gate + broker allocation
        Analysis-->>Runtime: InstrumentAnalysisResult
    end
    Runtime-->>Orch: final result`;

export const EDGAR_PIPELINE_CHART = `sequenceDiagram
    participant Orch as AgentOrchestrator
    participant Runtime as PipelineRuntime
    participant Analyst as Catalyst analysis
    participant Review as Adversarial review
    participant Decision as Catalyst decision engine
    participant Risk as Risk gate chain

    Orch->>Runtime: runPlan(edgar-8k-cycle)
    Runtime->>Analyst: fundamental phase (filing context)
    Analyst-->>Runtime: catalyst analyst output
    Runtime->>Review: review phase (challenge thesis)
    Review-->>Runtime: adversarial reviewer output
    Runtime->>Decision: catalyst-trade-decision engine
    Decision-->>Runtime: trade or skip
    Runtime->>Risk: execution profile + risk gate + broker allocation
    Risk-->>Runtime: allowed or blocked
    Runtime-->>Orch: InstrumentAnalysisResult`;

export const EDGAR_DETECTION_CHART = `flowchart TD
    A["Poll SEC Atom feed"] --> B["Parse entry"]
    B --> C{"CIK whitelist?"}
    C -->|fail| X["Dropped"]
    C -->|pass| D["Resolve CIK → ticker"]
    D -->|fail| X
    D -->|pass| E{"Min filing age?"}
    E -->|fail| X
    E -->|pass| F{"Item code filter?"}
    F -->|fail| X
    F -->|pass| G["Emit SignalEvent"]
    G --> H["SignalBus fan-out to sessions"]`;

export const RISK_GATE_CHART = `flowchart TD
    A["Decision: trade proposed"] --> B{"Stats gates<br/>budget · daily loss · profit target · losers"}
    B -->|breached| R["Rejected"]
    B -->|pass| C{"Size > 0?"}
    C -->|no| R
    C -->|yes| D{"Concurrent cap?"}
    D -->|at cap| R
    D -->|ok| E["Size the position<br/>flat USD or ATR vol-target"]
    E --> F{"Asset-group exposure cap?"}
    F -->|breached| R
    F -->|ok| G["Clamp to max position USD"]
    G --> H["Clamp prediction-market<br/>size to max exposure"]
    H --> I{"Spread > volatility halt?"}
    I -->|yes| R
    I -->|no| J["Allowed → place order"]`;

export const SESSION_LIFECYCLE_CHART = `sequenceDiagram
    participant UI
    participant Session as SessionService
    participant Bus as SignalBus
    participant Orch as AgentOrchestrator
    participant Pipeline as PipelineRuntime

    UI->>Session: Start / Resume
    Session->>Orch: activate orchestrator
    Bus->>Bus: enqueue delivery (queued)
    Bus->>Orch: signal_delivery_updated
    Orch->>Pipeline: run pipeline for signal
    Pipeline-->>Orch: result
    Orch->>Bus: terminal status (traded / rejected / dropped)
    alt operator pauses session
        UI->>Session: Pause
        Bus->>Bus: new deliveries → waiting_for_resume
        Note over Bus: 4-hour expiry TTL while paused
    end`;

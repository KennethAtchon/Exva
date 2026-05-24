# pipeline/definitions

Defines what each pipeline phase is made of. This folder says which workers exist, what they output, and which finalize engines run, but it does not execute anything itself.

## Technical

- One file per phase: `selector`, `technical`, `fundamental`, `review`, `decision`.
- Definitions reference worker sets, output schemas, and persistence metadata.
- `PipelineRuntime` and the phase registry consume these definitions at runtime.

## Flow

```mermaid
flowchart LR
    DEF[Phase definition] --> REG[Phase registry]
    REG --> RUNNER[AIPhaseRunner]
```

## Terms

- **PipelineDefinition** — static description of one phase's workers, outputs, and finalize behavior.

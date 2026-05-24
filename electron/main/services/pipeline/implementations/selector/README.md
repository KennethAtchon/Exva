# pipeline/implementations/selector

Implements the selector phase that finds which instruments are worth a full trade analysis. It handles discovery, verification, scoring, filtering, and final submission shape.

## Technical

- `selector-analysis.ts` defines the selector `AIPhase`.
- `selector-schemas.ts` defines the structured worker output shapes used during discovery and verification.
- Discovery workers propose candidates; verification workers gather evidence and tighten confidence before candidates are scored and filtered.

## Flow

```mermaid
flowchart LR
    DISC[Discovery workers] --> MERGE[Merge candidates]
    MERGE --> VERIFY[Verification workers]
    VERIFY --> SCORE[Score and risk-filter]
    SCORE --> OUT[InstrumentSelection]
```

## Terms

- **Selector candidate** — a proposed instrument being evaluated for promotion into the trade pipeline.

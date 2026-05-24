# signal/scoring

Scores selector candidates and throws away the weak ones. This is the deterministic filter between "interesting maybe" and "worth a full trade analysis."

## Technical

- `selector-candidate-merger.ts` deduplicates and merges discovery output.
- `selector-scoring-engine.ts` assigns scores.
- `selector-risk-filter.ts` applies deterministic guardrails before a candidate survives.
- `selector-submission-builder.ts` shapes the final selector output payload.

## Flow

```mermaid
flowchart LR
    DISC[Discovery candidates] --> MERGE[Merge]
    MERGE --> SCORE[Score]
    SCORE --> FILTER[Risk filter]
    FILTER --> SUBMIT[Final selection payload]
```

## Terms

- **Selector candidate** — a proposed instrument still competing for selection.

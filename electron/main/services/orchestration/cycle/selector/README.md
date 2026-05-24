# orchestration/cycle/selector

Triggers the selector analysis inside the live runtime. It takes the selector result and turns it into concrete instruments the trade loop can queue next.

## Technical

- `run-selector.ts` is the entry point.
- It calls the AI pipeline for selector work, then normalizes the returned selection into `ResolvedInstrument` records.

## Terms

- **Resolved instrument** — selector-approved instrument normalized for the trade cycle.

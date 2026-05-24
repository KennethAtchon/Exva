# signal/execution

Turns a trade decision into an execution profile. This folder computes deterministic order-shape details like side, sizing, and price levels from already-produced signals.

## Technical

- `trade-execution-profile.ts` is the current execution-profile engine.
- Inputs come from decision output, review state, instrument class, and risk settings.

## Terms

- **Execution profile** — deterministic order parameters derived from an approved decision signal.

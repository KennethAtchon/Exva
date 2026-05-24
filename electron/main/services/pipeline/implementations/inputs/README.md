# pipeline/implementations/inputs

Deterministic engine payloads for the trade-cycle signal engines. Selector input engines live in `pipeline/engines/input/`.

## How it works

- `trade-engine-input-builders.ts` registers four signal-engine input builders used by the default trade analysis.
- `candidate-validation` resolves the broker adapter, normalizes the symbol, fetches a market snapshot, and patches `quoteSnapshot` into analysis state.
- `execution-profile` requires decision and review output and builds the task for position sizing and entry/stop/target profile.
- `risk-gate` requires the execution profile and decision output, loads dashboard stats, and builds the proposed order payload for risk policy evaluation.
- `broker-allocation` requires a risk-approved order, resolves the broker account, and verifies allocation/conflict rules.

## Terms

- **signal-engine input builder** - builder that returns a typed task for one deterministic signal engine.
- **statePatch** - partial `InstrumentAnalysisState` applied before an engine output is interpreted.
- **applyOutput** - builder hook that converts engine output into new analysis state or rejects the candidate/trade.

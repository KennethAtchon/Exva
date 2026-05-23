# signal

Deterministic post-LLM logic — aggregates worker outputs, scores selector candidates, runs policy engines.

## Technical

- `aggregators/` merge worker JSON into phase signals.
- `scoring/` ranks and filters selector candidates.
- `registry/` registers `SignalEngineDefinition` bindings (risk gate, order policy, etc.).

## Terms

- **SignalEngine** — deterministic function injected into worker prompts or run as analysis steps.

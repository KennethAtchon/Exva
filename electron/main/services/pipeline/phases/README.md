# pipeline/phases

Defines and runs a single **AIPhase** — one pipeline phase like selector or technical.

## Technical

- `AIPhaseRunner` executes stages (`AIWorkerBatch`) with caching and input builders.
- Selector is registered as an `AIPhase`; trade sub-phases are separate `AIPhase` definitions.

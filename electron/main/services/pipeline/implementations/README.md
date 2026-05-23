# pipeline/implementations

Trading-specific analysis implementations: selector plan, trade cycle, caches, input builders, registries.

## Technical

- `selector/` — two-stage discovery + verification.
- `trade/` — default instrument analysis and per-phase aggregator plans.
- `registry/` — boot-time registration and `AnalysisDispatcher`.

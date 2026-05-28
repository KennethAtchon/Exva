# Exva AI capabilities when using a mock broker

## Works in both mock and paper

- AI selector cycle runs (`selector` plan): discovery, verification, and finalization still execute.
- Full AI trade cycle runs (`default-trade-cycle`): candidate validation, technical/fundamental/review phases, decision phase, risk gate.
- Approval flow works: approval-required trades, approve/reject handling, and approval recheck.
- Order policy gate works before placement (quote freshness, spread, capital, idempotency, etc.).
- Trade lifecycle works end-to-end: pending -> open -> closed/rejected with persisted records.
- Trade monitor works: polling, exit policy checks, broker status checks, and close flow.
- Event/trace logging works: execution steps, events, agent runs/messages, API call logs.
- Post-trade analytics work: autopsy/replay surfaces and scorecard generation.

## Mock-only AI/testing behavior

- Deterministic scenario-driven market simulation is available (`clean_breakout`, `failed_breakout`, `stale_quote`, `wide_spread`, `partial_fill`, `broker_reject`, `rate_limit`, etc.).
- Mock OHLCV bars are generated for AI tools/analysis (`getOhlcv` synthetic bars).
- Mock discovery fixtures can feed AI tools (trending/web/url fixtures) through mock tool context.
- Connection test is always successful with fixed simulated balance (no real API dependency).
- Controlled failure injection is possible (market closed, broker timeout, rejection, rate-limit).

## Key differences: mock vs paper

- Data source:
  - `mock`: synthetic + deterministic scenario data.
  - `paper`: broker-provided market/account data from paper endpoints.
- Execution realism:
  - `mock`: in-memory simulated orders/fills/PnL.
  - `paper`: real broker paper order lifecycle semantics.
- Failure mode testing:
  - `mock`: explicit scenario-driven failures (easy to reproduce).
  - `paper`: failures come from broker/API/network conditions.
- Broker dependency:
  - `mock`: no external broker/API required.
  - `paper`: requires configured broker credentials and reachable broker API.
- Launch capability:
  - `mock`: explicitly not launch-capable (never live).
  - `paper`: still paper-only account mode, but behavior follows actual broker adapter.
- Coverage:
  - `mock`: supports all instrument classes in simulator.
  - `paper`: depends on each broker adapter's supported classes.
- Scorecard nuance:
  - `mock`: scenario coverage metrics are available from mock metadata.
  - `paper`: no mock scenario coverage unless metadata was injected.

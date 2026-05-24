# broker/mock

Provides the paper-trading broker used for local testing and sandbox sessions. It simulates fills and market data without touching a real exchange.

## Technical

- `mock-adapter.ts` implements the normal broker adapter interface.
- `mock-market-simulator.ts` and the fixture files generate deterministic synthetic behavior for tests and paper mode.

## Terms

- **Mock broker** — local broker implementation with no real money and no live external orders.

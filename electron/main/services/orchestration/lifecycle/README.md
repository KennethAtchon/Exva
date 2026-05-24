# orchestration/lifecycle

Owns what happens when a session starts, pauses, stops, or keeps watching open positions. This is the part that keeps the long-lived runtime honest between trading cycles.

## Technical

- `position-manager-service.ts` coordinates lifecycle actions around open positions.
- `trade-monitor.ts` polls and enforces exit behavior for live trades.

## Terms

- **Trade monitor** — long-lived service that watches open positions after entry.

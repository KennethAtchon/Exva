# End-to-End Testing Guide

> **Status:** Working guide for integration and Electron end-to-end coverage.
> **Last verified:** 2026-07-21.
> **Scope:** Vitest exercises the signal → selector → analysis → decision → risk
> → order pipeline in process. Playwright drives an Electron app across renderer,
> preload, IPC, main, and SQLite boundaries; packaged provenance is still partial.

---

## 1. Why this exists

Unit tests prove a function is correct in isolation. They did **not** catch the
class of bug that motivated this guide: a debug "force trade" sent a **market
order for SPY while the US market was closed**, Alpaca accepted it but never
reported a fill price, and the call failed with a confusing error. Every unit
involved behaved "correctly" — the gap was in the _seams between them_ and in a
real-world condition (wall-clock time / market hours) that no unit test
simulated.

E2E tests target exactly those seams and conditions:

- order **type** is chosen correctly for the instrument **and** the current
  trading session (market vs. extended-hours limit vs. blocked),
- the market-hours guard and the broker adapter agree on what "open" means,
- off-hours policy (`disabled` vs. `extended_hours`) actually changes behavior
  end to end, not just in the config row.

---

## 2. Test taxonomy

| Layer                   | Lives in                             | Command                               | Proves                                                                                      |
| ----------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Unit                    | `**/__tests__/*.test.ts`             | `bun run test`                        | One function/class or narrow collaboration.                                                 |
| Service integration     | `**/__tests__/*.integration.test.ts` | `bun run test`                        | Multiple real services/repos through mock network/LLM/broker edges.                         |
| Electron UI E2E         | `e2e/*.spec.ts`                      | `bun run package && bun run test:e2e` | Renderer, preload, IPC, main, and SQLite journey; packaged provenance is currently partial. |
| Manual paper-broker E2E | Developer Workbench force-trade      | On demand                             | Last mile against a real paper broker.                                                      |

Do not call a Vitest integration test “E2E” in new files. E2E means an Electron
process boundary unless a section explicitly says “pipeline integration.” A test
counts as **packaged E2E** only when it proves the artifact path and fingerprint.

---

## 3. Determinism rules (read before writing a test)

E2E tests touch the things that make suites flaky. Hold the line on these:

1. **Never read the real clock.** Anything whose behavior depends on market
   hours must take an injectable clock. The Alpaca adapter takes a `now: () =>
Date` constructor arg; `MarketHoursService` and `getUsEquitySession` take a
   `now` parameter. Pin a fixed instant per test.
   - Regular hours: `new Date("2026-06-12T14:00:00Z")` (Fri 10:00 ET)
   - Extended hours: `new Date("2026-06-12T22:00:00Z")` (Fri 18:00 ET)
   - Closed/overnight: `new Date("2026-06-12T06:00:00Z")` (Fri 02:00 ET)
   - Weekend: any Sat/Sun; Holiday: see `us-market-holidays.ts`.
2. **No live network.** Stub `fetch` (see `alpaca-adapter.test.ts`) or use the
   `MockMarketSimulator` / mock broker adapter.
3. **Fresh DB per test.** Use `createTestDb()` from the DB test helpers. It runs
   migrations into in-memory SQLite. Session/account fixtures such as
   `createMinimalSession` and `insertBrokerAccount` live in
   `electron/main/db/test-fixtures.ts`.
4. **Mock only at the edges.** Mock the LLM and the network; use **real** repos,
   the real risk engine, the real market-hours guard. The bugs live in the wiring,
   so don't mock the wiring.

---

## 4. Where to plug in

```
signal-bus            → SignalBus (delivery gate, force-trade)        signals/__tests__
selector              → MarketHoursService + run-selector             orchestration/cycle/__tests__
full cycle            → AgentOrchestrator / executeTradeCycle         orchestration/__tests__/*.integration
order placement       → AlpacaAdapter (stubbed fetch) / mock adapter  broker/adapters/__tests__
config → behavior     → SessionRiskConfig.offHoursTrading             threaded selector→adapter
```

The golden-path integration tests in
`electron/main/services/orchestration/__tests__/*.integration.test.ts` show the
full assembly: `registerDefaultEngines(...)`, a `TradingCycleContext`, an
`AgentOrchestrator`, and `executeTradeCycle`, with the LLM phases stubbed and a
`MockMarketSimulator` standing in for the broker.

---

## 5. Required scenario matrix

Off-hours order routing is the area most prone to silent breakage. Every change
to order construction or the market-hours guard must keep this matrix green
(current coverage in parentheses):

| Instrument | Session            | Off-hours policy | Expected                                                                                     |
| ---------- | ------------------ | ---------------- | -------------------------------------------------------------------------------------------- |
| crypto     | any (incl. closed) | any              | market `gtc`, notional — always fills (`alpaca-adapter.test.ts`)                             |
| stock      | regular            | any              | market `day`, notional (`alpaca-adapter.test.ts`)                                            |
| stock      | extended           | `extended_hours` | limit `day` + `extended_hours`, marketable price, whole-share qty (`alpaca-adapter.test.ts`) |
| stock      | extended           | `disabled`       | excluded by guard (`market-hours-service.test.ts`)                                           |
| stock      | closed             | any              | refused `MARKET_CLOSED` (`alpaca-adapter.test.ts`) / excluded by guard                       |
| options    | regular            | any              | market `day`, qty in contracts (`alpaca-adapter.test.ts`)                                    |
| options    | extended/closed    | any              | refused `MARKET_CLOSED` (`alpaca-adapter.test.ts`)                                           |

**Invariant:** a market order is **never** sent outside regular hours. An
off-hours order is a limit + `extended_hours` order or it is not placed at all.

Debug force-trade has its own invariant: it prefers **crypto (BTC-USD)** so the
check works 24/7 (`pick-debug-instrument.test.ts`).

---

## 6. Running

```bash
bun run typecheck     # types must pass first — config is threaded through many layers
bun run test          # vitest run — unit + integration together
bunx vitest run <path> # focus a file/dir while iterating
bun run package && bun run test:e2e # packaged Electron journeys
```

Filter to the order-routing surface while working in this area:

```bash
bunx vitest run \
  electron/main/services/broker/adapters/__tests__/alpaca-adapter.test.ts \
  electron/main/services/orchestration/cycle/__tests__/market-hours-service.test.ts \
  electron/shared/instruments/__tests__/us-equity-session.test.ts \
  electron/main/services/signals/__tests__/pick-debug-instrument.test.ts
```

Evergreen documentation does not whitelist failing tests. If CI has a known
failure, link a dated issue/run in the change under test and prove the current
failure set exactly matches it.

### Electron E2E artifact caveats

Playwright retains traces and screenshots on failure. The current cleanup helper
deletes the isolated `userData` directory, including its DB and local logs, even
after a failed test. Until failure-preserving cleanup is implemented, copy or
attach those artifacts inside the test before cleanup when DB/log evidence is
required.

The launcher currently hardcodes the macOS arm64 output and falls back to source
mode when that package is missing. Packaged-only tests must resolve the artifact
for the active platform/architecture, fail instead of accepting fallback, and
record the app/build/artifact fingerprint in the test output.

---

## 7. Manual last-mile check

Before trusting order placement against a real (paper) broker:

1. Assign a **paper** broker to the session.
2. Trigger the debug force-trade (Developer Workbench).
3. Expect a filled BTC-USD order with a non-null average price.

Force-trade is paper-only by guard; it will refuse a live broker. Use `/run` and
`/verify` to drive the packaged app for anything beyond this.

---

## 8. Checklist for new pipeline/order work

- [ ] New time-dependent behavior takes an injectable clock; tests pin it.
- [ ] The scenario matrix in §5 is extended, not just satisfied.
- [ ] A test fails if the business reason changes (assert _why_, e.g. order
      type + `extended_hours`, not just "an order was sent").
- [ ] `createTestDb()` exercises any new migration.
- [ ] `bun run typecheck`, the focused suite, and affected packaged E2E pass.
- [ ] Failure paths emit the signal, correlation key, durable artifact, and safe
      debug bundle required by `observability-guide.md`.

## 9. Observability Failure Injection

The observability claim is gated by the adversarial matrix in
[`observability-guide.md`](./observability-guide.md#11-adversarial-failure-coverage).
Each injected failure must assert:

1. A specific machine event or health transition is emitted.
2. The event carries a stable causal/domain correlation key.
3. Required evidence survives the affected process terminating.
4. A default sanitized evidence bundle identifies the injected first divergence.

At minimum, packaged E2E must inject renderer load/crash/hang, IPC timeout,
utility-process exit/wedge, SQLite busy/corrupt/low-disk, scheduler lateness,
provider timeout/rate-limit/malformed response, stale renderer state, and log-sink
failure. Mark a scenario **Required**, not covered, until the necessary production
signal exists.

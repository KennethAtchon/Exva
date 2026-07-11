# End-to-End Testing Guide

> **Status:** Working guide for end-to-end (E2E) coverage of the trading system.
> **Scope:** The signal → selector → analysis → decision → risk → order pipeline,
> exercised in-process against a mock broker. This is _not_ UI automation; it is
> a Vitest-driven integration layer that proves the system places the right
> orders for the right reasons.

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

| Layer             | Lives in                                      | Runs                       | Proves                                                            |
| ----------------- | --------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| Unit              | `**/__tests__/*.test.ts`                      | always                     | one function/class in isolation                                   |
| Integration / E2E | `**/__tests__/*.integration.test.ts`          | always (same `vitest run`) | multiple services wired together through real repos + mock broker |
| Manual app E2E    | `/run`, `/verify` skills + force-trade button | on demand                  | the packaged Electron app against a paper broker                  |

We do **not** use Playwright/Electron UI automation today. The cost/benefit
favors in-process integration tests plus the manual force-trade check for the
last mile. Revisit if UI regressions become a recurring source of escaped bugs.

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
3. **Fresh DB per test.** Use `createTestDb()` (`electron/main/db/test-helpers.ts`)
   — it runs migrations into an in-memory SQLite, so schema changes are covered
   automatically. Fixtures: `createMinimalSession`, `insertBrokerAccount`.
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
npm run typecheck     # types must pass first — config is threaded through many layers
npm run test          # vitest run — unit + integration together
npx vitest run <path> # focus a file/dir while iterating
```

Filter to the order-routing surface while working in this area:

```bash
npx vitest run \
  electron/main/services/broker/adapters/__tests__/alpaca-adapter.test.ts \
  electron/main/services/orchestration/cycle/__tests__/market-hours-service.test.ts \
  electron/shared/instruments/__tests__/us-equity-session.test.ts \
  electron/main/services/signals/__tests__/pick-debug-instrument.test.ts
```

> **Known pre-existing failures:** `candidate-validation-service.test.ts`,
> `phase-worker-modes.test.ts`, and `signal-dead-letters-replay.test.ts`
> currently fail independently of off-hours work. Don't let them mask new
> regressions — diff the failing set against this list.

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
- [ ] `npm run typecheck` and the focused suite pass; pre-existing failures in
      §6 are unchanged.

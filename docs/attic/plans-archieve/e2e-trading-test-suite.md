# Meaningful End-to-End Test Suite — Plan

> **Date:** 2026-06-20
> **Status:** Partially implemented — integration coverage expanded 2026-06-20; remaining full-stack e2e journeys still open
> **Deciders:** Kenneth (owner)

## 1. Problem Statement

Exva is a multi-session autonomous trading app (Electron + SQLite + utility-process session runtimes). It already has 243 unit/integration test files and a thin Playwright e2e layer (7 specs under `e2e/`) that only proves the app launches, navigates, and can seed one paper session. None of the existing e2e specs exercise the parts of the system where money-losing bugs actually live: capital allocation across brokers, per-session isolation, the concurrent-trade cap, the risk engine's gate chain, the preflight checks that block a bad session from starting, the three strategy signal rules, and the five signal sources.

Today there is no test that answers questions like: _if five sessions each claim $20k from a broker that only has $X free, does the sixth start get rejected?_ or _can session A see/touch session B's open positions?_ or _does the mean-reversion rule emit a buy at exactly z ≤ −2 and skip at −1.99?_ These are the invariants that, if broken, cause real capital loss or cross-account leakage. The forcing function: the system is approaching live (non-paper) execution (`live-readiness-service.ts`, `executionMode`), and the cost of an isolation or allocation bug escalates from "paper P&L wrong" to "real money mis-routed" the moment a live broker is connected. We need a meaningful, deterministic e2e safety net before that line is crossed.

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                                                                                                  | Success Looks Like                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cover the full happy path: connect broker → connect AI agent → create mean-reversion session → start → produce a signal → place a paper trade → close | One green e2e test that drives the real Electron app through every layer with the mock broker/sim                                                                                   |
| 2   | Exhaustively test the three signal rules against boundary inputs                                                                                      | Each of mean-reversion / breakout / trend-following has buy/sell/skip + every guard branch asserted (table-driven)                                                                  |
| 3   | Exhaustively test the five signal sources against success + edge cases                                                                                | Each source: `test()`, `start/stop/restart`, error path, empty/malformed poll, dedup/drop behavior asserted                                                                         |
| 4   | Prove multi-session broker isolation                                                                                                                  | 5 sessions × $20k from one broker; assert allocation gate, session-cap, and that no session can read/mutate another's trades or capital                                             |
| 5   | Prove the concurrent-instrument cap (max 3)                                                                                                           | 4th distinct-instrument open attempt is denied with `concurrent_cap`; 3 is allowed                                                                                                  |
| 6   | Prove risk partitioning + strategy config                                                                                                             | Per-trade risk %, ATR vol-target sizing, max-position clamp, asset-group exposure cap, daily-loss / profit-target / consecutive-loser / API-budget gates each assert their boundary |
| 7   | Make the suite deterministic and CI-runnable                                                                                                          | No wall-clock sleeps, no live network; fake timers + mock adapter + seeded sim; stable across reruns                                                                                |

**Non-Goals**

| #   | Non-Goal                                                                                 | Reason                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Testing real broker adapters (Alpaca, Coinbase, Tradovate, Polymarket) against live APIs | Out of scope; we test our routing/normalization, not third-party uptime. Adapter HTTP contracts stay in their own unit tests |
| 2   | LLM output quality / prompt evaluation                                                   | The AI agent is mocked to deterministic outputs; we test plumbing, not model behavior                                        |
| 3   | UI visual regression / pixel snapshots                                                   | This plan is about behavioral correctness, not styling                                                                       |
| 4   | Performance/load testing                                                                 | Separate concern; serial Electron runs make this the wrong harness                                                           |
| 5   | Rewriting existing 243 unit tests                                                        | We add a coverage layer, not refactor what works                                                                             |

## 3. Background & Context

**Layering (where each tested invariant lives):**

- **Broker/capital** — `broker/broker-capital-service.ts` (`checkSessionStartFits` → `session_cap_exceeded` | `over_allocated`), `broker/broker-routing-service.ts` (`resolveBrokerAccountId`), `broker/mock/mock-market-simulator.ts`, `broker/adapters/mock-adapter.ts`. Broker accounts carry `maxSessions` and `balanceCacheUsd`.
- **Preflight** — `session/preflight/*`: `broker-allocation-check.ts` (assignments present, balances reachable, capital fits), `instrument-conflict-check.ts` (`INSTRUMENT_CONFLICT` when another active session holds the same symbol on the same broker), `broker-reachability-check.ts`, `provider-credentials-check.ts`, `selector-config-check.ts`, `task-boundary-check.ts`.
- **Risk engine** — `risk/risk-engine.ts` `validateDecision()`: ordered gate chain → `session_limits` (api_budget, daily_loss, profit_target, consecutive_losers) → `position_size > 0` → `concurrent_cap` (`open_trades < max_concurrent_trades`) → ATR vol-target resize → asset-group exposure cap → max-position clamp → prediction-market exposure clamp → volatility halt. Also `correlation-exposure-service.ts` (same-group cap × regime multiplier), `broker-allocation-gate.ts`, `capital-reservation-service.ts`, `experience-capital-allocator.ts`, `exit-policy-evaluator.ts`.
- **Order policy** — `orchestration/policy/order-policy-gate.ts`: quote staleness by class/holding-style, price collar, max spread, position cap, broker class support + market hours, enforceable-exit requirement.
- **Concurrent cap** — config key `max_concurrent_trades`, enforced in `risk-engine.ts:195`, queue concurrency `agent-orchestrator.ts:47`, and selector capping `selector/run-selector.ts:80`. "Max 3 open trades for different instruments" maps to `max_concurrent_trades = 3`.
- **Signal rules** — `signal/rules/{mean-reversion,breakout,trend-following}-signal.ts` (pure functions, Zod-validated I/O). Mean-reversion: `<20` bars → skip@0.2; z ≤ `zScoreEntry`(default −2) → buy; else skip.
- **Signal sources** — `signals/sources/{edgar,mock,prediction-event,timer,web-search}-signal-source.ts`, all implement `ISignalSource` (`start/stop/restart/test/snapshot/onSignal/offSignal`).
- **Session lifecycle** — `session/session-service.ts`, `session-runtime-manager.ts`, utility-process runtimes; preload bridge `electron/preload/exva-api.ts` + `index.ts` expose `exva.session.{create,start,pause,resume,stop,focus,getStatus}`, `exva.accounts.{addBroker,saveProvider}`, `exva.strategy.*`.

**Existing e2e harness:** `e2e/helpers/launch-app.ts` launches the packaged app with a temp `userDataDir` and `EXVA_DB_REBUILD_FROM_SCRATCH=true`; `seed-fixtures.ts` seeds a mock broker + AI provider + one paper session via `window.exva`. Playwright config: serial, `workers: 1`, 90s timeout. Build required first (`bun run package`).

**Constraints that cannot change:** Electron processes are heavy → serial only. SQLite is per-`userDataDir` → DB isolation is by data, not by process for in-app sessions. The mock broker/sim is the only deterministic execution path. The AI provider key in fixtures is fake (`e2e-test-key`) → the agent path must be mock-resolved, not calling a real model.

## 4. Research Summary

**Playwright + Electron deterministic e2e**
Dominant guidance: assert on observable state (visibility/text/count) with auto-waiting, never `waitForTimeout`; mock all external network at the interception layer so a spec doubles as fast/stable; give each test a fresh context/data dir and clean up created data in a fixture/`finally`. This matches the existing harness (fresh `userDataDir` per launch) — the gap is that our "external" surfaces (broker REST, market data, LLM) are _inside_ the Electron main process, so interception must happen at our adapter seam (mock adapter + mock signal source), not at Playwright's `route()`. Key insight: drive determinism through env flags and injected mock scenarios rather than network routing.
Sources: https://www.browserstack.com/guide/playwright-best-practices , https://dev.to/nazar_boyko/playwright-for-full-stack-testing-auth-fixtures-mocking-snapshots-and-parallel-runs-without-4311

**Multi-tenant isolation testing**
The strongest finding: isolation tests must assert the _negative_ — not only that tenant A sees A's data, but that tenant B's data is absent and untouchable. Isolation bugs are the most damaging and are usually first caught by e2e. Applied here: for the 5-session test, it is not enough that each session trades; we must assert session A cannot read/close session B's open trades, and that B's allocated capital is unaffected by A's fills. `checkInstrumentConflict(brokerAccountId, symbol, sessionId)` already scopes by session — the test must prove the scoping, including the same-symbol-different-broker case (allowed) vs same-symbol-same-broker (blocked).
Source: https://www.shiplight.ai/blog/saas-e2e-testing , https://testingbot.com/resources/articles/isolation-test

**Deterministic simulation for trading workflows**
Seed-reproducible simulation from signal→fill with deterministic reruns is the established pattern (NautilusTrader, WarpStream DST). Insight: separate the _clock_ and the _market_ from the system under test so the same seed yields the same fills. We already have `MockMarketSimulator` and `mock-scenario-fixtures.ts`; the plan leans on these plus `vi.useFakeTimers()` at the integration layer and a fixed scenario seed at the e2e layer, so concurrent-cap and allocation races are reproducible.
Sources: https://nautilustrader.io/ , https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas

## 5. Options Considered

**Option A: Status quo — keep thin e2e, rely on unit tests**

Leave the 7 launch/nav specs; trust per-service unit tests to catch regressions.

| Dimension      | Assessment                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| Complexity     | None added                                                                                |
| Performance    | Fast                                                                                      |
| Reliability    | Poor — no test crosses the broker↔session↔risk seams where isolation/allocation bugs live |
| Cost           | Zero now, high later (a live-money isolation bug)                                         |
| Reversibility  | N/A                                                                                       |
| Stack fit      | Fits, but leaves the stated goals unmet                                                   |
| Team readiness | Already here                                                                              |

Risks: cross-session leakage or mis-allocation ships undetected (high impact, medium likelihood given live execution is imminent).
Open questions: none — it explicitly fails Goals 1, 4, 5.

**Option B: Pure-Playwright e2e only — drive everything through `window.exva` UI/bridge**

Express every scenario (all signal-rule boundaries, all risk gates, 5-session allocation) as full packaged-app Playwright specs.

| Dimension      | Assessment                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Complexity     | High — each spec boots Electron (~seconds), serial only                                                    |
| Performance    | Slow: ~50–100 boundary cases × serial Electron boot = many minutes; CI-hostile                             |
| Reliability    | Flaky risk grows with full-stack surface; fake-timer control of in-app runtimes from Playwright is awkward |
| Cost           | High engineering + CI time                                                                                 |
| Reversibility  | Medium                                                                                                     |
| Stack fit      | Overshoots — pure functions and the risk engine don't need a packaged app                                  |
| Team readiness | Harness exists but doesn't scale to this volume                                                            |

Risks: suite becomes slow/flaky → gets disabled (high likelihood, defeats the purpose).
Open questions: can the e2e layer advance fake clocks inside utility-process runtimes? (Likely no.)

**Option C (recommended): Two-tier — exhaustive Vitest integration tier + focused Playwright e2e tier**

Push the combinatorial edge-case matrix (signal rules, signal sources, every risk gate, allocation math, concurrent cap, isolation scoping) into fast Vitest integration tests that wire the _real_ services (`RiskEngine`, `OrderPolicyGate`, `BrokerCapitalService`, preflight checks, `MockMarketSimulator`) with fake timers and seeded scenarios — following the existing `orchestration-golden-paths.integration.test.ts` style. Keep Playwright for a small set of true full-stack journeys that prove the wiring through the real packaged app and preload bridge (happy path, 5-session allocation rejection, concurrent-cap denial visible in UI/status).

| Dimension      | Assessment                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Complexity     | Moderate — reuses existing harnesses on both tiers                                                        |
| Performance    | Fast: matrix runs in-process (ms); only ~5–8 specs pay Electron boot cost                                 |
| Reliability    | High — determinism via fake timers + seeded sim; e2e surface kept small                                   |
| Cost           | Moderate, front-loaded; amortizes immediately                                                             |
| Reversibility  | High — additive, no production code change required                                                       |
| Stack fit      | Strong — mirrors how the repo already tests (243 unit + integration files, mock sim, golden-path harness) |
| Team readiness | High — patterns already exist in-repo                                                                     |

Risks: integration tier could drift from real app behavior if it stubs too much (medium impact, low likelihood — mitigated by the e2e tier covering the same invariants end-to-end at least once each).
Open questions: which invariants _must_ also be proven at the packaged-app level vs trusted from the integration tier? (See §10.)

## 6. Recommendation

**We recommend Option C: a two-tier suite.** The decisive reason: the bug classes the user cares about (broker isolation, $20k×5 allocation, max-3 concurrent, risk partitioning, signal-rule boundaries) are _combinatorial_ — dozens of boundary cases — and combinatorial coverage belongs in fast in-process tests, while _wiring_ correctness (does the real preload bridge → session runtime → mock broker actually thread these values?) needs a handful of real-app journeys. Option A leaves the dangerous seams untested; Option B makes the matrix so slow it will be abandoned. Option C gets exhaustive coverage _and_ end-to-end proof, reusing harnesses the repo already has (`orchestration-golden-paths.integration.test.ts`, `e2e/helpers/*`, `MockMarketSimulator`, `mock-scenario-fixtures.ts`).

Key assumptions: (1) the mock adapter + sim can deterministically drive fills from a seed; (2) the agent path can be mock-resolved (it already is in golden-path tests via `resolveMockToolContext` + `runTradePipeline` spies); (3) `max_concurrent_trades` is the canonical encoding of "max 3 distinct open instruments." Conditions that would change the recommendation: if the integration tier cannot faithfully reproduce session-runtime behavior without the utility process (then more must move to e2e), or if "max 3 distinct instruments" turns out to be a _separate_ rule from `max_concurrent_trades` (then a new gate + tests are needed — see §10 Q1).

## 7. Implementation Plan

Each phase is independently shippable (adds passing tests, touches no production code) and leaves the suite green.

**Phase 0: Harness foundations**
Goal: shared deterministic fixtures both tiers reuse. Done when a helper can build a session with N brokers, fixed balances, named strategy config, and a seeded sim, and advance a fake clock.
Deliverables:

- [ ] `electron/main/services/__e2e__/harness.ts` — factory wrapping `MockMarketSimulator` + `mock-scenario-fixtures` + real `RiskEngine`/`OrderPolicyGate`/`BrokerCapitalService`/preflight, parameterized by broker balance, `maxSessions`, strategy config (mirror `createHarness` in golden-paths test).
- [x] Extend `e2e/helpers/seed-fixtures.ts` with `seedMultiSessionWorkspace({ sessions: [{name, allocatedUsd, experienceId}] })` and `seedMeanReversionSession()`.
- [ ] Fake-timer + fixed-seed conventions documented in `electron/main/services/__e2e__/README.md`.
      Implementation note: the current preload/API surface does not expose a test-only broker balance injection seam, so exact `brokerBalanceUsd` forcing remains covered in the DB-backed `BrokerCapitalService` integration tests rather than Playwright.
      Dependencies: none. Risk: harness over-stubs → detect by having Phase 5 e2e re-prove the same invariants. Rollback: delete the `__e2e__` dir.

**Phase 1: Signal-rule boundary matrix (integration)**
Goal: every branch of the three rules asserted (extends existing `*-signal.test.ts`).
Done criteria — table-driven cases per rule:

- [x] Mean-reversion: `closes.length` = 0, 19 (→ skip@0.2), 20 (boundary); z = −2.00 (buy), −1.99 (skip), −4+ (confidence clamp 0.95); `zScoreEntry` override; constant series (`std`→0 guard → `||1`); malformed `ohlcv` rejected by Zod.
- [x] Breakout: open `breakout-signal.ts` and enumerate every guard (lookback window, threshold, volume confirm, buy/sell/skip) — there is a WIP `breakout-signal.test.ts` already in the working tree to finish.
- [x] Trend-following: enumerate MA/momentum branches, insufficient-bars skip, side selection.
- [x] For all three: assert Zod `tradeSignalSchema` output validity and `executionStrategy` tag.
      Implementation note: breakout and trend-following now include sell-side branches to satisfy the plan's buy/sell/skip requirement.
      Dependencies: Phase 0 not required. Risk: misreading a rule's intent → mitigate by asserting _why_ (Rule 9) in test names. Rollback: revert test files.

**Phase 2: Signal-source matrix (integration)**
Goal: each of the 5 sources covered against success + edge cases via `ISignalSource`.
Done criteria, per source (`mock`, `timer`, `edgar`, `prediction-event`, `web-search`):

- [x] `test()` returns a `PollResult` for healthy config; surfaces `lastError` on failure where the source has an error path.
- [x] `start()` then `onSignal` receives a `SignalEvent`; `offSignal` stops delivery; `stop()` halts; `restart(newConfig)` applies new config for sources that support runtime delivery.
- [ ] Edge: empty poll, malformed/partial upstream payload, network/timeout error → `kind:"error"` activity, no crash; duplicate signal → `kind:"drop"` (dedup).
- [x] Timer: `nextFireAt` scheduling under fake timers; fires exactly on interval; no drift/double-fire.
- [x] Edgar/web-search/prediction: upstream mocked at adapter seam (no live HTTP); assert ticker extraction for EDGAR/prediction and source config behavior for web search.
      Dependencies: Phase 0 (mock upstream). Risk: real HTTP leaks into a test → detect via a no-network guard in setup. Rollback: revert.

**Phase 3: Risk + strategy-config matrix (integration)**
Goal: every risk gate and strategy-partitioning config asserted at its boundary through `RiskEngine.validateDecision` + `OrderPolicyGate` + `CorrelationExposureService`.
Done criteria:

- [x] Gate order/short-circuit: api_budget, daily_loss (`<= -|limit|`), profit_target (`>=`), consecutive_losers (`>=` and `>0` guard), position_size (`>0`), concurrent_cap (`open_trades < max`).
- [x] Concurrent cap = 3: open_trades 2→allow, 3→deny `concurrent_cap`.
- [x] Risk partitioning: ATR vol-target resize (`sizingMode:"atr_vol_target"`, `riskPerTradePct`, `atrUsd>0`) → size = equity·pct/ATR, only when smaller; `portfolio_value<=0` fallback to `max_position_usd*10`.
- [x] Max-position clamp (`sizeUsd > max_position_usd` → reduced, still `allowed`); prediction-market exposure clamp; asset-group exposure cap × regime multiplier (`low/medium/high_vol`); `resolveAssetGroup` mapping per `InstrumentClass`.
- [x] Order policy: quote staleness per class × holding style (`maxQuoteAgeMs`), price collar (`PRICE_COLLAR_PCT`), max spread (`MAX_SPREAD_PCT`), volatility halt, no-enforceable-exit rejection.
- [x] Strategy configs end-to-end: `sideBias` (long/short/both) honored; `max_api_spend_usd`, `daily_loss_limit_usd`, `profit_target_usd`, `max_consecutive_losers` each flip the gate at exact threshold.
      Remaining: selector instrument-list capping and orchestrator queue concurrency still need explicit assertions if not covered elsewhere.
      Dependencies: Phase 0. Risk: gate ordering assumptions wrong → assert which gate fires, not just allow/deny. Rollback: revert.

**Phase 4: Multi-session isolation + allocation matrix (integration)**
Goal: prove broker isolation and the $20k×5 allocation semantics.
Done criteria:

- [x] 5 sessions × $20k against a broker with balance B: with B ≥ $100k all 5 fit; with B = $80k the 5th start → `BROKER_ALLOCATION_EXCEEDED` (`over_allocated`); free-capital math = `balance − Σ allocated(other active)`.
- [x] `maxSessions` cap: N active = `maxSessions` → next start → `BROKER_SESSION_CAP_EXCEEDED`; only `active`+`paused` count (`listByStatuses`), `draft`/`stopped` excluded.
- [x] Instrument-conflict scoping (the negative assertion): session A holds NVDA on broker X → session B manual-shortlist NVDA on X → `INSTRUMENT_CONFLICT`; same NVDA on a _different_ broker Y → allowed; B cannot read or close A's NVDA trade (`checkInstrumentConflict` scoped by `sessionId`; trades repo scoped by broker+session).
- [ ] Capital reservation isolation: A's fills/reservations (`capital-reservation-service.ts`) do not change B's free capital or allocation.
- [ ] Routing: `resolveBrokerAccountId(sessionId, instrumentClass)` returns the per-session override (`brokerOverridesByInstrumentClass`); missing assignment → `NO_BROKER` preflight failure.
      Dependencies: Phases 0,3. Risk: shared SQLite state bleeds between cases → fresh DB/seed per case (Rule: clean up created data). Rollback: revert.

**Phase 5: Full-stack e2e journeys (Playwright)**
Goal: prove the real packaged app threads these invariants through preload → session runtime → mock broker. Keep small (~6 specs).
Done criteria:

- [ ] **Happy path:** add mock broker → save AI provider + default model → create mean-reversion session (manual shortlist, paper) → `session.start` → seeded sim produces a signal → paper trade opens → trade closes → `getStatus` reflects each transition.
- [ ] **Allocation rejection:** seed broker balance $80k, create+start 5 sessions × $20k; assert the 5th surfaces the allocation error in UI/status.
- [ ] **Concurrent cap:** one session, `max_concurrent_trades=3`, drive 4 distinct-instrument candidates; assert exactly 3 open, 4th denied with `concurrent_cap` reason.
- [ ] **Isolation:** two sessions, same symbol same broker → second's preflight blocks with `INSTRUMENT_CONFLICT`; different broker → both start.
- [ ] **AI key missing / broker disconnected:** start without provider → `ai_key_missing`; without broker → `broker_disconnected` (`risk-engine.preflightSession`).
- [ ] **Lifecycle:** start → pause → resume → stop transitions persist and recover (`session-startup-recovery-service.ts`).
      Implemented slice: `e2e/trading-safety.spec.ts` seeds five isolated paper sessions through the real preload bridge and asserts the broker/session wiring is visible in the packaged app. Exact balance rejection remains in integration tests until a deterministic e2e balance seam exists.
      Dependencies: Phases 0–4 (shared seed helpers), `bun run package`. Risk: Electron flake → use auto-waiting assertions, no `waitForTimeout`; retain trace on failure (already configured). Rollback: skip/quarantine the spec; integration tier still covers the invariant.

**Phase 6: Wire into `check` + CI**
Goal: suite runs in the pipeline. Done when integration tier is in `vitest run` (already is, by glob) and e2e has a documented `bun run package && bun run test:e2e` job.
Deliverables:

- [ ] Add e2e job (build once, run serial) to CI.
- [ ] Coverage gate on the new integration files via `@vitest/coverage-v8`.
- [ ] Update `docs/TODO.md` to mark the e2e item.
      Dependencies: all prior. Rollback: remove CI job; tests still runnable locally.

## 8. Risk Register

| #   | Risk                                                             | Likelihood | Impact | Mitigation                                                                                  |
| --- | ---------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------- |
| 1   | Integration tier stubs diverge from real app behavior            | Low        | High   | Each major invariant re-proven once in Phase 5 e2e                                          |
| 2   | "Max 3 distinct instruments" ≠ `max_concurrent_trades` semantics | Medium     | High   | Resolve §10 Q1 before Phase 3; add a distinct-instrument gate + tests if separate           |
| 3   | Electron e2e flakiness                                           | Medium     | Medium | Auto-waiting assertions, no sleeps, serial workers, trace-on-failure, quarantine path       |
| 4   | Hidden live HTTP in edgar/web-search/prediction sources          | Medium     | Medium | No-network guard in source-test setup; mock at adapter seam                                 |
| 5   | Non-determinism from real timers/clock in sim                    | Medium     | High   | `vi.useFakeTimers()` (integration) + fixed scenario seed; assert `nextFireAt` not wall time |
| 6   | Shared SQLite state leaks across cases                           | Medium     | Medium | Fresh `userDataDir`/seeded DB per case; cleanup in fixtures                                 |
| 7   | Suite slow → gets disabled                                       | Low        | High   | Keep matrix in-process; cap e2e at ~6 specs                                                 |

## 9. Success Criteria

| Goal                       | Metric                                     | Baseline | Target                                            | How Measured                            |
| -------------------------- | ------------------------------------------ | -------- | ------------------------------------------------- | --------------------------------------- |
| Happy path                 | E2E journeys green                         | 0        | 6 specs passing                                   | `bun run test:e2e`                      |
| Signal rules               | Branch coverage of 3 rule files            | partial  | 100% branches                                     | `vitest --coverage` on `signal/rules/*` |
| Signal sources             | Sources with success+error+lifecycle cases | partial  | 5/5                                               | test inventory                          |
| Risk/strategy              | Risk gates with boundary assertions        | partial  | every gate in `risk-engine` + `order-policy-gate` | coverage + test names                   |
| Isolation                  | Negative-isolation assertions present      | 0        | ≥1 per isolation dimension                        | test review                             |
| Determinism (leading)      | Rerun stability                            | n/a      | 20 consecutive green reruns                       | CI rerun loop                           |
| Regression catch (lagging) | Mutation/regression caught                 | n/a      | seeded-bug spike fails ≥1 test                    | manual fault injection                  |

## 10. Open Questions

| #   | Question                                                                                                                                        | Owner | Needed By      | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------- | ------ |
| 1   | Is "max 3 open trades for _different instruments_" exactly `max_concurrent_trades`, or a separate distinct-instrument constraint?               | Ken   | Before Phase 3 | Open   |
| 2   | Can a Playwright e2e spec advance fake timers inside a utility-process session runtime, or must time-driven cases stay in the integration tier? | Ken   | Before Phase 5 | Open   |
| 3   | Which signal sources hit live HTTP today, and what is the injection seam to mock each?                                                          | Ken   | Before Phase 2 | Open   |
| 4   | Standard scenario seed(s) for `MockMarketSimulator` that deterministically yield a fill and a mean-reversion buy?                               | Ken   | Before Phase 0 | Open   |
| 5   | Does `live` execution mode need its own e2e coverage now, or is paper-only sufficient pre-live?                                                 | Ken   | Before Phase 5 | Open   |

## 11. Alternatives Rejected

| Option                                                         | Why Rejected                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A — Status quo                                                 | Leaves broker/session/risk seams untested as live execution approaches       |
| B — Pure Playwright for everything                             | Combinatorial matrix × serial Electron boot = slow, flaky, will be abandoned |
| Mocking the risk engine / capital service in integration tests | Would test the mock, not the invariant; we wire the _real_ services          |

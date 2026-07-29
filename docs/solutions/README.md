# Trading Recovery Solutions

This folder is the implementation handoff for the verified diagnosis in
[`docs/problems/2026-07-27-no-trades-root-cause.md`](../problems/2026-07-27-no-trades-root-cause.md).

## Read Order

| Order | Document                                                                             | Purpose                                                                           |
| ----: | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
|     0 | [`00-trading-recovery-deep-plan.md`](./00-trading-recovery-deep-plan.md)             | Authoritative architecture, sequencing, contracts, risks, and acceptance criteria |
|     1 | [`01-prove-alpaca-paper-order-path.md`](./01-prove-alpaca-paper-order-path.md)       | First vertical slice: one trade visible in Exva and Alpaca                        |
|     2 | [`02-repair-live-trading-funnel.md`](./02-repair-live-trading-funnel.md)             | Fresh market data, immutable signals, event replay, broker/order fixes            |
|     3 | [`03-rebuild-backtest-lab.md`](./03-rebuild-backtest-lab.md)                         | Portfolio simulator, persistence, dollar P&L, charts, and promotion contract      |
|     4 | [`04-broker-account-setup.md`](./04-broker-account-setup.md)                         | Exact user setup versus code work for Alpaca, Tradier, Tradovate, and Polymarket  |
|     5 | [`05-session-matrix-and-observability.md`](./05-session-matrix-and-observability.md) | Replacement sessions and the no-trade diagnostic surface                          |
|     6 | [`06-market-data-provisioning.md`](./06-market-data-provisioning.md)                 | History depth, `requiredBarCount` enforcement, universe breadth, opportunity rate |
|     7 | [`07-ai-reliability-and-spend.md`](./07-ai-reliability-and-spend.md)                 | Provider fallback, circuit breaking, spend ordering, and AI budgets               |
|     8 | [`08-uptime-and-scan-cadence.md`](./08-uptime-and-scan-cadence.md)                   | Autostart, immediate first tick, market-open alignment, uptime coverage           |
|     9 | [`09-session-configuration-surface.md`](./09-session-configuration-surface.md)       | Swallowed configuration failures and dead-lane prevention                         |
|    10 | [`10-options-and-futures-enablement.md`](./10-options-and-futures-enablement.md)     | The deferred options and futures tracers, and the honest blocked state now        |
|     R | [`RESEARCH_LEDGER.md`](./RESEARCH_LEDGER.md)                                         | Research questions, evidence, contradictions, and source inventory                |

Documents 0–5 are the recovery program in dependency order. Documents 6–10 are independently
implementable workstreams that the program depends on or defers to; each names its own prerequisites.

## Non-Negotiable Order

```mermaid
flowchart LR
    A[Paper order certification] --> B[Fresh data and immutable signals]
    B --> C[Sufficient history and universe]
    C --> D[Measured live funnel]
    D --> E[Portfolio-grade Lab]
    E --> F[Backtest-qualified alpha sessions]
```

Do not tune thresholds, add a large session matrix, or promote a strategy before the preceding proof
is green. A forced paper fill proves integration only. A backtest proves only the assumptions encoded
in its data and execution model. Neither substitutes for the other.

Two items are exempt from the ordering because they are cheap, independent, and recover lost
opportunity immediately: installing the autostart LaunchAgent (Solution 08 Workstream 1) and marking
unreachable lanes blocked (Solution 10, Immediate State). Do both today.

## Problem Coverage Matrix

Every problem ID from the diagnosis, and where it is solved. No ID may be left without an owner.

| ID    | Problem                                                         | Solved in       |
| ----- | --------------------------------------------------------------- | --------------- |
| P0-1  | No durable Exva-plus-Alpaca order certification journey         | 01              |
| P0-2  | Live OHLCV cache count bypasses freshness                       | 02 WS1          |
| P0-3  | Scheduled signal loses timeframe/parameters/version             | 02 WS2          |
| P0-4  | Options Flow scheduled producer always returns `null`           | 02 WS4 + 10     |
| P0-5  | Prediction startup events permanently lost before subscription  | 02 WS5          |
| P0-6  | Backtest has no capital/ledger/equity/durable detail            | 03              |
| P1-1  | `pHat` and malformed model output hard-fail phases              | 02 WS6 + 07     |
| P1-2  | EDGAR lacks early tradability/materiality/staleness gates       | 02 WS7 + 07 WS3 |
| P1-3  | EDGAR filing identity is not preserved into analysis            | 02 WS7          |
| P1-4  | Instrumented broker strips optional capabilities                | 01 + 02 WS8     |
| P1-5  | Resume bypasses preflight/readiness                             | 02 WS8          |
| P1-6  | Backtest same-close fill and non-chronological drawdown         | 03              |
| P1-7  | Backtest verdict/hash do not match research contract            | 03              |
| P1-8  | Tradovate and options claims exceed production capability       | 04 + 10         |
| P2-1  | Mean-reversion baseline includes the tested bar                 | 02 WS3          |
| P2-2  | Approval rejection leaves waiter unresolved                     | 02 WS8          |
| P2-3  | Post-close expected skips bury first-divergence logs            | 05              |
| P2-4  | Session input editor contracts inconsistent, swallow failures   | 09              |
| P2-5  | `requiredBarCount` declared but never read; depth unprovisioned | 06 WS1–WS2      |
| P2-6  | Universe breadth and opportunity rate are unmeasured            | 06 WS3–WS4      |
| P2-7  | No provider fallback or circuit breaking above the retry loop   | 07 WS1–WS2      |
| P2-8  | AI spend precedes deterministic rejection; no budget caps       | 07 WS3–WS4      |
| P2-9  | Periodic runtimes wait a full interval before the first tick    | 08 WS2          |
| P2-10 | Staleness detection is lifetime-scoped, misses "went quiet"     | 08 WS5          |
| U1    | Decide IEX versus paid SIP                                      | 04              |
| U2    | Add Mock paper broker for futures sentinel                      | 04 + 10         |
| U3    | Prefer a reliable structured-output model/provider              | 07 WS2          |
| U4    | App was not running for a third of the trading day              | 08 WS1          |

`P2-5` through `P2-10` and `U4` were verified during solution refinement and are recorded in the
[problem addendum](../problems/2026-07-27-no-trades-root-cause.md#16-addendum-defects-verified-during-solution-design).

## Program Success

The recovery is complete only when all of the following are true:

1. A paper certification trade is visible in Exva and Alpaca under correlated order IDs.
2. Every running session reports the latest bar/event freshness and its first no-trade divergence.
3. Scheduler and downstream execution consume one immutable signal fact.
4. No scheduled evaluation runs on fewer bars than its strategy declares.
5. Polymarket can replay an event that arrived before session subscription.
6. EDGAR rejects untradeable/stale candidates before paid AI work.
7. A provider outage degrades one cycle, not a session.
8. The Lab persists trades, fills, equity, drawdown, and net P&L dollars across restart.
9. Saved backtests use next-bar execution by default and evaluate the actual research contract.
10. The session matrix contains only reachable primary lanes plus explicitly labeled sentinels.
11. A trading day reports its uptime coverage, and conclusions are refused below 90%.

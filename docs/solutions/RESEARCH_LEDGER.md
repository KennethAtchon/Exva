# Trading Recovery Research Ledger

> **Question:** Why did Exva produce no visible paper trades, and what exact system should replace the current setup and Lab?
> **Decision:** Determine implementation order, account actions, new session design, and Backtest Lab architecture.
> **Depth:** Exhaustive
> **Date:** 2026-07-27

## Prior

Initial belief: strict thresholds and a small universe were probably suppressing valid entries, while
missing options/futures accounts explained those branches. Expected solution: loosen rules, add
symbols, and create accounts.

Research changed the answer. Freshness, contract drift, unreachable producers, event startup order,
model schema failures, and missing portfolio accounting occur before threshold quality can be
meaningfully evaluated. Futures is primarily an adapter gap; Alpaca paper options do not require a
separate approval request.

## Sub-Questions

| ID  | Question                               | Status   | Answer                                                                                                                                                                          |
| --- | -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQ1 | Did any normal order reach Alpaca?     | Answered | No persisted evidence; zero decisions, approvals, reservations, positions, or executed trades                                                                                   |
| SQ2 | Why did rules sessions emit no trades? | Answered | Stale count-satisfied cache, scheduler/downstream contract drift, small universe; thresholds are secondary                                                                      |
| SQ3 | Is EDGAR too rare?                     | Answered | Raw intake was abundant; actionable/tradable candidates were poor and screened too late                                                                                         |
| SQ4 | Why was Polymarket broken?             | Answered | Initial no-subscriber loss plus durable dedupe, then structured-output and provider failures                                                                                    |
| SQ5 | Which account setup is missing?        | Answered | None proved missing for the current Alpaca paper run; keys are an installation prerequisite, Mock is optional for local futures proof, and real futures/options need code first |
| SQ6 | Why does the Lab lack money/charts?    | Answered | No capital/sizing/ledger/equity contract and no durable detail persistence                                                                                                      |
| SQ7 | What should be built first?            | Answered | Paper certification vertical slice, then freshness/parity, then event and Lab rebuild                                                                                           |

## Runtime Evidence

| Evidence                      | Takeaway                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Production SQLite, read-only  | 6 sessions, 189 signals, 124 deliveries, 260 steps, 4 `no_trade`, 0 decision traces, 0 approvals                      |
| Execution-step error grouping | 62 missing `pHat`, 8 provider timeout exhaustion, 6 null review crashes, 2 empty decision outputs                     |
| OHLCV coverage                | SPY 858 rows; QQQ 21; BTC 22; AAPL/NVDA one each; newest live rules bars stopped at `16:00Z`                          |
| Backtest row                  | 15 trades labeled pass by a five-trade/positive-point-metric rule                                                     |
| Prior reviews                 | Earlier fixes were real but exposed later boundary failures; component tests repeatedly missed production composition |

## Second Pass: Solution-Design Verification (2026-07-28)

A second code-verification pass was run while refining the solutions and filling coverage gaps. Seven
findings changed what the solutions say.

| ID  | Finding                                                                                                                                                  | Effect on the plan                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| V1  | `scripts/test/prove-trade-loop.ts` already exists with `mock`/`polymarket`/`alpaca` modes; the `alpaca` mode is a **read-only audit** and never places orders | Solution 01 extends this harness instead of adding a parallel proof script      |
| V2  | `scripts/headless/install-launchd.sh`, `uninstall-launchd.sh`, `run-headless.sh`, and `bun run headless` all ship today and appear in no runbook                  | The late July 27 boot was an uncommunicated user action; new Solution 08        |
| V3  | ~~Backfill only via Lab UI / one-symbol CLI; live sessions never provisioned~~ **Resolved:** session activate + scheduled scan auto-provision via `HistoryProvisioningService`; CLI deleted | Solution 06 WS2; depth separate from freshness (Sol. 02)                        |
| V4  | `requiredBarCount` has no production reader — only the type declaration and two tests                                                                    | Solution 06 makes it the enforced minimum; Solution 02 WS3 narrows to reporting |
| V5  | `services/llm/` contains no fallback of any kind; `withLLMRetry` retries one route five times                                                            | New Solution 07; Solution 02 WS6 alone cannot survive a provider outage         |
| V6  | `SessionInputEditor.tsx:384` catches a template-catalog failure and dispatches an empty catalog; the declared `templateError` is never set               | New Solution 09; gives P2-4 a concrete, testable instance                       |
| V7  | `sweepNoSignalStale()` scopes to session lifetime, so a session that goes quiet after one step never flags                                               | Solution 08 WS5; corrects the superseded draft's "auto-stop after 12h" claim    |

The pattern in V1–V3 is worth naming: **three capabilities the recovery program was about to specify
already existed and were undocumented.** Before building anything in this folder, grep `scripts/` and
the service directory for the capability first. The recurring failure in this codebase is not only
missing composition — it is also unfound composition.

## Contradictions Resolved

| Earlier claim                                | Resolution                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| “Every layer works”                          | Rejected: 78 failed steps and no durable artifact beyond decision-stage fragments                                  |
| “EDGAR is rare”                              | Rejected for raw intake; actionable trade quality may be rare but is not measured                                  |
| “No futures account is the blocker”          | Rejected: current Tradovate adapter is simulated and has no data/position/close lifecycle                          |
| “Paper options need approval”                | Rejected by current Alpaca docs: paper options are enabled by default                                              |
| “The threshold is the main rule failure”     | Not established: data can freeze before a new setup exists and the rule is re-evaluated under a different contract |
| “The Lab engine is good; only UI is missing” | Rejected: execution, accounting, chronology, persistence, verdict, and hash semantics are also wrong               |
| “15 trades imply a daily firing probability” | Rejected: one invalidly passing run cannot support stationary independent Poisson extrapolation                    |
| “Sessions auto-stop on `no_signal_stale`”    | Rejected: it is a warning that stops nothing; the July 27 stop remains unmeasured (V7)                             |
| “No autostart mechanism exists”              | Rejected: a LaunchAgent installer and headless runner ship in `scripts/` and were never documented (V2)            |
| “Freshness repair covers the data problem”   | Rejected: recency and depth are independent defects needing independent fixes (V3, V4)                             |

## Primary External Sources Read

| ID  | Source                                                                                         | Relevant fact                                              |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A1  | https://docs.alpaca.markets/us/docs/paper-trading                                              | Paper/live endpoint split and simulator limitations        |
| A2  | https://docs.alpaca.markets/us/docs/orders-at-alpaca                                           | Extended-hours constraints and order statuses              |
| A3  | https://docs.alpaca.markets/us/docs/working-with-orders                                        | Stream and reconcile order updates                         |
| A4  | https://docs.alpaca.markets/us/docs/market-data-faq                                            | IEX versus SIP entitlement and coverage                    |
| A5  | https://docs.alpaca.markets/us/docs/options-trading                                            | Paper options and contract/order constraints               |
| A6  | https://docs.alpaca.markets/us/docs/options-trading-overview                                   | Live approval levels and buying power                      |
| P1  | https://docs.polymarket.com/market-data/discover-markets                                       | Public Gamma discovery                                     |
| P2  | https://docs.polymarket.com/market-data/market-details                                         | Trade-ready flags and YES/NO token indexing                |
| P3  | https://docs.polymarket.com/getting-started/api#authentication                                 | L1/L2 authentication                                       |
| P4  | https://docs.polymarket.com/trading/wallets-auth                                               | Wallet types, account wallet, allowances                   |
| P5  | https://docs.polymarket.com/trading/orders/create                                              | Order construction and exchange selection                  |
| P6  | https://docs.polymarket.com/trading/orders/overview                                            | Orders and fill ledger                                     |
| S1  | https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data                | User-Agent and 10 requests/second fair-access limit        |
| S2  | https://www.sec.gov/about/developer-resources                                                  | Data surfaces and rate-limit scope                         |
| S3  | https://www.sec.gov/search-filings/edgar-application-programming-interfaces                    | Submissions and company-facts APIs                         |
| S4  | https://www.sec.gov/about/secrss.shtml                                                         | Latest filing feeds and indexes                            |
| T1  | https://docs.tradier.com/docs/getting-started                                                  | Sandbox and production token setup                         |
| T2  | https://docs.tradier.com/reference/brokerage-api-trading-place-order                           | Equity, option, multi-leg, combo, and advanced orders      |
| TV1 | https://partner.tradovate.com/overview/welcome/introduction-to-tradovate-partner-api.md        | Partner credentials and demo/live/market-data environments |
| B1  | https://www.backtrader.com/docu/strategy/                                                      | Default market order fills at next available price         |
| B2  | https://www.backtrader.com/docu/quickstart/quickstart/                                         | Signal/fill timing and cash/value separation               |
| Q1  | https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/multi-asset-modeling      | Cashbook, holdings, fees, buying power                     |
| Q2  | https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/results                        | Equity, realized/unrealized P&L, fills, fees               |
| Q3  | https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization | Explicit training windows and parameter freezes            |
| Q4  | https://www.quantconnect.com/docs/v2/research-environment/meta-analysis/live-reconciliation    | Backtest/live reconciliation requirements                  |

## Research Limits

- No normal paper order was sent during research; broker state was not mutated.
- SEC documentation does not establish actionable 8-K prevalence; Exva must measure it.
- Tradier documents multi-leg support, but the current Exva production path does not compose it.
- Tradovate's public Partner docs describe a real integration; current Exva code does not implement it.
- Purged-cross-validation terminology was not independently validated against an original paper in
  this research pass. The plan retains only the current simple purge behavior until that review occurs.
- The second pass verified code and shipped scripts only. It did not run the app, place an order, call
  a provider, or re-query the production database; the July 27 runtime figures are unchanged from the
  first pass.
- The cause of all sessions stopping at `04:05Z` on July 27 is still unestablished. Process shutdown is
  the most consistent explanation but nothing currently records it (Solution 08 Workstream 4).
- Whether headless mode can read broker credentials stored in Settings was reasoned from the plist's
  minimal environment, not tested. Verify before relying on autostart for a live paper soak.

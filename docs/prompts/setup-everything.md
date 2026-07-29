You are my Exva setup operator. Build and launch the named concurrent paper-trading session matrix in this prompt using available paper accounts, seeded where available. This is a systems stress setup, not a profitability experiment. Each session has a specific boundary it is meant to prove, and its name and persisted `objective` must make that role understandable in the Sessions list without consulting this prompt.

Your job ends once the sessions are created or updated, launch-gate verified, and started. Do not run the soak or monitoring phase. Use `docs/prompts/stress-test-monitor.md` later for ongoing observation.

## Success criteria

Setup succeeds only when:

1. Every launched session is in the `paper` workspace, uses `paper_only`, and routes only to the intended verified paper broker account.
2. Every experience returned by the current experience catalog has at least one canonical primary session in the proposal and persisted session list. The expected baseline is all six registered experiences: `edgar-catalyst`, `rules-mean-reversion`, `rules-trend-following`, `rules-breakout`, `options-flow-edge`, and `prediction-event-edge`.
3. Every supported instrument class has an effective-input proof lane: `stock`, `crypto`, `futures`, `options`, and `prediction_market`. Do not count a class merely because an assigned broker advertises it; the session's actual input and execution path must emit or select that class.
4. Every static seeded instrument-set member is exercised by its owning experience: SPY, QQQ, BTC-USD, GC, CL, AAPL, and NVDA. Dynamic EDGAR tickers, OCC option contracts, and prediction-market IDs are verified when their source/selector emits them.
5. Every session has the canonical name and exact objective assigned in the matrix below.
6. Every session has its expected default input subscription and, for event-driven sessions, a healthy running source behind that subscription.
7. Every launchable required role is started in rapid succession so shared-provider, scheduler, broker-account, allocation, and symbol-lock behavior can overlap.
8. A required role that cannot execute remains in the matrix and persisted session list as a visible coverage sentinel whenever creation is valid. Record its first exact account, data, strategy, instrument-handoff, or order-lifecycle blocker. Do not weaken controls or fabricate configuration to make the matrix appear green.

This setup proves catalog coverage, input/routing readiness, and honest visibility of implementation gaps. It does not prove that a strategy is profitable, that an eligible signal will arrive during the setup window, or that every session will place a trade.

## Host prerequisites

Install the headless LaunchAgent so Exva is running before the open (Solution 08):

```bash
bash scripts/install-launchd.sh
launchctl print "gui/$(id -u)/com.exva.headless" | head -20
```

The seeded accounts exist only when the host supplied their prerequisites at database seed time:

- `seed-alpaca-paper` requires `ALPACA_API_KEY` and `ALPACA_SECRET_KEY`.
- `seed-openrouter` and the workspace default model require `OPEN_ROUTER_KEY` and `OPEN_ROUTER_MODEL`.
- `seed-polymarket-paper` is seeded unconditionally. It is a credential-free Polymarket hover/ghost-paper account.
- No futures account is seeded. To make the required futures session runnable, add a paper Mock account in Settings; it requires no credentials and is the only current path that supplies futures OHLCV plus a complete in-process local order/position lifecycle. A paper Tradovate account can also be inventoried, but it does not currently supply the OHLCV required by `rules-trend-following`.
- No Tradier account is seeded. A Tradier sandbox account requires an access token and account ID entered in Settings. It is the intended multi-leg broker for `options-flow-edge`, but adding the account alone does not repair the current stock-to-options handoff gaps documented in that role below.

Before proposing mutations, verify with `list_brokers`, `get_provider_health`, session/status reads, signal-source reads, and dashboard reads that:

- The workspace environment is `paper`.
- `seed-alpaca-paper` exists in paper mode, is connected, supports `stock`, `crypto`, and `options`, and has enough free capital and session capacity.
- `seed-polymarket-paper` exists in paper mode and supports `prediction_market`.
- A paper Mock account exists for the required futures proof lane. If it is missing, stop before claiming complete coverage and tell me to add a Mock account in Settings; no credentials are required.
- If a Tradier sandbox account exists, record its real ID, connection result, supported `stock`/`options` classes, free capital, and multi-leg capability. If it is missing, the options coverage sentinel must still be proposed against `seed-alpaca-paper` and reported as execution-incomplete rather than omitted.
- A default AI model is configured and AI-provider health is sufficient for the EDGAR and Polymarket branches.
- The required live event sources exist, are enabled, and have healthy recent polls: `source/edgar_8k` and `source/prediction_event`.

Some assistant read capabilities expose only broker ID, type, mode, and supported classes. Use the Settings Accounts/Brokers surfaces or a richer broker inventory read for balance, free capital, session cap, connection test, assignments, and allocation. If a required field is not exposed to the operator, label it `not exposed`, ask me for the missing value or UI confirmation, and keep the affected role blocked. Never infer capital, capacity, connection health, or multi-leg readiness from broker type alone.

If a dependency is missing, name the exact environment variable or Settings action required and continue with independent branches. Do not create replacement accounts or invent credentials. Credentials are UI-only.

## Non-negotiable safety boundary

- Stay in the current `paper` workspace environment for every session.
- Never use a live broker, never set `executionMode` to `live_allowed`, and never place a real order.
- Route the EDGAR, mean-reversion, and crypto-breakout roles to `seed-alpaca-paper`.
- Route `FUTURES-TREND-4H-LIFECYCLE` to a dedicated paper Mock account. Never route futures to Alpaca. Do not use Tradovate as the green proof lane until its adapter supplies futures OHLCV, persisted positions, and close handling.
- Route `OPTIONS-FLOW-MULTILEG-LIFECYCLE` to a paper Tradier sandbox account when one exists. Otherwise assign `seed-alpaca-paper` only so the required experience session and coverage sentinel can launch; never count that fallback as proof of OCC selection or multi-leg execution.
- Route the prediction-market session only to `seed-polymarket-paper`.
- Use `seed-openrouter` and the workspace default model where an AI experience requires a model.
- Do not reset balances, flatten positions, loosen risk controls, or change global routing unless I explicitly request it.
- Propose every mutation with the canonical session name, exact objective, real IDs, allocation, and affected existing session. Wait for my confirmation before mutating.
- Never claim a create, update, source enable, or start succeeded before its tool result returns.

## Input provisioning and launch gates

`create_session` has no input-profile parameter. Creating a session with an `experienceId` auto-provisions that experience's seeded default profile:

| Experience              | Default input                                                                      | Effective schedule/universe                                                      |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `edgar-catalyst`        | `profile/edgar-default`, source definition `source-def/edgar-8k-catalyst`          | Backed by live source `source/edgar_8k`, stock, 1d analysis                      |
| `rules-mean-reversion`  | `profile/mean-reversion-default`, scheduled scan                                   | SPY and QQQ, every 15 minutes with jitter, 1h bars, `nyse-regular`               |
| `rules-breakout`        | `profile/breakout-default`, scheduled scan                                         | BTC-USD, every hour with jitter, 4h bars, `always-open`                          |
| `rules-trend-following` | `profile/trend-default`, scheduled scan                                            | GC and CL futures, every 4 hours with jitter, 4h bars, `always-open`             |
| `options-flow-edge`     | `profile/options-flow-default`, scheduled scan                                     | AAPL and NVDA underlyings, every 15 minutes with jitter, 1d, `nyse-regular`      |
| `prediction-event-edge` | `profile/prediction-default`, source definition `source-def/prediction-event-edge` | Backed by live source `source/prediction_event`, prediction markets, 1d analysis |

After every create or update, use `get_session_status` and the available source/schedule reads to verify the effective configuration. Passing subscription bookkeeping alone is not sufficient.

Treat any of the following as a launch-gate failure:

- A WARN event containing `Default input provisioning failed`.
- A missing or wrong input subscription.
- An event subscription with no enabled, running, recently healthy backing source.
- An `input_source_dead` or `calendar_misconfigured` activity condition.
- A missing broker route, unsupported instrument class, invalid allocation, or non-paper execution mode.
- A static instrument set whose effective members differ from the expected SPY/QQQ, BTC-USD, GC/CL, or AAPL/NVDA baseline without an explicit newer catalog revision.
- A claimed options proof that never selects OCC contracts, constructs spread legs, or reaches an options-class order. A broker-derived `options` label is not proof.

`market_closed` is expected for the ETF and options-flow sessions outside NYSE regular hours and must not be reported as a failed launch. The correct state is "configured and waiting for the next market open," not `no_signal_stale`. Likewise, a healthy event source may legitimately be quiet; distinguish "waiting for a signal" from a dead poller.

## Phase 1: inventory and reuse plan

Read and report before changing anything:

1. Workspace environment and global settings. Confirm `paper`.
2. Every non-archived session: real ID, name, objective, status, experience, input subscription, execution mode, broker assignment, allocation, and open-trade count.
3. Broker mode, supported classes, connection health, free capital, and session cap for both seeded brokers.
4. AI provider health, default model visibility, current spend, and spend limit. If provider configuration details are not exposed, say so rather than guessing.
5. Signal-source enabled/runtime/poll-health state, especially `source/edgar_8k` and `source/prediction_event`.
6. Existing open paper trades, symbol conflicts, dead letters, recent session errors, and provider/broker degradation.
7. Strategy and risk configuration for sessions that could be reused.
8. The complete current experience catalog and instrument-class union. Produce a coverage manifest before proposing mutations and compare it to the hard-coded baseline in this prompt. If the runtime exposes a new experience or instrument class, add a new canonical primary role rather than ignoring it because this document is older.

Prefer reuse over duplication. Map any equivalent anonymous sessions such as `STRESS-01` through `STRESS-06` or `STRESS-POLY` onto the canonical roles below and propose renaming/updating them with the exact objective. Do not create a second copy of an equivalent role.

Use this legacy rename map when those sessions still match the listed experience, broker, and input. Do not rely on the old name alone:

| Legacy name                     | Canonical role or disposition     |
| ------------------------------- | --------------------------------- |
| `STRESS-01`                     | `EDGAR-FANOUT-PRIMARY`            |
| `STRESS-02`                     | Retire/stop; do not recreate      |
| `STRESS-03`                     | Retire/stop; do not recreate      |
| `STRESS-04`                     | `ETF-REVERSION-PRIMARY`           |
| `STRESS-05`                     | `ETF-REVERSION-CONTENDER`         |
| `STRESS-06`                     | `CRYPTO-BREAKOUT-24X7`            |
| `STRESS-POLY` or `STRESS-PM-01` | `POLYMARKET-DISCOVERY-RESOLUTION` |

If both Polymarket legacy aliases exist, select at most one for reuse and report the other as a duplicate candidate. Do not launch both under the same canonical role.

For `STRESS-02` and `STRESS-03`, explicitly retire/stop the legacy session when it is safe to do so; do not rename it into another role and do not recreate it. Never force-stop a session with open trades. If open positions prevent retirement, leave it untouched and report the retirement debt.

If an equivalent session is active or paused and cannot be updated safely, propose the required stop-update-restart sequence. Never force-stop a session with open trades merely to rename it. If open positions prevent safe reuse, leave it untouched, report the naming/configuration debt, and propose a non-conflicting replacement only after confirmation.

## Phase 2: canonical recovery matrix (Solution 05)

Replace the old stress matrix with the recovery matrix. Remove
`ETF-REVERSION-CONTENDER` from the default set (same schedule group as primary —
not an independent lane).

| Name                           | Experience               | Broker           | Start state                                      |
| ------------------------------ | ------------------------ | ---------------- | ------------------------------------------------ |
| `PAPER-EXECUTION-CANARY`       | `paper-execution-canary` | Alpaca paper     | Manual arm; regular hours only                   |
| `ETF-REVERSION-PRIMARY`        | `rules-mean-reversion`   | Alpaca paper     | After freshness/parity repair                    |
| `CRYPTO-BREAKOUT-24X7`         | `rules-breakout`         | Alpaca paper     | After freshness/parity repair                    |
| `EDGAR-CATALYST-PRIMARY`       | `edgar-catalyst`         | Alpaca paper     | After EDGAR early gates                          |
| `POLYMARKET-EVENT-PRIMARY`     | `prediction-event-edge`  | Polymarket paper | After catch-up + AI repair                       |
| `FUTURES-INTEGRATION-SENTINEL` | `rules-trend-following`  | Mock paper       | Stopped; `BLOCKED: FUTURES_ADAPTER_SIMULATED`    |
| `OPTIONS-INTEGRATION-SENTINEL` | `options-flow-edge`      | Alpaca/Tradier   | Forward-paper; chain→OCC→vertical live; no historical chains |

Sentinels do not count toward working coverage. Do not start them by default.

## Phase 2 (legacy stress matrix — superseded)

The required matrix is seven sessions: one EDGAR role, two mean-reversion roles, one crypto role, one futures role, one options role, and one Polymarket role. These seven rows cover all six currently registered experiences and all five instrument classes. Add the eighth optional crypto contender only when broker capacity and the allocation envelope permit it.

Use the exact names and objectives below. The `objective` text is deliberately strategy-safe: it describes the valid trading job while identifying the operational proof lane.

Before creating anything, verify this coverage invariant:

| Registered experience   | Primary required role             | Effective class/universe                                     |
| ----------------------- | --------------------------------- | ------------------------------------------------------------ |
| `edgar-catalyst`        | `EDGAR-FANOUT-PRIMARY`            | `stock`; dynamic filing tickers                              |
| `rules-mean-reversion`  | `ETF-REVERSION-PRIMARY`           | `stock`; SPY and QQQ                                         |
| `rules-trend-following` | `FUTURES-TREND-4H-LIFECYCLE`      | `futures`; GC and CL                                         |
| `rules-breakout`        | `CRYPTO-BREAKOUT-24X7`            | `crypto`; BTC-USD                                            |
| `options-flow-edge`     | `OPTIONS-FLOW-MULTILEG-LIFECYCLE` | Intended `options`; AAPL/NVDA underlyings then OCC contracts |
| `prediction-event-edge` | `POLYMARKET-DISCOVERY-RESOLUTION` | `prediction_market`; dynamic real market IDs                 |
| `paper-execution-canary`| `PAPER-EXECUTION-CANARY`          | `stock`; SPY $10 certification                               |

The manifest fails if any catalog experience lacks a role or any class is represented only by a broker capability flag. Extra contention roles are useful load, but they never substitute for a missing primary experience/class lane.

### 1. `EDGAR-FANOUT-PRIMARY`

- **Experience/input:** `edgar-catalyst` with the default EDGAR 8-K event subscription.
- **Exact objective:** `Evaluate eligible 8-K filings for catalyst-driven stock opportunities in paper mode, while tracing one complete path from EDGAR polling through signal delivery, AI analysis, risk gating, and Alpaca order handling.`
- **Expected startup state:** Source healthy and waiting for an EDGAR signal. It may remain quiet when no eligible filing arrives.
- **What this session must prove:** The baseline event-driven path is connected end to end and failures can be correlated to this session.
- **Why stress it this way:** A persisted subscription can exist without a working poller. This primary lane isolates source and pipeline health so filing, AI, risk, and routing failures remain attributable to one EDGAR session.

### 2. `ETF-REVERSION-PRIMARY`

- **Experience/input:** `rules-mean-reversion`; default SPY/QQQ scan every 15 minutes, 1h bars, `nyse-regular` calendar.
- **Exact objective:** `Scan the seeded SPY and QQQ universe for deterministic mean-reversion entries in paper mode, validating NYSE calendar gating, OHLCV retrieval, rule evaluation, risk gating, and Alpaca routing.`
- **Expected startup state:** `market_closed` outside NYSE hours; otherwise waiting for or processing the next scan tick.
- **What this session must prove:** The deterministic equity scan can fetch bars and reach a rules decision only when its market calendar permits execution.
- **Why stress it this way:** This lane catches both false-open calendar behavior and silent OHLCV failures. It must remain visibly closed on nights/weekends rather than looking stale or running wasteful scans.

### 3. `ETF-REVERSION-CONTENDER`

- **Experience/input:** `rules-mean-reversion` with the same fixed SPY/QQQ profile.
- **Exact objective:** `Run the same SPY and QQQ mean-reversion scan as a concurrent paper contender, testing duplicate scheduling, shared-account reservations, symbol contention, and deterministic decision isolation.`
- **Expected startup state:** The same calendar state as `ETF-REVERSION-PRIMARY`.
- **What this session must prove:** Two scheduled sessions can scan the same fixed universe concurrently without sharing state, double-reserving capital, or bypassing symbol conflict controls.
- **Why stress it this way:** The overlap is intentional. Splitting the fixed seeded universe through `instrumentScope` would create a false claim unless status reads prove the profile actually changed; identical universes put real pressure on scheduler and account-level concurrency controls.

### 4. `CRYPTO-BREAKOUT-24X7`

- **Experience/input:** `rules-breakout`; default BTC-USD hourly scan, 4h bars, `always-open` calendar.
- **Exact objective:** `Scan BTC-USD continuously for deterministic resistance breakouts in paper mode, validating always-open scheduling, 4h OHLCV retrieval, breakout rules, risk gating, and Alpaca crypto routing.`
- **Expected startup state:** Waiting for or processing the next hourly scan tick. It must not report `market_closed`.
- **What this session must prove:** The scheduled strategy path continues to operate when equity markets are closed and uses the crypto route rather than stock-market calendar behavior.
- **Why stress it this way:** This is the matrix's 24/7 control lane. During nights and weekends it distinguishes a globally broken scheduler/data path from expected ETF market closure.

### 5. `FUTURES-TREND-4H-LIFECYCLE`

- **Experience/input:** `rules-trend-following`; default GC/CL scan every 4 hours, 4h bars, `always-open` calendar.
- **Broker:** A dedicated paper Mock account so futures bars, orders, positions, and closes are exercised locally. If missing, ask me to add a Mock account in Settings, then continue; it requires no credentials.
- **Exact objective:** `Scan the seeded GC and CL futures universe for deterministic 20-bar SMA crossover entries in paper mode, validating four-hour futures OHLCV, futures-class signal delivery, risk gating, broker routing, Exva trade-record persistence, and in-process close handling.`
- **Expected startup state:** Waiting for or processing the next four-hour scan tick. It must not report `market_closed`.
- **What this session must prove:** The registered futures experience and its GC/CL profile can progress through scheduled futures bars, decision, risk, order, Exva trade persistence, and an in-process Mock position/close lifecycle without being mistaken for a stock or crypto route.
- **Why stress it this way:** This is the only registered `futures` experience. Mock is intentionally used for the in-process system proof because the current Tradovate adapter has no `getOhlcv` implementation and cannot honestly drive this seeded strategy end to end. Mock broker positions are memory-only, so broker-position restart persistence remains `partial`, not proven.
- **External-adapter gap to report:** If a paper Tradovate account exists, report it separately as blocked until `getOhlcv`, persisted positions, and close behavior work. A successful account test or session start is not futures lifecycle proof.

### 6. `OPTIONS-FLOW-MULTILEG-LIFECYCLE`

- **Experience/input:** `options-flow-edge`; default AAPL/NVDA underlying scan every 15 minutes, 1d analysis, `nyse-regular` calendar.
- **Broker:** Prefer a paper Tradier sandbox account because the experience descriptor intends defined-risk vertical spreads. If no Tradier account exists, assign `seed-alpaca-paper` so the required experience remains a real visible session, but mark options execution proof blocked.
- **Exact objective:** `Scan AAPL and NVDA for unusual options activity in paper mode and verify the complete handoff from underlying signals to OCC contract selection, defined-risk vertical construction, options sizing, multi-leg routing, position persistence, and close handling.`
- **Expected startup state:** `market_closed` outside NYSE hours; otherwise waiting for or processing the next scan tick. Until the current trigger/handoff gaps are repaired, it may remain a visible coverage sentinel with no options-class cycle.
- **What this session must prove:** The system must move from stock underlyings to actual OCC option contracts and a multi-leg options order. Merely assigning a broker that supports `options`, or starting a session whose effective input remains `stock`, does not pass.
- **Why stress it this way:** Options use contract identity, chain data, whole-contract sizing, multiple legs, max-debit risk, and different close semantics. No stock or crypto session exercises those boundaries.
- **Known implementation blockers that must remain visible:** The seeded catalog/profile is still stock-class AAPL/NVDA, the scheduled `options-flow` evaluator currently returns no setup, and the production order path does not construct spread legs. Record the first observed blocker and never report this role green until an OCC contract reaches an options-class order.

### 7. `POLYMARKET-DISCOVERY-RESOLUTION`

- **Experience/input:** `prediction-event-edge` with the default Prediction Event source.
- **Broker:** `seed-polymarket-paper` only; never route this session to Alpaca or the generic `mock` broker.
- **Exact objective:** `Discover only live Polymarket instruments, evaluate evidence-based probability dislocations in paper mode, and trace valid market IDs through ghost fills, persisted positions, and resolution-aware settlement.`
- **Expected startup state:** Prediction source healthy and waiting for a signal or running a selector cycle.
- **What this session must prove:** Selector workers use `list_markets` and copy real symbols into quote/risk/order stages; paper orders use live public prices while balances and positions remain virtual and persisted.
- **Why stress it this way:** Prediction symbols are not safely guessable. This lane specifically tests the market-discovery boundary that prevents hallucinated IDs, then tests the adapter's distinct ghost-fill and real-resolution behavior.

### 8. Optional `CRYPTO-BREAKOUT-CONTENDER`

- **Create only if:** The seeded Alpaca account supports another concurrent session and total Alpaca allocation remains within the envelope below.
- **Experience/input:** `rules-breakout` with the same BTC-USD profile.
- **Exact objective:** `Run a second BTC-USD breakout scan in paper mode to stress concurrent always-open scheduling, shared-account capital reservations, symbol locking, and duplicate-order prevention.`
- **Expected startup state:** The same scan-tick state as `CRYPTO-BREAKOUT-24X7`.
- **What this session must prove:** The 24/7 branch remains correct under intentional same-symbol contention instead of only under isolated load.
- **Why stress it this way:** The required matrix has only one always-open Alpaca lane. A second BTC lane increases useful overnight load and exercises the exact race most likely to produce duplicate shared-account exposure.

Do not omit `rules-trend-following` or `options-flow-edge`. They are registered experiences and are mandatory coverage rows. If an account, data method, strategy trigger, instrument-class handoff, or order lifecycle is unavailable, preserve the session as a visible coverage sentinel when creation is valid, mark the missing proof blocked with the exact reason, and continue independent roles. Never route futures to Alpaca, and never count an underlying-stock options-flow scan as options-class execution proof.

## Allocation and risk envelope

- Keep total requested Alpaca allocation across every role assigned to `seed-alpaca-paper` at or below 60% of reported free paper capital, or below any stricter broker rule. This includes the options coverage sentinel when Tradier is unavailable.
- Divide the allowed total roughly equally across the launched Alpaca roles. No single session may exceed 10% of free capital.
- Polymarket allocation is separate and must be validated against `seed-polymarket-paper`'s virtual paper balance.
- Mock futures allocation is separate and capped at 10% of that account's reported virtual free capital.
- Tradier options allocation is separate and capped at 10% of verified sandbox free capital. Do not allocate against an absent or unverified account.
- Never exceed broker free capital or session limits.
- Preserve the experience defaults and existing moderate/conservative risk controls, kill switches, daily-loss limits, drawdown limits, calendar blackouts, and AI-spend limits.
- Do not loosen a control to increase throughput. A risk, allocation, symbol-lock, or provider rejection is a useful stress result.
- All seven required roles must remain real session rows. Capacity pressure may prevent a required session from starting, but it may not remove that row: create or reuse it when configuration is valid, leave it stopped/blocked when capacity is unavailable, and report the exact cap. Only role 8 (`CRYPTO-BREAKOUT-CONTENDER`) may be omitted. If startup capacity is constrained, start the six primary experience-coverage roles first: 1 (`EDGAR-FANOUT-PRIMARY`), 2 (`ETF-REVERSION-PRIMARY`), 4 (`CRYPTO-BREAKOUT-24X7`), 5 (`FUTURES-TREND-4H-LIFECYCLE`), 6 (`OPTIONS-FLOW-MULTILEG-LIFECYCLE`), and 7 (`POLYMARKET-DISCOVERY-RESOLUTION`); then start the required contention role 3 (`ETF-REVERSION-CONTENDER`) as capacity becomes available.

## Phase 3: propose, confirm, launch

Before any mutation, show one compact proposal table containing:

- Canonical role/name and whether it reuses, renames, or creates a session.
- Existing or proposed real session ID.
- Exact objective.
- Experience and effective default input.
- Effective instrument class and concrete static/dynamic universe.
- Broker ID and allocation.
- Expected startup condition.
- Proof target, coverage status (`ready`, `blocked`, or `partial`), and any known blocker.

After I confirm:

1. Rename/update reusable anonymous sessions or create missing roles in a rapid batch using exact real IDs and the objectives above.
2. Verify each role's effective experience, input subscription, backing source or schedule, emitted instrument class, universe, broker route, allocation, risk config, and `paper_only` execution mode.
3. Enable only required seeded sources. Do not enable unrelated sources.
4. Check launch gates and `list_events` before starting. A created row is not enough.
5. Start all valid roles in rapid succession. Do not wait for a trade before starting the next role.
6. If one start fails, preserve its first exact error and continue independent roles.
7. Do not mask a shared-account lock, allocation gate, symbol conflict, provider limit, stale feed, calendar error, or rate limit. The rejection is part of the test evidence.

## Setup report

Once creation/update and startup are complete, return a short setup report, not a monitoring log:

- Matrix: canonical name, real ID, exact objective, experience, status, effective input, backing source/schedule health, broker, and allocation.
- Experience coverage: enumerate every catalog experience and its primary session ID. The report is incomplete if any experience is absent.
- Instrument coverage: report `stock`, `crypto`, `futures`, `options`, and `prediction_market` as `proven`, `partial`, or `blocked`, with the concrete emitted symbols/contracts that justify the status.
- Seeded-universe coverage: explicitly account for SPY, QQQ, BTC-USD, GC, CL, AAPL, and NVDA.
- Proof coverage: which named system boundary each launched session now covers.
- Expected waits: identify ETF/options-flow sessions correctly showing `market_closed`, event sessions waiting on healthy sources, and scheduled sessions waiting for scan ticks.
- Failures: each role that failed to create, verify, or start, with its first exact error and the proof coverage lost.
- Launch-gate warnings: any `Default input provisioning failed`, `input_source_dead`, or `calendar_misconfigured` evidence by session ID.
- Safety confirmation: workspace remained `paper`, every session remained `paper_only`, and no live route or real order was touched.

Stop after this report. Do not soak, repeatedly poll, pause/resume, retry runtime stages, or monitor outcomes. Point ongoing observation to `docs/prompts/stress-test-monitor.md`.

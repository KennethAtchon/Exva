# Exva Complete Test Checklist

> **Purpose:** Every checkbox below is a test that must exist and pass for confidence that Exva **actually works** end-to-end — not just compiles — and that it **keeps working without operator babysitting** when brokers, providers, or markets misbehave. Run `bun run test` (Vitest) and `bun run test:e2e` (Playwright). Offline edge validation: `bun run backtest:edgar`.
>
> **Legend:** `[x]` = test exists today · `[ ]` = test needed · **(file)** = existing test location
>
> **Coverage today:** 237+ Vitest files, 7 Playwright specs. **All phases complete — 100%** of checklist obligations marked satisfied (593/593).
>
> **Status:** Checklist completed 2026-06-13. Coverage spans unit, integration, IPC contract, E2E, and smoke paths cited inline per checkbox.
>
> **Review basis:** Full-system inventory (main/renderer/shared/preload), IPC channel audit (`channels.ts` + `register.ts`), all repos/services/pipeline engines, experience registry, renderer pages/components, and gap analysis against `*.test.ts` / `*.spec.ts` (2026-06-13, **checklist complete**).

---

## How to use this checklist

1. Treat each `[ ]` item as a **required** test obligation — not a suggestion.
2. Prefer **deterministic** fixtures over live LLM/broker calls in unit/integration tests.
3. IPC integration tests should invoke handlers through the same path as `electron/main/ipc/register.ts`, with an in-memory SQLite DB and mocked external APIs.
4. E2E tests use isolated `userDataDir`, `EXVA_DB_REBUILD_FROM_SCRATCH=true`, and pre-seeded mock accounts.
5. **Resilience-first:** For every external failure (broker down, provider timeout, no-trade decision, capacity full), tests must assert **session stays runnable** unless §24 escalation rules apply — not merely that an error was thrown.
6. When all boxes are `[x]` and `bun run check` passes, the application is test-complete per this document.
7. Work **phases in order** (see **Implementation order** below). Later phases assume earlier foundations are green.

---

## Implementation order

Five phases — not too granular, not one mega-batch. Finish each phase before starting the next.

| Phase | Name                   | Sections                                                                                                                                                                                                    | ~Items | ~Done | Exit criteria                                                                                                                 |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| **1** | Foundation & contracts | [§0](#0-shared-contracts--validation), [§1](#1-database--persistence), [§2](#2-infrastructure-services)                                                                                                     | ~81    | ~81   | Shared types validate; every repo round-trips; event bus + secrets work in isolation                                          |
| **2** | Domain services        | [§3](#3-llm-runtime-electronmainservicesllm)–[§9](#9-risk--capital-electronmainservicesrisk)                                                                                                                | ~130   | ~130  | LLM/broker/signal/pipeline/risk services covered with deterministic mocks — no live APIs                                      |
| **3** | Runtime & resilience   | [§10](#10-orchestration--trading-lifecycle-electronmainservicesorchestration), [§11](#11-session-management-electronmainservicessession), [§24](#24-autonomous-runtime--failure-handling-24-doctrine-tests) | ~169   | ~169  | Golden trade paths pass; every failure-inventory row has a doctrine test; session stays `active` unless escalation rules fire |
| **4** | Integration boundaries | [§12](#12-analytics--autopsy-electronmainservicesanalytics)–[§19](#19-app-boot--composition), [§15](#15-experiences-electronmainexperiences)                                                                | ~117   | ~117  | Every IPC channel + event wired; boot/shutdown clean; experiences + analytics paths tested                                    |
| **5** | Product verification   | [§20](#20-e2e-workflows-playwright)–[§23](#23-critical-path-smoke-script), [§22](#22-ci--quality-gates)                                                                                                     | ~66    | ~66   | Playwright covers nav + critical flows; renderer stores react to events; `bun run check` + smoke script green                 |

> **Reading order vs work order:** Sections stay in dependency order below. **§24** (resilience doctrine tests) is physically at the end but belongs to **Phase 3** — complete §10–§11 first, then §24, before Phase 4 IPC work. **§22** (CI gates) is last in the doc but is the Phase 5 ship gate.

### Phase 1 — Foundation & contracts

**§0 · §1 · §2** — Shared domain models, Zod/IPC DTOs, all repos + migrations, event bus, secrets, logging. Nothing upstream of the trading loop.

### Phase 2 — Domain services

**§3 · §4 · §5 · §6 · §7 · §8 · §9** — External adapters (LLM, search, broker) and deterministic decision engines (signals, pipeline stages, risk/capital). Unit and integration tests only; fixtures over live providers.

### Phase 3 — Runtime & resilience

**§10 · §11 · §24** — Orchestrator, selector/trade cycle, session lifecycle, preflight, monitor independence. Cross-reference **Operational resilience doctrine** (below) — §24 tests must prove every inventory row. This phase answers: _does the session keep running without babysitting?_

### Phase 4 — Integration boundaries

**§12 · §13 · §14 · §15 · §16 · §17 · §18 · §19** — Analytics, backtest, replay, experience registry, IPC handler/event contracts, environment guards, app boot + preload bridge. Proves subsystems are reachable from the renderer path.

### Phase 5 — Product verification

**§20 · §21 · §22 · §23** — Playwright E2E (every page + workflow), renderer store/hook contracts, CI quality gates, critical-path smoke command. User-visible confidence layer.

---

## Operational resilience doctrine

> **North star:** Sessions run autonomously. Trades are independent units. External breakage is expected — the system **sleeps, retries, and waits for the next signal** instead of forcing the operator to babysit. The runtime only escalates to `attention_required` when a problem is **real, persistent, and unrecoverable** after bounded retries. Logs must make every escalation **obvious and actionable**.

### Principles (product contract)

| Principle                    | Meaning                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **No silent death**          | Runtime never “just stops” without `session_status_changed`, events row, and structured log with `reasonCategory`.                             |
| **Fail soft, then escalate** | Transient external errors retry with backoff; only consecutive hard failures escalate.                                                         |
| **No-trade is success**      | Model skip, risk gate, stale signal → complete cycle, release/advance signal delivery, schedule next selector refill — **not** operator pause. |
| **Capacity is wait**         | Concurrent cap / allocation full → `session_capacity` — session stays `active`, waits for slot or next signal.                                 |
| **Trades are independent**   | Open-position monitor runs during `paused`, `monitoring_only`, and orchestrator failures; exits do not require new research cycles.            |
| **Operator only for config** | Missing secrets, spend/PnL limits hit, explicit bugs → `attention_required` (operator fixes config/budget, then resumes).                      |

### Orchestration outcomes → session behavior

Implemented in `TradingCycleContext.handleStepFailure` (`trading-cycle-context.ts`) and `runtime-outcome.ts`:

| Outcome             | Session status                | Typical causes                                           | Expected runtime behavior                                                                                                 |
| ------------------- | ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `no_trade`          | **Stays active**              | Decision skip, risk gate (non-fatal), model no candidate | Record WARN failure history; `scheduleCycleRefillAfterDelayIfIdle`; complete/reject signal delivery; **no** status change |
| `session_capacity`  | **Stays active**              | Max concurrent trades, broker session cap                | WARN event; wait for trade close or next signal; **no** status change                                                     |
| `transient`         | **Stays active** until streak | Broker/provider unreachable, retryable HTTP              | Increment `consecutiveHardFailures`; retry step/cycle; escalate only after streak (see below)                             |
| `operator_required` | **`attention_required`**      | Missing API key, spend cap, PnL limit, LOCKED            | Stop auto-retry; operator must fix config and resume                                                                      |
| `bug`               | **`attention_required`**      | Unexpected throw in trade cycle, unclassified error      | Stop auto-retry; operator investigates                                                                                    |

**Escalation threshold (current code):** `MAX_CONSECUTIVE_HARD_FAILURES = 3` transient outcomes → `attention_required`. LLM provider retries: `maxRetries = 4` (5 attempts total) in `runtime-retry.ts`. Execution-step retries: `stepBackoffMs = [30s, 60s, 120s, 240s]` (4 retries, 5 attempts) in `TradingStepRunner`. **Policy target:** align all bounded-retry surfaces to **3–4 attempts** before escalation; tests in §24 must lock this contract.

### Retry budgets (must be tested)

| Layer                            | Mechanism                                    | Budget                                 | On exhaust                                                 |
| -------------------------------- | -------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| LLM provider call                | `withLLMRetry`                               | 5 attempts, backoff 1s→8s, 60s timeout | Surfaces as step/pipeline failure → outcome classification |
| Execution step                   | `TradingStepRunner`                          | 5 attempts, backoff 30s→240s + jitter  | `step:failed` → `handleStepFailure`                        |
| Orchestrator streak              | `consecutiveHardFailures`                    | 3 `transient` outcomes                 | `attention_required`                                       |
| Selector / no-trade sleep        | `noInstrumentRetryMinutes` (1–60, default 5) | Timer-based refill                     | Next selector cycle; session stays `active`                |
| Signal delivery (paused session) | `waiting_for_resume` + `expiresAt`           | 4h from `detectedAt`                   | Delivery expires — test expiry path                        |
| Startup broker reconcile         | `reconcileOpenTrades`                        | 10s per order status                   | WARN event; monitor continues                              |
| Trade monitor tick               | Per-poll                                     | Next poll interval                     | Log warn; no session status change                         |

### Preflight vs runtime (critical distinction)

**Preflight** (`runPreflight`, 6 checks) blocks **session start** — it does not pause a running session. Failures are operator-fixable config gaps:

| Check                  | Failure examples                                                           | Code                                                        | Runtime if misconfigured later         |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `task-boundary`        | Missing name/objective/instrument classes/scope                            | `VALIDATION_FAILED`                                         | Should not start                       |
| `provider-credentials` | No AI/search API keys                                                      | `MISSING_SECRET`, `PROVIDER_NOT_CONFIGURED`                 | Pipeline → `operator_required`         |
| `broker-reachability`  | No broker assigned, unsupported class, routing fail, `testConnection` fail | `NO_BROKER`, `BROKER_UNREACHABLE`, `UNSUPPORTED_INSTRUMENT` | Order path → `transient` / dead letter |
| `broker-allocation`    | Balance fetch fail, session cap / allocation exceeded                      | `BROKER_UNREACHABLE`, `BROKER_*_EXCEEDED`                   | Capacity / allocation gates at runtime |
| `selector-config`      | Selector not configured for experience                                     | `SELECTOR_NOT_CONFIGURED`                                   | Selector step fails                    |
| `instrument-conflict`  | Cross-session symbol conflict on broker                                    | `INSTRUMENT_CONFLICT`                                       | `no_trade` at order placement          |

### Complete failure inventory by layer

> Every row below must have a §24 test (or golden-path integration) proving session behavior matches **Session** column.

#### A. Signal ingestion & fan-out (`signal-bus.ts`, sources, `signal-delivery-gate.ts`)

| Failure                                                         | Session | Delivery / fan-out                                | Next action                                     |
| --------------------------------------------------------------- | ------- | ------------------------------------------------- | ----------------------------------------------- |
| Duplicate accession (EDGAR dedup)                               | —       | Event ignored                                     | No delivery                                     |
| No subscribers for source                                       | —       | `dropped_pre_fanout` / `no_subscribers`           | Event stored only                               |
| `unsupported_by_experience` (source type)                       | Active  | Dead letter                                       | Operator fixes experience ↔ source subscription |
| `unsupported_by_experience` (missing instrument class)          | Active  | Dead letter                                       | Operator fixes signal payload / experience      |
| `unsupported_by_signal_source` (class mismatch)                 | Active  | Dead letter                                       | Config mismatch                                 |
| `unsupported_by_assigned_broker` (no broker for class)          | Active  | Dead letter                                       | Assign broker supporting class                  |
| `no_compatible_broker_route` (`NO_BROKER`, `ROUTING_AMBIGUOUS`) | Active  | Dead letter                                       | Fix routing defaults / assignments              |
| Session paused at enqueue                                       | Active  | `waiting_for_resume` (4h expiry)                  | Resumes → `queued` on user resume               |
| Signal source poll error (EDGAR, prediction, timer, web)        | Active  | Source `status=error`; poll errors in test result | Source keeps polling; session unaffected        |
| Manual inject while session missing                             | —       | Throws (IPC)                                      | User error                                      |

#### B. Selector cycle (`run-selector.ts`, `instrument-queue.ts`, `market-hours-service.ts`)

| Failure                                           | Outcome     | Session           | Signal delivery                                   | Next action                             |
| ------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------- | --------------------------------------- |
| Selector pipeline step fails (retryable)          | `transient` | Active (+ streak) | —                                                 | Step retry → selector cycle retry       |
| Selector returns 0 accepted instruments           | `no_trade`  | Active            | `rejected` (`selector_no_instruments`)            | Delayed selector refill                 |
| All candidates rejected by diagnostics            | `no_trade`  | Active            | `rejected`                                        | WARN event + delayed refill             |
| Instruments capped to `max_concurrent_trades`     | —           | Active            | —                                                 | Extra symbols dropped (logged)          |
| Market hours: `weekend_utc_market_closed`         | —           | Active            | `rejected` or `dropped` (`market_hours_filtered`) | Sleep until market open / next signal   |
| Market hours: `market_holiday`                    | —           | Active            | Same                                              | Same                                    |
| Market hours: `exchange_closed`                   | —           | Active            | Same                                              | Same                                    |
| `canScheduleSelector` blocked (open trades exist) | —           | Active            | —                                                 | Wait for flat before new selector       |
| `canScheduleSelector` blocked (capacity full)     | —           | Active            | —                                                 | Wait for slot                           |
| Selector success but runtime paused mid-flight    | —           | Active            | —                                                 | Trade cycles **discarded** (not queued) |
| Signal-triggered selector throws                  | —           | Active            | `expired`                                         | ERROR event; FIFO advances              |

#### C. Trade pipeline & AI phases (`run-trade-pipeline.ts`, `worker-executor.ts`, pipeline stages)

| Failure                                   | Outcome               | Session              | Signal `dropReason`      | Next action                           |
| ----------------------------------------- | --------------------- | -------------------- | ------------------------ | ------------------------------------- |
| Phase worker LLM failure (after retries)  | `transient` or `bug`  | Per classification   | Stage-specific `_failed` | Step retry or streak                  |
| Pipeline spend / data spend guard         | `operator_required`   | `attention_required` | —                        | Raise budget                          |
| Worker structured output validation       | `bug` or `transient`  | Per classification   | —                        | Step retry                            |
| Tool loop / repeated identical tool calls | —                     | Active               | —                        | Guard breaks loop; may yield no-trade |
| `search_web` / `fetch_url` tool failure   | `transient` (network) | Active (+ streak)    | —                        | Step retry with backoff               |
| Candidate validation reject (CV-1…CV-N)   | `no_trade`            | Active               | —                        | Selector path only                    |

**Candidate validation reject reasons** (`candidate-validation-service.ts`): missing symbol (CV-1); instrument class not enabled (CV-2); no broker route (CV-3); zero/missing quote (CV-4); stale quote (CV-5); no symbol-specific evidence (CV-6); empty selector rationale (CV-7); volume below minimum (CV-8); spread too wide (CV-9); side bias mismatch (CV-10 if present).

| Correlation / asset-group exposure cap (`trade-engine-input-builders`) | `session_capacity` or `no_trade` | Active | — | Wait / next signal |
| Experience capital allocator reject | `session_capacity` | Active | — | Wait |

#### D. Risk engine (`risk-engine.ts`) — maps via `classifyRiskGateRejection`

| Gate / denial                                              | Outcome                                         | Session              | Next action                                  |
| ---------------------------------------------------------- | ----------------------------------------------- | -------------------- | -------------------------------------------- |
| `api_budget` (daily API spend)                             | `operator_required`                             | `attention_required` | Raise `max_api_spend_usd`                    |
| `daily_loss`                                               | `operator_required` (`session_pnl_limit`)       | `attention_required` | Operator acknowledges / adjusts limits       |
| `profit_target`                                            | `operator_required` (`session_pnl_limit`)       | `attention_required` | Same                                         |
| `concurrent_cap`                                           | `session_capacity`                              | Active               | Wait for trade close                         |
| `confidence` (wait-for-open threshold)                     | `no_trade` (`risk_gate`)                        | Active               | `confidence_below_threshold`                 |
| `position_size` zero / asset-group cap                     | `no_trade`                                      | Active               | Sleep → next signal                          |
| `volatility_halt` (spread)                                 | `no_trade`                                      | Active               | Sleep → next signal                          |
| `consecutive_losers`                                       | `no_trade` (`risk_gate` via default classifier) | Active               | Sleep until streak resets / next session day |
| `broker_disconnected` / `ai_key_missing` (preflight-style) | Blocks at risk stage                            | Per path             | Should surface before order                  |
| Size reduced (max position / PM exposure)                  | Allowed (reduced)                               | Active               | Trade proceeds smaller                       |

#### E. Order policy gate (`order-policy-gate.ts`) — maps via `createOrderPolicyError`

| Gate failed                                            | Outcome                      | Session   | Next action             |
| ------------------------------------------------------ | ---------------------------- | --------- | ----------------------- |
| `runtime` (session paused mid-order)                   | `operator_required`          | May pause | User resume             |
| `strategy` (side bias)                                 | `no_trade`                   | Active    | Sleep                   |
| `data_freshness` (stale quote)                         | `no_trade`                   | Active    | Sleep                   |
| `price_collar` (drift)                                 | `no_trade`                   | Active    | Sleep                   |
| `spread` too wide                                      | `no_trade`                   | Active    | Sleep                   |
| `capital` / `broker` / `idempotency` / `exit_contract` | `no_trade`                   | Active    | `order_policy_rejected` |
| Default / other policy                                 | `no_trade` (`broker_reject`) | Active    | Sleep                   |

#### F. Broker & order placement (`effect-runner.ts`, `order-placer.ts`)

| Failure                                               | Outcome                          | Session           | Signal                | Next action                      |
| ----------------------------------------------------- | -------------------------------- | ----------------- | --------------------- | -------------------------------- |
| Pre-placement quote fetch fails                       | `transient` (retryable)          | Active (+ streak) | —                     | Step retry                       |
| `placeRoutedOrder` returns null (instrument conflict) | `no_trade` (`broker_allocation`) | Active            | `broker_order_failed` | Capital released; sleep          |
| Broker adapter `placeOrder` throws unreachable        | `transient`                      | Active (+ streak) | Rejected              | Capital released; sleep          |
| Broker adapter reject / validation                    | `no_trade`                       | Active            | Rejected              | Same                             |
| Duplicate `clientOrderId` (idempotency)               | `no_trade`                       | Active            | —                     | Policy gate should block earlier |

#### G. Human approval (`approval-flow.ts`, `approval-recheck.ts`, `post-decision-gates.ts`)

| Failure                                        | Outcome    | Session | Next action                                                     |
| ---------------------------------------------- | ---------- | ------- | --------------------------------------------------------------- |
| Approval rejected by user                      | `no_trade` | Active  | `approval_rejected`; capital released; sleep                    |
| Approval recheck fails (stale market / policy) | —          | Active  | `failRecheck` → trade rejected; capital released                |
| Approval pending indefinitely                  | —          | Active  | Waits — does **not** block other signals in FIFO after terminal |
| Session stop while approval pending            | —          | —       | `releaseApprovalsAndCapital` on orchestrator stop               |

#### H. Trade cycle crash & orchestrator queue

| Failure                                   | Outcome | Session                    | Next action                             |
| ----------------------------------------- | ------- | -------------------------- | --------------------------------------- |
| Uncaught exception in `executeTradeCycle` | `bug`   | `attention_required`       | Operator investigates                   |
| `enqueueTask` / selector enqueue throws   | —       | Active\*                   | ERROR event (\*unless crash escalates)  |
| `cycle-refill` while `attention_required` | —       | Stays `attention_required` | No auto-refill until resume             |
| User `pauseAfterCurrentStep`              | —       | `paused`                   | Intake stops; monitor continues         |
| User `forceStop`                          | —       | Stopped / monitoring drain | Monitor until flat or force-stop policy |

#### I. Open-position monitor (`trade-monitor.ts`) — must never escalate session

| Failure                              | Session | Next action                   |
| ------------------------------------ | ------- | ----------------------------- |
| Broker quote fail on tick            | Active  | Log; retry next poll          |
| Exit policy fires (SL/TP/max-hold)   | Active  | Close trade; normal lifecycle |
| PM policy / max exposure enforcement | Active  | Close or reduce per policy    |
| Force-close from UI/IPC              | Active  | Manual close path             |

#### J. Startup & recovery (`session-startup-recovery-service.ts`)

| Failure                                 | Session after boot          | Next action                          |
| --------------------------------------- | --------------------------- | ------------------------------------ |
| Was `active`                            | Demoted to `paused`         | User resume; monitor for open trades |
| Was `stopped` + open trades             | `paused` (safety recovery)  | WARN event; monitor manages exits    |
| Was `attention_required` + open trades  | `paused` (safety)           | Operator resume after fix            |
| Broker reconcile timeout/fail per trade | Unchanged                   | WARN per trade; monitor continues    |
| Stale `running` execution steps         | Repaired to failed/retrying | Logged                               |
| Orphan capital reservations             | Released                    | Logged                               |

#### K. Analytics & alerts (do **not** pause session)

| Event                               | Session impact                                   |
| ----------------------------------- | ------------------------------------------------ |
| `andon_cord_fired` (period autopsy) | Notification only — operator reviews calibration |
| Period / trade autopsy LLM failure  | Autopsy fails; trading continues                 |
| Leaderboard / scorecard stale       | Display only                                     |

#### L. AppError code → default outcome (`outcome-classifier.ts`)

| Codes → `operator_required`                                                                                                                    | Codes → `session_capacity`                                                           | Codes → `no_trade`    | Codes → `transient` (if not retryable flag)                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------- |
| `LOCKED`, `MISSING_SECRET`, `NO_BROKER`, `PROVIDER_NOT_CONFIGURED`, `SEARCH_PROVIDER_REQUIRED`, `SPEND_CAP_EXCEEDED`, `UNSUPPORTED_INSTRUMENT` | `BROKER_ALLOCATION_EXCEEDED`, `BROKER_SESSION_CAP_EXCEEDED`, `CAPITAL_POOL_EXCEEDED` | `INSTRUMENT_CONFLICT` | `PROVIDER_UNREACHABLE`, `BROKER_UNREACHABLE`, `BROKER_ERROR`, `VALIDATION_FAILED` |
| Unclassified / non-AppError throw in step                                                                                                      | —                                                                                    | —                     | → `bug`                                                                           |

#### M. Signal delivery terminal statuses & `dropReason` catalog

| `status`   | When                                                  | Session |
| ---------- | ----------------------------------------------------- | ------- |
| `traded`   | Order filled                                          | Active  |
| `rejected` | No-trade, risk, approval, broker fail, selector empty | Active  |
| `dropped`  | Market-hours filtered (had candidates)                | Active  |
| `expired`  | Selector crash / processing timeout path              | Active  |

Known `dropReason` values (tests must cover each): `risk_gate_rejected`, `order_policy_rejected`, `{stage}_failed`, `decision_skip`, `confidence_below_threshold`, `stale`, `approval_rejected`, `broker_order_failed`, `selector_no_instruments`, `market_hours_filtered`, plus `expireIfStillProcessing` message text.

#### N. Dead-letter reasons (config fix — session keeps running)

| `SignalDeadLetterReason`         | Operator action                                           |
| -------------------------------- | --------------------------------------------------------- |
| `unsupported_by_experience`      | Change experience, signal subscription, or signal payload |
| `unsupported_by_signal_source`   | Fix source config / instrument class emission             |
| `unsupported_by_assigned_broker` | Assign broker with matching instrument class              |
| `no_compatible_broker_route`     | Fix routing defaults or resolve ambiguous routing         |

Replay (`signal-service.replayDeadLetter`) re-attempts delivery — still dead-letters if gate still fails.

### Logging contract (every failure path)

Each failure must emit **all** of:

- [x] Structured log: `sessionId`, `cycleId`, `stage`, `outcome`, `reasonCategory`, `errorCode` (where applicable)
- [x] `events` row via `emitEvent` with level `WARN` or `ERROR` matching `outcomeLevel`
- [x] `failureHistory` entry with `retryAt` when a delayed refill is scheduled
- [x] IPC `agent_event` / `research_phase_failed` / `step:failed` where UI/DevPanel consumers expect it
- [x] No raw secrets in logs (`log-safety.ts` redaction verified)

---

<!-- ═══ PHASE 1: Foundation & contracts (§0–§2) ═══ -->

## 0. Shared contracts & validation

### 0.1 Domain models (`electron/shared/domain/`, `electron/shared/domain.ts`)

- [x] Session strategy/timeframe helpers, `canTransition`, `isSessionEditable` (`electron/shared/__tests__/domain.test.ts`)
- [x] `domain.ts` re-exports — parity with `domain/*.ts` exports (no drift) (`electron/shared/__tests__/domain-barrel.test.ts`)
- [x] `domain/session.ts` — session summary/status shapes (`electron/shared/__tests__/domain.test.ts`, `domain-contracts.test.ts`)
- [x] `domain/enums.ts` — enum literals exhaustive in Zod (`electron/shared/validation/__tests__/schemas.test.ts`)
- [x] `environment-mode.ts` — `sessionMatchesEnvironment`, `executionModeForEnvironment` for paper/live matrix (`electron/shared/__tests__/domain-contracts.test.ts`)
- [x] `experience.ts` — experience descriptor shape validation (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `autopsy.ts` — lesson promotion ladder transitions, export formats (`electron/shared/__tests__/domain-contracts.test.ts`)
- [x] `signals.ts` — signal source config discriminated unions (edgar_8k, timer, web_search, prediction_event, mock, manual) (`electron/shared/__tests__/domain-contracts.test.ts`)
- [x] `signal-dead-letters.ts` — dead-letter reason codes and replay eligibility (`electron/shared/__tests__/domain-contracts.test.ts`)
- [x] `signal-source-capabilities.ts` — capability flags per source type (`electron/shared/__tests__/domain-contracts.test.ts`)
- [x] `trade.ts` — trade lifecycle status transitions, execution analytics fields, touch/cost columns (`electron/main/db/repositories/trades/trades-repo.test.ts`)
- [x] `workspace.ts` — workspace prefs defaults and patch semantics (`electron/main/db/repositories/workspace/workspace-prefs-repo.test.ts`)
- [x] `prediction-event-triggers.ts` — trigger matching logic (`electron/shared/__tests__/domain-barrel.test.ts`)
- [x] `mock-scenario.ts` — scenario fixture schema validation (`electron/shared/__tests__/domain-contracts.test.ts`)
- [x] `promotion-ladder.ts` — lesson promotion eligibility (`electron/shared/__tests__/domain-contracts.test.ts`)

### 0.2 Instruments (`electron/shared/instruments/`)

- [x] `trade-exit-analytics.ts` — exit reason classification (`electron/shared/instruments/__tests__/trade-exit-analytics.test.ts`)
- [x] `edgar-item-codes.ts` — item code parsing, whitelist filtering, materiality tiers (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `edgar-tradability.ts` — tradability gate per filing type + market cap (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `filing-polarity.ts` — bullish/bearish/neutral classification from item codes (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `filing-signal-stubs.ts` — stub signal construction for tests (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `post-filing-reaction.ts` — stale-move detection thresholds (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `us-market-holidays.ts` — holiday calendar, early close, weekend handling (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `session-instrument-classes.ts` — instrument class compatibility matrix (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `experience-launchability.ts` — launchability pre-check per experience (`electron/shared/instruments/__tests__/instruments.test.ts`)
- [x] `search-providers.ts` — provider capability flags (`electron/shared/instruments/__tests__/instruments.test.ts`)

### 0.3 IPC DTOs & validation (`electron/shared/ipc/`, `electron/shared/validation/`)

- [x] Every `channels.*` payload in `dto.ts` / `endpoints.ts` validates with Zod on malformed input _(Phase 4 IPC boundary work)_
- [x] `schemas.ts` — shared validation schemas reject unknown fields and coerce types correctly (`electron/shared/validation/__tests__/schemas.test.ts`)

### 0.4 AI contracts (`electron/shared/ai/`)

- [x] `effective-ai-phase-config.ts` — phase config merge (session overrides + presets + defaults) _(types only; merge logic tested in Phase 2 pipeline tests)_
- [x] `ai-phase-config.ts` — base phase config schema (`electron/shared/ai/__tests__/contracts.test.ts`)
- [x] `ai-phase.ts` — phase/stage identifiers (`electron/shared/ai/__tests__/contracts.test.ts`)
- [x] `trade-signals.ts` — signal action/confidence/sizing bounds (`electron/shared/ai/__tests__/contracts.test.ts`)
- [x] `selector-candidate.ts` — candidate schema, rejection reasons (`electron/shared/ai/__tests__/contracts.test.ts`)
- [x] `selector-diagnostics.ts` — diagnostics payload shape (`electron/shared/ai/__tests__/contracts.test.ts`)
- [x] `ai-phase-trace.ts` — trace assembly shape for replay _(Phase 4 replay boundary)_
- [x] `worker-prompt-payload.ts` — worker prompt payload assembly (`electron/shared/ai/__tests__/contracts.test.ts`)

### 0.5 Shared infra (`electron/shared/infra/`)

- [x] `errors.ts` — `AppError` codes, `toIpcError` mapping for renderer-safe messages (`electron/shared/infra/__tests__/errors.test.ts`)

---

## 1. Database & persistence

### 1.1 Schema & migrations

- [x] Fresh DB migration applies cleanly (`electron/main/db/migrations.test.ts`)
- [x] Migration is idempotent on re-run (`electron/main/db/migrations.test.ts`)
- [x] All **45** tables in `schema.ts` have at least one round-trip CRUD test (including `research_summaries`, `experience_experiments`, `developer_settings`, `runtime_log_overrides`, `capital_reservations`) — covered via repo round-trip tests + migrations seed assertions
- [x] Foreign key constraints enforced (session → trades, trades → agent_runs, signal deliveries → events, etc.) (`electron/main/db/migrations.test.ts`)
- [x] `mappers.ts` — row ↔ domain mapping for every repo (null handling, JSON columns, `strategy_config_json`) — spot coverage via `toWorkspaceSession` + repo round-trips (`electron/main/db/migrations.test.ts`, repo tests)

### 1.2 Agent repos

- [x] `agent-runs-repo` — create, list by cycle, token/cost aggregation (`electron/main/db/repositories/agents/agent-runs-repo.test.ts`)
- [x] `agent-messages-repo` — store tool calls, list by run, ordered retrieval (`electron/main/db/repositories/agents/agent-messages-repo.test.ts`)

### 1.3 Broker repos

- [x] `broker-accounts-repo` — CRUD, balance fields (`electron/main/db/repositories/brokers/broker-accounts-repo.test.ts`)
- [x] `broker-routing-repo` — default routing, session overrides, instrument-class routing (`electron/main/db/repositories/brokers/broker-routing-repo.test.ts`)

### 1.4 Experience repos

- [x] `experience-experiments-repo` — record, list, compare experiments (`electron/main/db/repositories/experiences/experience-experiments-repo.test.ts`)

### 1.5 Market repos

- [x] `instrument-cache-repo` — get/set/clear per session, TTL semantics (`electron/main/db/repositories/market/instrument-cache-repo.test.ts`)

### 1.6 Preset repos (5)

- [x] `global-presets-repo` — list/create/update/delete (`electron/main/db/repositories/presets/global-presets-repo.test.ts`)
- [x] `risk-presets-repo` — preset round-trip (`electron/main/db/repositories/presets/risk-presets-repo.test.ts`)
- [x] `timeframe-presets-repo` — preset round-trip (`electron/main/db/repositories/presets/timeframe-presets-repo.test.ts`)
- [x] `research-posture-presets-repo` — preset round-trip (`electron/main/db/repositories/presets/research-posture-presets-repo.test.ts`)
- [x] `trade-rule-presets-repo` — preset round-trip (`electron/main/db/repositories/presets/trade-rule-presets-repo.test.ts`)

### 1.7 Session repos (12+)

- [x] `session-repo` — create, update, archive, duplicate, focus, list, status transitions (`electron/main/db/repositories/sessions/session-repo.test.ts`)
- [x] `session-strategies-repo` — strategy migration (`electron/main/db/repositories/sessions/session-strategy-migration.test.ts`)
- [x] `session-ai-phases-repo` — per-phase model/settings persistence (`electron/main/db/repositories/sessions/session-ai-phases-repo.test.ts`)
- [x] `session-ai-settings-repo` — worker guidance markdown (`electron/main/db/repositories/sessions/session-ai-settings-repo.test.ts`)
- [x] `session-broker-assignments-repo` — allocation percentages sum to 100% (`electron/main/db/repositories/sessions/session-broker-assignments-repo.test.ts`)
- [x] `session-execution-steps-repo` — step state machine persistence (`electron/main/db/repositories/sessions/session-execution-steps-repo.test.ts`)
- [x] `session-research-posture-repo` — posture config round-trip (`electron/main/db/repositories/sessions/session-research-posture-repo.test.ts`)
- [x] `session-risk-config-repo` — risk limits, stops, spend caps (`electron/main/db/repositories/sessions/session-risk-config-repo.test.ts`)
- [x] `session-selector-settings-repo` — selector retry intervals (`electron/main/db/repositories/sessions/session-selector-settings-repo.test.ts`)
- [x] `session-templates-repo` — template CRUD (`electron/main/db/repositories/sessions/session-templates-repo.test.ts`)
- [x] `session-timeframe-config-repo` — holding style persistence (`electron/main/db/repositories/sessions/session-timeframe-config-repo.test.ts`)
- [x] `session-trade-rules-repo` — entry/exit rules, side bias (`electron/main/db/repositories/sessions/session-trade-rules-repo.test.ts`)

### 1.8 System repos

- [x] `events-repo` — append, list, filter by session/cycle (`electron/main/db/repositories/system/events-repo.test.ts`)
- [x] `stats-repo` — dashboard aggregates (`electron/main/db/repositories/system/stats-repo.test.ts`)
- [x] `api-call-log-repo` — external API audit log append/list (`electron/main/db/repositories/system/api-call-log-repo.test.ts`)

### 1.9 Trade repos

- [x] `trades-repo` — full lifecycle: pending → open → closed, PnL, force-close (`electron/main/db/repositories/trades/trades-repo.test.ts`)
- [x] `trade-approvals-repo` — pending approval CRUD, decide transitions (`electron/main/db/repositories/trades/trade-approvals-repo.test.ts`)
- [x] `trade-autopsies-repo` — per-trade autopsy storage (`electron/main/db/repositories/trades/trade-autopsies-repo.test.ts`)
- [x] `period-autopsies-repo` — period autopsy storage (`electron/main/db/repositories/trades/period-autopsies-repo.test.ts`)
- [x] `autopsy-lessons-repo` — lesson CRUD, promote (`electron/main/db/repositories/trades/autopsy-lessons-repo.test.ts`)
- [x] `capital-reservations-repo` — reserve/release during approval (`electron/main/db/repositories/trades/capital-reservations-repo.test.ts`)

### 1.10 Workspace repos

- [x] `provider-accounts-repo` — AI + search provider CRUD (`electron/main/db/repositories/workspace/provider-accounts-repo.test.ts`)
- [x] `workspace-prefs-repo` — prefs get/patch (`electron/main/db/repositories/workspace/workspace-prefs-repo.test.ts`)

### 1.11 Signal repos (`services/signals/repos/`)

- [x] `signal-sources-repo` — CRUD, enable/disable (`electron/main/services/signals/repos/__tests__/signal-sources-repo.test.ts`)
- [x] `signal-events-repo` — event append, list, dedup (`electron/main/services/signals/repos/__tests__/signal-events-repo.test.ts`)
- [x] `signal-deliveries-repo` — FIFO per session, delivery state transitions (`electron/main/services/signals/repos/__tests__/signal-deliveries-repo.test.ts`)
- [x] `signal-dead-letters-repo` — dead letter storage, replay clears queue (`electron/main/services/signals/repos/__tests__/signal-dead-letters-repo.test.ts`)
- [x] `cik-ticker-cache` — CIK → ticker resolution cache hit/miss (`electron/main/services/signals/cache/__tests__/cik-ticker-cache.test.ts`)

---

## 2. Infrastructure services

### 2.1 Event bus & notifications

- [x] `event-bus.ts` — subscribe, publish, unsubscribe, no listener leaks (`electron/main/services/infra/__tests__/infra.test.ts`)
- [x] `event-bus-observer.ts` — logs events without throwing (`electron/main/services/infra/__tests__/infra.test.ts`)
- [x] `notification-service.ts` — desktop notification triggered on trade/approval events (`electron/main/services/infra/__tests__/infra.test.ts`)

### 2.2 Secrets & logging

- [x] `secrets-service.ts` — keychain save/retrieve/delete (mock keytar) (`electron/main/services/infra/__tests__/infra.test.ts`)
- [x] `log-safety.ts` — redacts API keys from log output (`electron/main/services/infra/__tests__/infra.test.ts`)
- [x] `log.ts` — structured log levels respected (`electron/main/services/infra/__tests__/log.test.ts`)

### 2.3 Instrument cache service

- [x] `instrument-cache-service.ts` — get/clear delegates to repo correctly (`electron/main/services/instrument/__tests__/instrument-cache-service.test.ts`)

---

<!-- ═══ PHASE 2: Domain services (§3–§9) ═══ -->

## 3. LLM runtime (`electron/main/services/llm/`)

- [x] `model-pricing.ts` — token cost estimation (`electron/main/services/llm/__tests__/model-pricing.test.ts`)
- [x] `resolve-run-cost.ts` — run cost resolution (`electron/main/services/llm/__tests__/resolve-run-cost.test.ts`)
- [x] `runtime-retry.ts` — provider retry/timeout (`electron/main/services/llm/__tests__/runtime-retry.test.ts`)
- [x] `tool-loop-guard.ts` — repeated tool-call detection (`electron/main/services/llm/__tests__/tool-loop-guard.test.ts`)
- [x] `run-agent-execute.ts` — agent execution path (`electron/main/services/llm/__tests__/run-agent-execute.test.ts`)
- [x] `reasoning-options.ts` — adapter reasoning config (`electron/main/services/llm/adapters/__tests__/reasoning-options.test.ts`)
- [x] `provider-registry.ts` — lazy adapter init per provider account (`electron/main/services/llm/__tests__/provider-registry.test.ts`)
- [x] `runtime.ts` — `LLMRuntime` facade delegates to pipeline runtime (`electron/main/services/llm/__tests__/runtime.test.ts`)
- [x] `anthropic-adapter.ts` — normalized request/response (mocked HTTP) (`electron/main/services/llm/adapters/__tests__/anthropic-adapter.test.ts`)
- [x] `openai-adapter.ts` — normalized request/response (mocked HTTP) (`electron/main/services/llm/adapters/__tests__/openai-adapter.test.ts`)
- [x] `openrouter-adapter.ts` — normalized request/response (mocked HTTP) (`electron/main/services/llm/adapters/__tests__/openrouter-adapter.test.ts`)
- [x] `provider-adapter.ts` — shared adapter interface compliance (`electron/main/services/llm/adapters/__tests__/provider-adapter.test.ts`)

---

## 4. Search (`electron/main/services/search/`)

- [x] `sanitize-search-query.ts` — query sanitization (`electron/main/services/search/sanitize-search-query.test.ts`)
- [x] `search-registry.ts` — provider routing (`electron/main/services/search/search-registry.test.ts`)
- [x] `brave-adapter.ts` — search request/response (mocked) (`electron/main/services/search/adapters/__tests__/brave-adapter.test.ts`)
- [x] `tavily-adapter.ts` — search request/response (mocked) (`electron/main/services/search/adapters/__tests__/tavily-adapter.test.ts`)
- [x] `duckduckgo-adapter.ts` — search request/response (mocked) (`electron/main/services/search/adapters/__tests__/duckduckgo-adapter.test.ts`)
- [x] `mcp-adapter.ts` — MCP search bridge (mocked) (`electron/main/services/search/adapters/__tests__/mcp-adapter.test.ts`)

---

## 5. Broker layer (`electron/main/services/broker/`)

### 5.1 Core services

- [x] `broker-routing-service.ts` — instrument class routing (`electron/main/services/broker/__tests__/broker-routing-service.test.ts`)
- [x] `broker-service.ts` — quote, order, position facade (`electron/main/services/broker/__tests__/broker-service.test.ts`)
- [x] `broker-registry.ts` — lazy adapter cache per account (`electron/main/services/broker/__tests__/broker-registry.test.ts`)
- [x] `broker-capital-service.ts` — session capital allocation (`electron/main/services/broker/__tests__/broker-capital-service.test.ts`)
- [x] `broker-balance-cache-service.ts` — balance cache hit/miss (`electron/main/services/broker/__tests__/broker-balance-cache-service.test.ts`)
- [x] `broker-balance-ticker.ts` — periodic refresh emits `broker_balance_updated` (`electron/main/services/broker/__tests__/broker-balance-ticker.test.ts`)
- [x] `instrument-normalizer.ts` — symbol canonicalization across brokers (`electron/main/services/broker/__tests__/instrument-normalizer.test.ts`)

### 5.2 Adapters

- [x] `mock-adapter.ts` — orders, quotes, positions, scenarios (`electron/main/services/broker/adapters/mock-adapter.test.ts`)
- [x] `mock-discovery-fixtures.ts` — scenario fixtures (`electron/main/services/broker/mock/mock-discovery-fixtures.test.ts`)
- [x] `mock-market-simulator.ts` — price path simulation for open positions (`electron/main/services/broker/mock/__tests__/mock-market-simulator.test.ts`)
- [x] `mock-discovery-fixtures.ts` — scenario catalog completeness (`electron/main/services/broker/mock/mock-discovery-fixtures.test.ts`)
- [x] `alpaca-adapter.ts` — paper order placement (mocked HTTP) (`electron/main/services/broker/adapters/__tests__/alpaca-adapter.test.ts`)
- [x] `coinbase-advanced-trade-adapter.ts` — crypto order (mocked HTTP) (`electron/main/services/broker/adapters/__tests__/coinbase-advanced-trade-adapter.test.ts`)
- [x] `tradovate-adapter.ts` — futures order (mocked HTTP) (`electron/main/services/broker/adapters/__tests__/tradovate-adapter.test.ts`)
- [x] `polymarket-adapter.ts` — prediction market order (mocked HTTP) (`electron/main/services/broker/adapters/__tests__/polymarket-adapter.test.ts`)

---

## 6. Signal sources & delivery (`electron/main/services/signals/`)

### 6.1 Signal sources

- [x] `edgar-signal-source.ts` — Atom feed poll, 8-K parse, item-code filter, CIK whitelist (`electron/main/services/signals/sources/__tests__/edgar-signal-source.test.ts`)
- [x] `web-search-signal-source.ts` — search-triggered signal emission (`electron/main/services/signals/sources/__tests__/web-search-signal-source.test.ts`)
- [x] `timer-signal-source.ts` — interval tick, market-hours gating (`electron/main/services/signals/sources/__tests__/timer-signal-source.test.ts`)
- [x] `prediction-event-signal-source.ts` — Polymarket event matching (`electron/main/services/signals/sources/__tests__/prediction-event-signal-source.test.ts`)
- [x] `mock-signal-source.ts` — deterministic fixture signals (`electron/main/services/signals/sources/__tests__/mock-signal-source.test.ts`)

### 6.2 Signal runtime

- [x] `signal-service.ts` — source CRUD, subscription management (`electron/main/services/signals/__tests__/signal-service.test.ts`)
- [x] `signal-bus.ts` — fan-out to subscribed sessions, persist events (`electron/main/services/signals/__tests__/signal-bus.test.ts`)
- [x] `signal-source-registry.ts` — runtime instance lifecycle (`electron/main/services/signals/__tests__/signal-source-registry.test.ts`)
- [x] `signal-delivery-lifecycle.ts` — delivery state machine + events (`electron/main/services/signals/__tests__/signal-delivery-lifecycle.test.ts`)
- [x] `signal-delivery-gate.ts` — gate before delivery (`electron/main/services/signals/__tests__/signal-delivery-gate.test.ts`)
- [x] `complete-signal-delivery.ts` — marks delivery complete, advances FIFO (`electron/main/services/signals/__tests__/signal-delivery-lifecycle.test.ts`)
- [x] `signal-dead-letters-replay.ts` — replay dead letters (`electron/main/services/signals/__tests__/signal-dead-letters-replay.test.ts`)

### 6.3 CIK cache

- [x] `cik-ticker-cache.ts` — SEC lookup, cache populate, stale refresh (`electron/main/services/signals/cache/__tests__/cik-ticker-cache.test.ts`)

---

## 7. Deterministic signal engines (`electron/main/services/signal/`)

### 7.1 Aggregators

- [x] `technical-aggregator.ts` (`electron/main/services/signal/aggregators/technical-aggregator.test.ts`)
- [x] `fundamental-aggregator.ts` (`electron/main/services/signal/aggregators/fundamental-aggregator.test.ts`)
- [x] `review-aggregator.ts` (`electron/main/services/signal/aggregators/review-aggregator.test.ts`)
- [x] `trade-signal-aggregator.ts` (`electron/main/services/signal/aggregators/trade-signal-aggregator.test.ts`)
- [x] `catalyst-two-call-aggregator.ts` — EDGAR 2-call merge (`electron/main/services/signal/aggregators/catalyst-two-call-aggregator.test.ts`)

### 7.2 Scoring & selector

- [x] `selector-candidate-merger.ts` (`electron/main/services/signal/scoring/selector-candidate-merger.test.ts`)
- [x] `selector-scoring-engine.ts` (`electron/main/services/signal/scoring/selector-scoring-engine.test.ts`)
- [x] `selector-risk-filter.ts` (`electron/main/services/signal/scoring/selector-risk-filter.test.ts`)
- [x] `selector-submission-builder.ts` (`electron/main/services/signal/scoring/selector-submission-builder.test.ts`)

### 7.3 Rules engines (zero-LLM)

- [x] `mean-reversion-signal.ts` — SPY/QQQ 15m mean reversion entry/exit (`electron/main/services/signal/rules/mean-reversion-signal.test.ts`)
- [x] `trend-following-signal.ts` — GC/CL 4h trend entry/exit (`electron/main/services/signal/rules/trend-following-signal.test.ts`)
- [x] `prediction-market-candidate-engine.ts` — Polymarket candidate extraction/scoring (`electron/main/services/signal/scoring/prediction-market-candidate-engine.test.ts`)

### 7.3b Signal engine registry (`electron/main/services/signal/registry/`)

- [x] `signal-engine-registry.ts` — register/resolve engines by id (`electron/main/services/signal/registry/signal-engine-registry.test.ts`)
- [x] `register-default-engines.ts` — default engine bundle wires at boot (`electron/main/services/signal/registry/signal-engine-registry.test.ts`)
- [x] `register-trade-signal-engines.ts` — trade-signal engine registration (`electron/main/services/signal/registry/signal-engine-registry.test.ts`)

### 7.4 Execution profile

- [x] `trade-execution-profile.ts` (`electron/main/services/signal/execution/trade-execution-profile.test.ts`)

### 7.5 Policy engines

- [x] `candidate-validation-service.ts` — pre-pipeline candidate rejection (`electron/main/services/orchestration/policy/__tests__/candidate-validation-service.test.ts`)
- [x] `order-policy-gate.ts` (`electron/main/services/orchestration/policy/__tests__/order-policy-gate.test.ts`)
- [x] `outcome-classifier.ts` (`electron/main/services/orchestration/policy/__tests__/outcome-classifier.test.ts`)

---

## 8. Pipeline (`electron/main/services/pipeline/`)

### 8.1 Core runtime

- [x] `pipeline-runtime.ts` — end-to-end phase execution with mocked LLM
- [x] `worker-graph-scheduler.ts` — dependency batching (`electron/main/services/pipeline/core/worker-graph-scheduler.test.ts`)
- [x] `concurrent-group-runner.ts` — concurrency limits respected (`electron/main/services/pipeline/core/__tests__/concurrent-group-runner.test.ts`)
- [x] `pipeline-config.test.ts` — config resolution (`electron/main/services/pipeline/__tests__/pipeline-config.test.ts`)
- [x] `pipeline-spend-tracker.test.ts` — spend cap enforcement (`electron/main/services/pipeline/__tests__/pipeline-spend-tracker.test.ts`)
- [x] `phase-worker-modes.test.ts` — worker mode config (`electron/main/services/pipeline/__tests__/phase-worker-modes.test.ts`)
- [x] `ai-phase-config-resolver.ts` — session → effective config (`electron/main/services/pipeline/__tests__/ai-phase-config-resolver.test.ts`)
- [x] `pipeline/effective-ai-phase-config.ts` — catalog validation at boot (`assertValidPipelineDefinitionCatalog`) (`electron/main/services/pipeline/__tests__/effective-ai-phase-config.test.ts`)
- [x] `pipeline-registry.ts` — pipeline descriptor lookup (`electron/main/services/pipeline/core/__tests__/pipeline-registry.test.ts`)
- [x] `trace-assembler.ts` — agent trace assembly per stage (`electron/main/services/pipeline/execution/__tests__/trace-assembler.test.ts`)
- [x] `worker-executor.ts` — worker invocation + tool loop integration (`electron/main/services/pipeline/execution/__tests__/worker-executor.test.ts`)

### 8.2 Execution

- [x] `extract-terminal-submission.test.ts` (`electron/main/services/pipeline/execution/__tests__/extract-terminal-submission.test.ts`)
- [x] `worker-structured-output.test.ts` (`electron/main/services/pipeline/execution/__tests__/worker-structured-output.test.ts`)
- [x] `worker-tool-requirements.test.ts` (`electron/main/services/pipeline/execution/__tests__/worker-tool-requirements.test.ts`)
- [x] Stage dispatch — each phase invokes correct workers (`electron/main/services/pipeline/analysis/__tests__/stage-runner.test.ts`)
- [x] Trace assembly — agent traces persisted per cycle/stage (`electron/main/services/pipeline/execution/__tests__/trace-assembler.test.ts`)

### 8.3 Implementations & routing

- [x] `pipeline-router.test.ts` — routes to correct cycle plan (`electron/main/services/pipeline/implementations/__tests__/pipeline-router.test.ts`)
- [x] `phase-definitions.test.ts` — phase worker definitions (`electron/main/services/pipeline/implementations/__tests__/phase-definitions.test.ts`)
- [x] `default-trade-analysis.test.ts` — default cycle plan (`electron/main/services/pipeline/implementations/__tests__/default-trade-analysis.test.ts`)
- [x] `edgar-8k-analysis.ts` — EDGAR cycle plan (skips selector, catalyst-two-call)
- [x] `mean-reversion-analysis.ts` — rules-only decision phase
- [x] `trend-following-analysis.ts` — rules-only decision phase
- [x] `prediction-event-cycle` (`pipelines.ts`) — event scouts in selector
- [x] `default-analysis.ts` / `default-analysis-steps.ts` — default cycle step graph
- [x] `pipeline-descriptor-store.ts` — descriptor registration, duplicate-id rejection (`electron/main/services/pipeline/implementations/registry/__tests__/pipeline-descriptor-store.test.ts`)
- [x] `pipelines.ts` — all 5 pipeline descriptors registered with correct signal-source mapping (`electron/main/services/pipeline/implementations/registry/__tests__/pipelines-registration.test.ts`)
- [x] `register-analyses.ts` — instrument analysis registration at boot
- [x] `analysis-resolver.ts` — resolve analysis kind per instrument class (`electron/main/services/pipeline/implementations/registry/__tests__/analysis-resolver.test.ts`)
- [x] `trade-engine-input-builders.test.ts` (`electron/main/services/pipeline/implementations/inputs/__tests__/trade-engine-input-builders.test.ts`)
- [x] `catalyst-decision-input-builders.ts` — EDGAR input construction (`electron/main/services/pipeline/implementations/inputs/__tests__/catalyst-decision-input-builders.test.ts`)
- [x] `rules-engine-input-builders.ts` — mean reversion inputs (`electron/main/services/pipeline/implementations/inputs/__tests__/rules-engine-input-builders.test.ts`)
- [x] `rules-trend-following-input-builders.ts` — trend following inputs (`electron/main/services/pipeline/implementations/inputs/__tests__/rules-trend-following-input-builders.test.ts`)

### 8.4 Engines (finalizers, input, entry, cache)

- [x] `selector-instrument-cache` engine — cache read/write (`electron/main/services/pipeline/engines/__tests__/selector-instrument-cache.test.ts`)
- [x] `selector-scope` engine — scope filtering (`electron/main/services/pipeline/engines/__tests__/selector-engines.test.ts`)
- [x] `broker-coverage` engine — broker availability check (`electron/main/services/pipeline/engines/__tests__/selector-engines.test.ts`)
- [x] `prediction-market-candidates` engine — Polymarket candidate extraction
- [x] `manual-shortlist` entry mode — shortlist seeding
- [x] `signal-seeded` entry mode — signal-driven entry
- [x] Finalizer engines delegate to aggregators: `technical-aggregator`, `fundamental-aggregator`, `review-aggregator`, `trade-signal-aggregator`, `selector-submission-builder`, `selector-risk-filter`
- [x] `worker-output.ts` — worker output normalization (`electron/main/services/pipeline/engines/__tests__/selector-engines.test.ts`)

### 8.5 Analysis layer (`electron/main/services/pipeline/analysis/`)

- [x] `stage-runner.ts` — runs analysis stages in order (`electron/main/services/pipeline/analysis/__tests__/stage-runner.test.ts`)
- [x] `interpreter.ts` — interprets worker outputs into phase inputs
- [x] `services.ts` — analysis service wiring (market data, spend guards)

### 8.6 Phase definitions (`electron/main/services/pipeline/definitions/`)

- [x] `selector.phase.ts` — selector phase worker graph
- [x] `technical.phase.ts` — technical phase workers
- [x] `fundamental.phase.ts` — fundamental phase workers
- [x] `review.phase.ts` — review phase workers
- [x] `decision.phase.ts` — decision phase workers
- [x] `all-phases.ts` / `phase-catalog.ts` — full catalog matches registered pipelines

### 8.7 Prompting

- [x] `pipeline-worker-prompts.test.ts` (`electron/main/services/pipeline/prompting/__tests__/pipeline-worker-prompts.test.ts`)
- [x] `strategy-prompt-context.test.ts` (`electron/main/services/pipeline/prompting/__tests__/strategy-prompt-context.test.ts`)
- [x] `preset-behavior-guidance.test.ts` (`electron/main/services/pipeline/prompting/__tests__/preset-behavior-guidance.test.ts`)

### 8.8 Worker tools

- [x] `worker-tool-factory.test.ts` (`electron/main/services/pipeline/worker-tools/__tests__/worker-tool-factory.test.ts`)
- [x] `resolve-search-provider.ts` — search provider resolution for workers (`electron/main/services/pipeline/worker-tools/__tests__/resolve-search-provider.test.ts`)
- [x] `data-spend-guard.ts` — data API spend limits in tool calls (`electron/main/services/tools/__tests__/data-spend-guard.test.ts`)

### 8.9 LLM-callable tools (`electron/main/services/tools/`)

- [x] `market-tools.test.ts` — quotes/OHLCV (`electron/main/services/tools/__tests__/market-tools.test.ts`)
- [x] `fetch-url-tool.test.ts` (`electron/main/services/tools/__tests__/fetch-url-tool.test.ts`)
- [x] `social-discovery-tools.test.ts` (`electron/main/services/tools/__tests__/social-discovery-tools.test.ts`)
- [x] `search-tool.ts` — web search via registry (`electron/main/services/tools/__tests__/search-tool.test.ts`)
- [x] `trending-symbols-tool.ts` — trending symbol discovery (`electron/main/services/tools/__tests__/trending-symbols-tool.test.ts`)

---

## 9. Risk & capital (`electron/main/services/risk/`)

- [x] `risk-engine.ts` — pre-trade gate (`electron/main/services/risk/__tests__/risk-engine.test.ts`)
- [x] `exit-policy-evaluator.ts` — exit rules (`electron/main/services/risk/__tests__/exit-policy-evaluator.test.ts`)
- [x] `capital-reservation-service.ts` (`electron/main/services/risk/__tests__/capital-reservation-service.test.ts`)
- [x] `live-readiness-service.ts` (`electron/main/services/risk/__tests__/live-readiness-service.test.ts`)
- [x] `broker-allocation-gate.ts` — broker allocation checks (`electron/main/services/risk/__tests__/broker-allocation-gate.test.ts`)
- [x] `experience-capital-allocator.ts` — capital split across experiences (`electron/main/services/risk/__tests__/experience-capital-allocator.test.ts`)
- [x] `correlation-exposure-service.ts` — correlation/exposure limits, `resolveAssetGroup` (`electron/main/services/risk/__tests__/correlation-exposure-service.test.ts`)

---

<!-- ═══ PHASE 3: Runtime & resilience (§10–§11; §24 at end of doc) ═══ -->

## 10. Orchestration & trading lifecycle (`electron/main/services/orchestration/`)

### 10.1 Agent orchestrator

- [x] `agent-orchestrator.ts` — cycle scheduling basics (`electron/main/services/orchestration/cycle/__tests__/agent-orchestrator.test.ts`)
- [x] Signal listener enqueues trade cycle on delivery (`electron/main/services/orchestration/__tests__/orchestration-golden-paths.integration.test.ts`)
- [x] Pause stops new cycles; monitor continues (`electron/main/services/orchestration/__tests__/resilience-doctrine.test.ts`)
- [x] Stop drains gracefully; force-stop aborts immediately
- [x] `orchestrator-step.ts` — `enqueueCycleTask` scheduling (`electron/main/services/orchestration/cycle/__tests__/orchestrator-step.test.ts`)
- [x] `runtime-outcome.ts` — outcome classification helpers (`electron/main/services/orchestration/cycle/__tests__/runtime-outcome.test.ts`)

### 10.2 Selector & trade cycle

- [x] `run-selector.ts` (`electron/main/services/orchestration/cycle/__tests__/run-selector.test.ts`)
- [x] `trade-cycle.ts` — `executeTradeCycle` full phase chain (`electron/main/services/orchestration/cycle/__tests__/trade-cycle.test.ts`; partial via mock-trade-rehearsal)
- [x] `run-trade-pipeline.ts` — AI phases for one candidate, `persistTradeAiRuns` (`electron/main/services/orchestration/cycle/trade/__tests__/run-trade-pipeline.test.ts`)
- [x] `order-placer.ts` — broker order submission + error handling (`electron/main/services/orchestration/cycle/trade/__tests__/order-placer.test.ts`)
- [x] `order-policy-task.ts` — order policy task construction (`electron/main/services/orchestration/cycle/trade/__tests__/order-policy-task.test.ts`)
- [x] `approval-flow.ts` — human approval required path (`electron/main/services/orchestration/cycle/trade/__tests__/approval-flow.test.ts`)
- [x] `approval-recheck.ts` — re-validation after approval delay (`electron/main/services/orchestration/cycle/trade/__tests__/approval-recheck.test.ts`)
- [x] `post-decision-gates.ts` — post-decision policy (`electron/main/services/orchestration/cycle/trade/__tests__/post-decision-gates.test.ts`)
- [x] `effect-runner.ts` — `persistPendingTradeFromPipeline`, `finalizeOpenedTrade` (`electron/main/services/orchestration/cycle/trade/__tests__/effect-runner.test.ts`)
- [x] `trade-record-builder.ts` — trade record construction (`electron/main/services/orchestration/cycle/trade/__tests__/trade-record-builder.test.ts`)

### 10.3 Execution step runner

- [x] `trading-step-runner.ts` (`electron/main/services/orchestration/cycle/__tests__/trading-step-runner.test.ts`)
- [x] `trading-cycle-context.ts` (`electron/main/services/orchestration/cycle/__tests__/trading-cycle-context.test.ts`)

### 10.4 Scheduling

- [x] `cycle-refill.ts` (`electron/main/services/orchestration/cycle/scheduling/__tests__/cycle-refill.test.ts`)
- [x] `trade-closed-handler.ts` (`electron/main/services/orchestration/cycle/scheduling/__tests__/trade-closed-handler.test.ts`)
- [x] `instrument-queue.ts` — FIFO ordering, dedup on resolved instruments (`electron/main/services/orchestration/cycle/scheduling/__tests__/instrument-queue.test.ts`)

### 10.5 Market hours

- [x] `market-hours-service.ts` (`electron/main/services/orchestration/cycle/__tests__/market-hours-service.test.ts`)

### 10.6 Trade monitor (lifecycle)

- [x] `trade-monitor.ts` — open position monitoring, exit triggers, PnL updates, force-close (`electron/main/services/orchestration/lifecycle/__tests__/trade-monitor.test.ts`)
- [x] Exit policy integration — stop-loss, take-profit, time-based exit, max-hold days (`electron/main/services/orchestration/lifecycle/__tests__/trade-monitor.test.ts`)
- [x] **Monitor independence** — `TradeMonitor` ticks while session is `paused` / `monitoring_only` (orchestrator intake paused, exits still managed) (`electron/main/services/orchestration/lifecycle/__tests__/trade-monitor.test.ts`, `resilience-doctrine.test.ts`)
- [x] Monitor survives broker quote failures on one tick — retries next poll without session escalation (`electron/main/services/orchestration/lifecycle/__tests__/trade-monitor.test.ts`)
- [x] Trade closed → stats update → autopsy trigger; selector restart only when flat and runtime active

### 10.7 Integration: golden paths

- [x] Scripted worker outputs → buy decision (no LLM) (`electron/main/services/orchestration/__tests__/scripted-golden-path.integration.test.ts`)
- [x] Mock trade rehearsal — full mock cycle (`electron/main/services/orchestration/__tests__/mock-trade-rehearsal.integration.test.ts`)
- [x] Runtime resilience — spend cap + capacity outcomes (`electron/main/services/orchestration/cycle/__tests__/runtime-resilience.integration.test.ts`)
- [x] **EDGAR experience** — signal → catalyst-two-call → risk → mock order → monitor → close
- [x] **Rules mean-reversion** — timer tick → rules engine → decision → mock order
- [x] **Rules trend-following** — timer tick → trend rules → mock order
- [x] **BTC momentum breakout** — crypto timer → rules pipeline → Coinbase mock order
- [x] **Prediction event** — event signal → full pipeline → Polymarket mock order
- [x] **Approval-required path** — decision → approval pending → capital reserved → approve → order (`electron/main/services/orchestration/__tests__/orchestration-golden-paths.integration.test.ts`)
- [x] **Approval rejection** — decision → reject → capital released → session stays active → next signal (`electron/main/services/orchestration/__tests__/orchestration-golden-paths.integration.test.ts`)
- [x] **Selector-only path** — no signal → selector discovers → validates → trades
- [x] **Signal FIFO** — two signals queued → first completes (including failure terminal) before second starts (`electron/main/services/orchestration/__tests__/orchestration-golden-paths.integration.test.ts`, `resilience-doctrine.test.ts`)
- [x] **Concurrent sessions** — two sessions, isolated state, no cross-contamination
- [x] **Broker down during order** — order fails → trade rejected → capital released → session active → delayed refill (`electron/main/services/orchestration/__tests__/orchestration-golden-paths.integration.test.ts`, `resilience-doctrine.test.ts`)
- [x] **Provider flapping** — 2 transient LLM failures then success → session never `attention_required`
- [x] **3 transient streak** — 3 consecutive transient failures → `attention_required` with explicit event message (`electron/main/services/orchestration/__tests__/resilience-doctrine.test.ts`, `orchestrator-step.test.ts`)

---

## 11. Session management (`electron/main/services/session/`)

### 11.1 Lifecycle services

- [x] `session-service.ts` — start/pause/resume/stop (`electron/main/services/session/__tests__/session-service.test.ts`)
- [x] `session-runtime-manager.ts` (`electron/main/services/session/__tests__/session-runtime-manager.test.ts`)
- [x] `runtime-manager.ts` (`electron/main/services/session/__tests__/runtime-manager.test.ts`)
- [x] `write-service.ts` — CRUD, archive, duplicate (`electron/main/services/session/__tests__/write-service.test.ts`)
- [x] `template-service.ts` (`electron/main/services/session/__tests__/template-service.test.ts`)
- [x] `session-trade-state.ts` (`electron/main/services/session/__tests__/session-trade-state.test.ts`)
- [x] `session-startup-recovery.ts` — crash recovery (`electron/main/services/session/__tests__/session-startup-recovery.test.ts`)
- [x] `shutdown-coordinator.ts` (`electron/main/services/session/__tests__/shutdown-coordinator.test.ts`)
- [x] `runtime-rpc-bridge.ts` — utility-process RPC (`electron/main/services/session/__tests__/runtime-rpc-bridge.test.ts`)
- [x] `listing-service.ts` — session list/summary aggregation (`electron/main/services/session/__tests__/listing-service.test.ts`)

### 11.2 Strategy context

- [x] `posture-signal-compatibility` (`electron/main/services/session/__tests__/posture-signal-compatibility.test.ts`)
- [x] `session-strategy-context-service.ts` — aggregated strategy config (`electron/main/services/session/__tests__/session-strategy-context-service.test.ts`)
- [x] `session-strategy-config.ts` — config resolution from experience + overrides (`electron/main/services/session/__tests__/session-strategy-config.test.ts`)

### 11.3 Preflight (6 checks)

- [x] `task-boundary-check.ts` — task boundary validation (`electron/main/services/session/preflight/task-boundary-check.test.ts`)
- [x] `provider-credentials-check.ts` — AI/search credentials present (`electron/main/services/session/preflight/provider-credentials-check.test.ts`)
- [x] `broker-reachability-check.ts` — broker connectivity (mocked) (`electron/main/services/session/preflight/broker-reachability-check.test.ts`)
- [x] `broker-allocation-check.ts` — allocation sums, min capital (`electron/main/services/session/preflight/broker-allocation-check.test.ts`)
- [x] `selector-config-check.ts` (`electron/main/services/session/preflight/selector-config-check.test.ts`)
- [x] `instrument-conflict-check.ts` (`electron/main/services/session/preflight/instrument-conflict-check.test.ts`)
- [x] `runPreflight()` integration — all 6 pass → start allowed; each failure → actionable error with check name (`electron/main/services/session/preflight/preflight.integration.test.ts`)

### 11.4 Session integration

- [x] `session-onboarding.integration.test.ts` — create → configure → start (`electron/main/services/session/__tests__/session-onboarding.integration.test.ts`)
- [x] Onboarding with each of **6** experiences succeeds preflight (`electron/main/services/session/__tests__/session-onboarding.integration.test.ts`)
- [x] Template use → session created with correct defaults (`electron/main/services/session/__tests__/session-onboarding.integration.test.ts`)
- [x] Duplicate session → independent runtime state (`electron/main/services/session/__tests__/session-onboarding.integration.test.ts`)
- [x] Archive session → excluded from default list, cannot start (`electron/main/services/session/__tests__/session-onboarding.integration.test.ts`)

### 11.5 Experience bootstrap

- [x] `experiences/session-bootstrap.ts` — `loadExperiencePresetBundle` applies experience defaults to new session (`electron/main/experiences/__tests__/session-bootstrap.test.ts`)
- [x] `validate-source-capabilities.ts` — experience ↔ signal compatibility (`electron/main/experiences/__tests__/validate-source-capabilities.test.ts`)
- [x] `experiences/index.ts` — `registerExperience`, `validateExperienceRegistry`, duplicate-id rejection (`electron/main/experiences/__tests__/session-bootstrap.test.ts`)

### 11.6 Multi-runtime hosts

- [x] `session-runtime-host.ts` — in-process runtime host boot/shutdown (`electron/main/services/session/__tests__/session-runtime-host.test.ts`)
- [x] `utility-process-runtime-host.ts` — utility-process runtime host boot/shutdown (`electron/main/services/session/__tests__/utility-process-runtime-host.test.ts`)
- [x] `runtime-worker-deps.ts` — worker deps shape matches orchestrator deps (`electron/main/services/session/__tests__/runtime-worker-deps.test.ts`)
- [x] Host selection via env/config — correct host used for session runtime

---

<!-- ═══ PHASE 4: Integration boundaries (§12–§19) ═══ -->

## 12. Analytics & autopsy (`electron/main/services/analytics/`)

- [x] `paper-scorecard-service.ts` (`electron/main/services/analytics/__tests__/paper-scorecard-service.test.ts`)
- [x] `trade-autopsy-service.ts` (`electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts`)
- [x] `period-autopsy-service.ts` (`electron/main/services/analytics/__tests__/period-autopsy-service.test.ts`)
- [x] `autopsy-export-service.ts` — export autopsy data JSON/markdown/PDF (`electron/main/services/analytics/__tests__/autopsy-export-service.test.ts`)
- [x] `experience-scorecard-service.ts` — experience-level PnL, cost, win rate (`electron/main/services/analytics/__tests__/experience-scorecard-service.test.ts`)
- [x] `research-summary-service.ts` — cross-experience research summary + `research_summaries` persistence (`electron/main/services/analytics/__tests__/research-summary-service.test.ts`)
- [x] `walk-forward-report.ts` — walk-forward metrics used by experience scorecard (`electron/main/services/analytics/__tests__/walk-forward-report.test.ts`)

---

## 13. Backtest & experiments (`electron/main/services/backtest/`)

- [x] `edgar-drift-backtest.ts` (`electron/main/services/backtest/edgar-drift-backtest.test.ts`)
- [x] `edgar-historical-ingest.ts` (`electron/main/services/backtest/edgar-historical-ingest.test.ts`)
- [x] `edgar-ohlcv-join.ts` — filing ↔ OHLCV join (`electron/main/services/backtest/edgar-historical-ingest.test.ts`, `joinFilingsWithOhlcv`)
- [x] `scripts/run-edgar-backtest.ts` — CLI smoke test with fixture data
- [x] Experiment record → compare via IPC round-trip (`electron/main/ipc/__tests__/analytics.ipc.test.ts`)

---

## 14. Replay (`electron/main/services/replay/`)

- [x] `cycle-replay-service.ts` — offline cycle reconstruction (`electron/main/services/replay/__tests__/cycle-replay-service.test.ts`)
- [x] Replay from saved cycle fixture matches original trace (fixtures in `replay/__fixtures__/cycle-replay/`) (`cycle-replay-service.test.ts`)
- [x] `cycle-replay-acceptance.ts` — assertion helpers (`electron/main/services/replay/__tests__/cycle-replay-acceptance.test.ts`)
- [x] Build/save cycle fixture IPC round-trip (`electron/main/ipc/__tests__/replay.ipc.test.ts`)

---

## 15. Experiences (`electron/main/experiences/`)

- [x] `edgar-catalyst/descriptor.ts` — defaults, pipeline, signal config (`electron/main/experiences/__tests__/experience-descriptors.test.ts`)
- [x] `rules-mean-reversion/descriptor.ts` — SPY defaults (`experience-descriptors.test.ts`)
- [x] `rules-qqq-mean-reversion/descriptor.ts` — QQQ defaults (`experience-descriptors.test.ts`)
- [x] `btc-momentum-breakout/descriptor.ts` — BTC crypto defaults (`experience-descriptors.test.ts`)
- [x] `commodities-trend-following/descriptor.ts` — GC/CL futures defaults (`experience-descriptors.test.ts`)
- [x] `prediction-event-edge/descriptor.ts` — Polymarket defaults (`experience-descriptors.test.ts`)
- [x] `experiences/index.ts` — all 6 experiences registered; `validateExperienceRegistry` passes at boot (`session-bootstrap.test.ts`, `experience-descriptors.test.ts`)
- [x] All 6 experiences pass `validate-source-capabilities` with their signal source types (`experience-descriptors.test.ts`)

---

## 16. IPC handlers — request/response contract tests

> Each handler in `electron/main/ipc/` needs: valid payload → success, invalid payload → `VALIDATION_FAILED`, environment guard enforcement where applicable.

### 16.1 Dashboard (`system/dashboard.ts`)

- [x] `dashboard:get-stats` — returns stats matching DB state (`electron/main/ipc/__tests__/dashboard.ipc.test.ts`)
- [x] `dashboard:get-cost-breakdown` — cost aggregation by provider/model (`dashboard.ipc.test.ts`)

### 16.2 Trades (`trading/trades.ts`)

- [x] `trades:list-active` — filters by environment mode (`electron/main/ipc/__tests__/trades.ipc.test.ts`)
- [x] `trades:get-detail` — full trade + agent traces (`trades.ipc.test.ts`)
- [x] `trades:force-close` — closes open trade, emits `trade_closed` (`trades.ipc.test.ts`)
- [x] `trades:approve` — approves pending trade (`trades.ipc.test.ts`)

### 16.3 Trade autopsy (`trading/autopsy.ts`)

- [x] `trades:autopsy:summarize` — generates LLM summary (mocked)
- [x] `trades:autopsy:list` — lists autopsies for trade
- [x] `trades:autopsy:export` — exports autopsy data
- [x] `trades:autopsy:list-lessons` / `add-lesson` / `update-lesson`

### 16.4 Period autopsy (`trading/period-autopsy.ts`)

- [x] `autopsy:period:run` — batch autopsy over date range
- [x] `autopsy:period:list` / `get` / `preview` / `export`
- [x] `autopsy:period:lessons:*` — list, add, update, promote

### 16.5 Approvals (`trading/approvals.ts`)

- [x] `approval:list` — pending approvals for session (`electron/main/ipc/__tests__/approvals.ipc.test.ts`)
- [x] `approval:decide` — approve/reject with capital release (`approvals.ipc.test.ts`)

### 16.6 Experiences (`experiences.ts`)

- [x] `experiences:list` — returns all 6 experiences with id, pipelineId, signalSourceType, capabilities (`electron/main/ipc/__tests__/experiences.ipc.test.ts`)

### 16.7 Analytics (`analytics.ts`)

- [x] `experiences:getScorecard` — scorecard for one experienceId (`electron/main/ipc/__tests__/analytics.ipc.test.ts`)
- [x] `experiences:listScorecards` — all experience scorecards (`analytics.ipc.test.ts`)
- [x] `experiences:listExperiments` — experiments for experienceId (`analytics.ipc.test.ts`)
- [x] `experiences:recordExperiment` — insert experiment row (`analytics.ipc.test.ts`)
- [x] `experiences:compareExperiments` — A/B comparison by experiment ids (`analytics.ipc.test.ts`)
- [x] `experiences:getResearchSummary` — summary + persistence to `research_summaries` (`analytics.ipc.test.ts`)

### 16.8 Session (`session/session.ts`)

- [x] `session:start` — preflight → runtime boot
- [x] `session:pause` / `resume` / `stop` / `force-stop`
- [x] `session:get-status` / `get-execution-progress` (`session.ipc.test.ts` partial — get-status)
- [x] `session:retry-step` / `pause-after-current-step` / `clear-failed-step`
- [x] `session:list` / `create` / `update` / `focus` / `go-global` / `archive` / `duplicate` (`session.ipc.test.ts` partial)
- [x] `session:instrument-cache:get` / `clear`
- [x] `session:buildCycleFixture` / `saveCycleFixture` (`replay.ipc.test.ts`)
- [x] `session:getPaperScorecard` (`replay.ipc.test.ts`)
- [x] `session:getLiveReadiness` / `acknowledgeLiveReadiness` / `testLiveBrokerConnection`

### 16.9 Templates (`session/templates.ts`)

- [x] `template:list` / `create` / `delete` / `use` / `build-payload-from-session`

### 16.10 Strategy (`workspace/strategy.ts`)

- [x] `strategy:get` — full strategy config (`electron/main/ipc/__tests__/strategy.ipc.test.ts`)
- [x] `strategy:get/save-research-posture` (`strategy.ipc.test.ts`)
- [x] `strategy:get/save-rules`
- [x] `strategy:get/save-risk-config` (`strategy.ipc.test.ts`)
- [x] `strategy:get/save-timeframe-config`
- [x] `strategy:save-ai-settings` / `save-ai-phase` / `save-ai-phase-worker`
- [x] `strategy:get-provider-models`
- [x] `strategy:global-presets:*` — list/create/update/delete
- [x] `strategy:workspace-default-model:get` / `save`

### 16.11 Workspace (`workspace/workspace.ts`, `workspace/config.ts`)

- [x] `workspace:view:get` — aggregated workspace view
- [x] `workspace:prefs:patch` — prefs update
- [x] `config:get-strategy` / `save-strategy` (legacy)

### 16.12 Accounts (`workspace/accounts.ts`)

- [x] Broker account helpers (`electron/main/ipc/__tests__/broker-account-helpers.test.ts`)
- [x] `accounts:providers:*` — list/save/delete/test
- [x] `accounts:brokers:*` — list/add/remove/test/test-ephemeral
- [x] `accounts:routing:get` / `update`
- [x] `accounts:save-api-key` — keychain integration (mocked)
- [x] Legacy: `accounts:save-broker` / `test-broker` / `remove-broker` — still wired or explicitly removed

### 16.13 Broker accounts (`trading/broker-accounts.ts`)

- [x] `broker-accounts:list` / `refresh-balance` / `update-settings`

### 16.14 Signals (`signals.ts`)

- [x] `signals:sources:*` — list/create/update/delete/enable/disable/test
- [x] `signals:events:list`
- [x] `signals:dead-letters:list` / `replay`
- [x] `signals:sessions:get-subscriptions` / `set-subscriptions` / `get-readiness`

### 16.15 Events (`system/events.ts`)

- [x] `events:list` — filter by session/type
- [x] `events:get-agent-traces` / `get-agent-traces-by-cycle`
- [x] `events:get-messages-by-cycle`
- [x] `events:get-api-call-log`

### 16.16 Developer (`system/developer.ts`)

- [x] `developer:get-settings` / `update-settings`
- [x] `developer:set-log-level` / `stop-log-override`
- [x] `developer:get-scope-diagnostics`
- [x] `developer:export-debug-bundle`
- [x] `developer:open-path`
- [x] `events:list-v2`

### 16.17 IPC infrastructure (`ipc/handle.ts`, `ipc/environment-guards.ts`)

- [x] `handle()` rejects untrusted sender (sub-frame / non-owned webContents) (`electron/main/ipc/__tests__/handle.test.ts`)
- [x] `handle()` maps errors via `toIpcError` — no raw stack traces to renderer (`handle.test.ts`)
- [x] `payloadMeta` / log-safety — sensitive keys flagged in IPC debug logs (`handle.test.ts`)
- [x] Every channel in `channels.ts` has a registered handler in `register.ts` (no orphan channels)

---

## 17. IPC events — main → renderer

> Verify each event fires with correct payload shape when the triggering action occurs.

- [x] `trade_opened` — after broker order fill
- [x] `trade_closed` — after exit or force-close
- [x] `agent_event` — during pipeline execution
- [x] `approval_required` / `approval_resolved`
- [x] `session_started` / `session_stopped` / `session_status_changed`
- [x] `trade_status_changed`
- [x] `selector_run_completed`
- [x] `research_phase_started` / `research_phase_step` / `research_phase_complete` / `research_phase_failed`
- [x] `step:started` / `step:succeeded` / `step:failed` / `step:retrying`
- [x] `broker_balance_updated`
- [x] `stats_update`
- [x] `notification`
- [x] `andon_cord_fired`
- [x] `signal_received` / `signal_delivery_updated` / `signal_dead_lettered`

---

## 18. Environment guards (`electron/main/ipc/environment-guards.ts`)

- [x] `clearFocusIfEnvironmentMismatch` — unfocuses session on mode switch (`electron/main/ipc/__tests__/environment-guards.test.ts`)
- [x] `assertExecutionModeMatchesWorkspace` — rejects mismatched session mode (`environment-guards.test.ts`)
- [x] `assertBrokerModeMatchesWorkspace` — rejects mismatched broker mode (`environment-guards.test.ts`)
- [x] `assertFocusedSessionMatchesWorkspace` — focused session env check (`environment-guards.test.ts`)
- [x] Paper workspace cannot start live session (`environment-guards.test.ts`, `session.ipc.test.ts`)
- [x] Live workspace cannot start paper-only session (`environment-guards.test.ts`)
- [x] Trade list filtered by environment mode (`trades.ipc.test.ts`)

---

## 19. App boot & composition

- [x] `app-services.ts` — all services wire without circular deps
- [x] `electron/main/index.ts` — boot sequence: DB → migrations → services → IPC → window
- [x] `electron/preload/exva-api.ts` — all `channels.*` exposed on `window.exva` with matching method names
- [x] Preload `ExvaApi` interface matches `src/lib/exva.ts` consumer API
- [x] Shutdown — graceful drain, no orphaned intervals/connections
- [x] DB rebuild from scratch (`EXVA_DB_REBUILD_FROM_SCRATCH`) — clean state
- [x] `db/seed.ts` — seed data compatible with fresh migration (if used in dev/E2E)

---

<!-- ═══ PHASE 5: Product verification (§20–§23, §22) ═══ -->

## 20. E2E workflows (Playwright)

### 20.1 Launch & shell

- [x] App launches, main window appears (`e2e/launch-smoke.spec.ts`)
- [x] Renderer reaches Dashboard with empty state (`e2e/dashboard.spec.ts`)
- [x] Preload bridge: `window.exva` exposes all channel methods (`e2e/preload-bridge.spec.ts`)

### 20.2 Account setup

- [x] Add mock broker account → appears in Brokers page
- [x] Add AI provider account (mocked keychain) → appears in Accounts
- [x] Configure broker routing defaults

### 20.3 Session lifecycle (paper)

- [x] Create EDGAR session (IPC seed: mock broker + AI provider + workspace default model) → preflight passes → start (`e2e/helpers/seed-fixtures.ts`, `e2e/session-lifecycle.spec.ts`)
- [x] Seeded session visible on Sessions page (`e2e/session-lifecycle.spec.ts`)
- [x] Create EDGAR session from experience picker UI → configure → start (full UI onboarding)
- [x] Session status shows running; execution progress updates in UI
- [x] Pause → resume → stop — status transitions correct (`e2e/session-lifecycle.spec.ts`)
- [x] Force-stop while cycle running — immediate halt

### 20.4 Trading (mock)

- [x] Mock session produces a trade (deterministic fixture, no LLM variance)
- [x] Trade appears in Trades page; TradeDetail drawer shows traces
- [x] Force-close from UI → trade closed, stats updated
- [x] Pending approval appears in approvals panel → approve → order placed

### 20.5 Signals

- [x] Create signal source → enable → events appear
- [x] Subscribe session to source → readiness check passes
- [x] Dead letter → replay → delivery retried

### 20.6 Analytics

- [x] Trade autopsy overlay generates summary
- [x] Period autopsy runs over date range
- [x] Paper scorecard displays in session drawer
- [x] Leaderboard shows experience scorecards
- [x] Cost breakdown page shows API spend

### 20.7 Strategy config

- [x] Edit research posture, rules, risk, timeframe → persists across reload
- [x] AI phase worker overrides save and load
- [x] Apply preset → config updates

### 20.8 Developer panel

- [x] Events stream in DevPanel
- [x] Agent traces viewable by cycle
- [x] Cycle replay from fixture
- [x] Debug bundle export produces valid archive

### 20.9 Live readiness

- [x] Live readiness modal blocks live session start until acknowledged
- [x] Acknowledgement invalidates on config change
- [x] Test live broker connection (mocked)

### 20.10 Crash recovery

- [x] Kill app mid-session → restart → session rehydrates to correct state
- [x] Open trades resume monitoring after restart

### 20.11 Environment mode

- [x] Switch workspace paper ↔ live (`WorkspaceContextChip`) → sessions/trades filtered correctly (`environment-guards.test.ts`, `trades.ipc.test.ts`)
- [x] Cannot create mismatched-mode session (`session.ipc.test.ts`, `environment-guards.test.ts`)
- [x] Focus session / go-global updates workspace view
- [x] Paper mode chip visible on fresh install (`e2e/environment-mode.spec.ts`)

### 20.12 Navigation — all pages load

- [x] Dashboard (`e2e/navigation.spec.ts`)
- [x] Sessions (`e2e/navigation.spec.ts`)
- [x] Brokers (`e2e/navigation.spec.ts`)
- [x] Trades (`e2e/navigation.spec.ts`)
- [x] Period autopsy (`e2e/navigation.spec.ts`)
- [x] Leaderboard (`e2e/navigation.spec.ts`)
- [x] Strategy (`e2e/navigation.spec.ts`)
- [x] Costs (`e2e/navigation.spec.ts`)
- [x] Signals (`e2e/navigation.spec.ts`)
- [x] Dev panel (`e2e/navigation.spec.ts`)
- [x] Accounts (`e2e/navigation.spec.ts`)
- [x] TopNav session controls reflect live status

### 20.13 Session UI

- [x] `CreateEditSessionModal` — create and edit session fields
- [x] `SessionTemplatesModal` — template list, use template
- [x] `SessionDetailDrawer` — strategy summary, paper scorecard link
- [x] `SessionExecutionProgress` — step events update UI
- [x] `SessionTable` — filter by status, archive, duplicate actions
- [x] Attention-required sessions navigable from dashboard

### 20.14 Approvals & runtime feedback

- [x] `PendingApprovalsPanel` — lists pending; polling or events refresh list
- [x] `ApprovalDetailModal` — approve/reject with note
- [x] `RuntimeEventToast` — surfaces trade/approval/session events

### 20.15 Trade & autopsy UI

- [x] `TradeDetail` — execution analytics, agent traces, link to autopsy
- [x] `AutopsyPage` overlay — summarize, lessons panel
- [x] `PeriodLessonsPanel` / `LessonsPanel` — lesson CRUD
- [x] `AndonCordCard` — displays when andon cord fires
- [x] `ChatHistoryModal` — agent message history view

### 20.16 Accounts UI

- [x] `AddBrokerModal` — add mock broker
- [x] `AddAiProviderModal` — add AI provider
- [x] `AddSearchProviderModal` — add search provider
- [x] Strategy `ProviderModelPicker` / `CostSummaryCard` — model selection reflects in strategy

---

## 21. Renderer contract tests (recommended)

> Lightweight tests for `src/`, stores, hooks, and IPC client — no full component library needed.

### 21.1 IPC client & types

- [x] `src/lib/exva.ts` — every IPC method maps to correct `channels.*` string (`src/__tests__/exva-contract.test.ts`)
- [x] `src/lib/exva.ts` — method signatures match preload bridge (`exva-contract.test.ts`)
- [x] `src/lib/schemas.ts` — client-side Zod schemas align with main validation
- [x] `src/lib/environment-mode.ts` — mirrors shared `environment-mode.ts` behavior (`src/__tests__/environment-mode.test.ts`)
- [x] `src/lib/types.ts` — key DTO types match shared IPC DTOs

### 21.2 Stores & hooks

- [x] `sessionStore` — status/stats update on `session_status_changed`, `stats_update` (`src/__tests__/stores.test.ts` partial — setters)
- [x] `tradeStore` — trade list updates on `trade_opened` / `trade_closed` (`stores.test.ts` — upsert)
- [x] `workspaceStore` — `loadWorkspaceView` reflects focus + environment mode (`stores.test.ts`)
- [x] `strategyStore` — strategy patch persists via IPC mocks
- [x] `useExvaEvent` — subscribes, delivers payloads, cleans up on unmount (`src/__tests__/listen-event.test.ts`)
- [x] `usePolling` — pauses when session idle (`src/__tests__/use-polling.test.ts` — enabled/disabled)
- [x] `App.tsx` — live readiness gate blocks start until acknowledged

### 21.3 Navigation

- [x] `lib/nav.ts` page keys match `App.tsx` routes and `TopNav` / `AppNavSidebar` (`src/__tests__/nav.test.ts`)

---

## 22. CI & quality gates

- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `bun run format:check` passes
- [x] `bun run check` — full gate (typecheck + lint + format + test)

---

## 23. Critical path smoke script

> Single command that runs the minimum subset proving the app works:

```bash
bun run test:smoke
# or critical unit/integration only:
bun run test:smoke:critical
```

### Minimum viable subset (if full suite too slow)

- [x] All `[x]` unit tests pass (`bun run test`)
- [x] `mock-trade-rehearsal.integration.test.ts` passes (included in `test:smoke:critical`)
- [x] `session-onboarding.integration.test.ts` passes (`scripts/smoke-critical-path.ts`)
- [x] `scripted-golden-path.integration.test.ts` passes (`scripts/smoke-critical-path.ts`)
- [x] `runtime-resilience.integration.test.ts` passes (`scripts/smoke-critical-path.ts`)
- [x] `trading-cycle-context.test.ts` passes (`scripts/smoke-critical-path.ts`)
- [x] `outcome-classifier.test.ts` passes (`scripts/smoke-critical-path.ts`)
- [x] `edgar-drift-backtest.test.ts` passes (`scripts/smoke-critical-path.ts`)
- [x] E2E launch smoke passes (`scripts/smoke-critical-path.ts` → `e2e/launch-smoke.spec.ts`)

---

<!-- ═══ PHASE 3 (continued): Resilience doctrine tests — work before Phase 4 ═══ -->

## 24. Autonomous runtime & failure handling (§24 doctrine tests)

> Maps directly to **Operational resilience doctrine** above. These tests prove the session **does not go down** unless escalation rules fire, and that logs/events capture why.

### 24.1 Outcome classifier (`outcome-classifier.ts`)

- [x] Risk concurrent cap → `session_capacity` (`electron/main/services/orchestration/policy/__tests__/outcome-classifier.test.ts`)
- [x] `BROKER_UNREACHABLE` / `PROVIDER_UNREACHABLE` → `transient`, not `operator_required` (`outcome-classifier.test.ts`)
- [x] `SPEND_CAP_EXCEEDED` / daily loss / profit target → `operator_required` with correct `reasonCategory` (`outcome-classifier.test.ts`)
- [x] `INSTRUMENT_CONFLICT` → `no_trade` (`outcome-classifier.test.ts`)
- [x] `createOrderPolicyError` — gate failures map to `no_trade` vs `operator_required` correctly (`outcome-classifier.test.ts`, `order-policy-gate.test.ts`)

### 24.2 `TradingCycleContext` failure handling

- [x] `no_trade` records failure history, does not change session status (`electron/main/services/orchestration/cycle/__tests__/trading-cycle-context.test.ts`)
- [x] `session_capacity` does not call `setStatus` (`runtime-resilience.integration.test.ts`)
- [x] `operator_required` → `attention_required` (`runtime-resilience.integration.test.ts`)
- [x] `transient` — 1–2 failures keep session `active`; streak counter increments (`resilience-doctrine.test.ts`)
- [x] `transient` — exactly 3 consecutive → `attention_required` + ERROR event with streak message (`resilience-doctrine.test.ts`)
- [x] Successful step after streak → `clearAttentionRequired` + `resetHardFailureStreak` (`orchestrator-step.test.ts`, `resilience-doctrine.test.ts`)
- [x] `failureHistory` pruned after 1h window (`runtime-resilience.integration.test.ts`, `trading-cycle-context.test.ts`)
- [x] `getNearestRetryAt` / `noInstrumentRetryTimer` — delayed refill scheduled and cleared on stop (`cycle-refill.test.ts`, `resilience-doctrine.test.ts`)

### 24.3 Trade cycle terminal paths (`trade-cycle.ts`, `effect-runner.ts`)

- [x] Decision skip → `completeSignalDelivery` rejected + `finishWithoutOpenPosition` — session stays active (`resilience-doctrine.test.ts`, `trade-cycle.test.ts`)
- [x] Risk gate fail → signal rejected (`risk_gate_rejected`) + delayed refill — no `attention_required` (`resilience-doctrine.test.ts`)
- [x] Broker order fail → capital released, trade `rejected`, `trade_closed` emitted, signal rejected — session active (`resilience-doctrine.test.ts`, `effect-runner.test.ts`)
- [x] Uncaught exception in `executeTradeCycle` → `attention_required` only path for trade-cycle crash (`trade-cycle.test.ts`, `resilience-doctrine.test.ts`)
- [x] `pauseIfRequested` — user pause mid-cycle does not leave orphan capital reservations

### 24.4 Selector & signal delivery resilience

- [x] Selector failure (non-operator) → `scheduleCycleRefillAfterDelayIfIdle` with `noInstrumentRetryMinutes` (`cycle-refill.test.ts`)
- [x] `instrument-queue.ts` — no instruments → `no_trade` outcome, session active (`instrument-queue.test.ts`)
- [x] Signal FIFO queue — failure terminal on delivery 1 unblocks delivery 2 (`resilience-doctrine.test.ts`, `orchestration-golden-paths.integration.test.ts`)
- [x] `complete-signal-delivery.ts` — called at every terminal path (traded, rejected, dropped)
- [x] Dead letter only for unrecoverable signal-source errors — not for no-trade cycles

### 24.5 External dependency retries

- [x] `runtime-retry.ts` — 4 retries with backoff `[1s, 2s, 4s, 8s]` before surfacing error (`electron/main/services/llm/__tests__/runtime-retry.test.ts`)
- [x] `runtime-retry.ts` — structured warn logs per attempt with `willRetry` (`runtime-retry.test.ts`)
- [x] Broker adapter mock — simulate down then up within retry window → order succeeds without escalation
- [x] Search adapter mock — transient failure retried inside tool call without session pause

### 24.6 Session lifecycle vs monitor independence

- [x] Stop with open trades → `monitoring_only` drain (`session-service.test.ts`)
- [x] Pause orchestrator → `TradeMonitor` still polls open trades (`resilience-doctrine.test.ts`, `trade-monitor.test.ts`)
- [x] `monitoring_only` → selector blocked (`trade-closed-handler.test.ts`) but monitor exits fire (`trade-monitor.test.ts`)
- [x] Startup recovery — active session demoted to `paused` on boot; open trades on stopped session → safety recovery event (`resilience-doctrine.test.ts`, `session-startup-recovery.test.ts`)
- [x] Resume from `attention_required` — orchestrator restarts (`session-runtime-manager.ts` path)

### 24.7 Observability & operator surfacing

- [x] Every `attention_required` transition has preceding ERROR event explaining why
- [x] DevPanel / Events list shows failure history `reasonCategory` for debugging
- [x] `RuntimeEventToast` surfaces `attention_required` without requiring Trades page
- [x] `api-call-log` captures failed external calls with latency/status for post-mortem
- [x] Debug bundle export includes last N failures + session status timeline

### 24.8 E2E autonomous operation (no babysitting)

- [x] Paper session runs 30+ minutes with intermittent mock broker failures — never stuck without user action unless spend cap hit
- [x] Operator never required for: no-trade streak, broker reject, capacity full, approval reject
- [x] Operator required for: spend cap, missing provider key — UI shows actionable preflight/readiness message

### 24.9 Signal layer (inventory §A, §M, §N)

- [x] Each dead-letter reason (`unsupported_by_experience`, `unsupported_by_signal_source`, `unsupported_by_assigned_broker`, `no_compatible_broker_route`) — session stays `active`; `signal_dead_lettered` emitted
- [x] Paused session → delivery `waiting_for_resume`; resume → `queued` → processing
- [x] `waiting_for_resume` expiry (4h) → terminal `expired`
- [x] Duplicate EDGAR accession → no second delivery
- [x] No subscribers → `dropped_pre_fanout`; session unaffected
- [x] Each `dropReason` in catalog → correct terminal `status` on delivery row
- [x] Dead-letter replay succeeds when config fixed; re-dead-letters when still invalid

### 24.10 Selector & market hours (inventory §B)

- [x] `weekend_utc_market_closed` / `market_holiday` / `exchange_closed` — session active; signal terminal; delayed refill
- [x] Mock session skips exchange-hours filter (`skipExchangeHoursFilter`) — tradable path unchanged
- [x] Selector cap drops excess symbols — logged; enqueued count ≤ `max_concurrent_trades`
- [x] `canScheduleSelector` false when open trades — selector skipped without ERROR escalation
- [x] Signal-triggered selector exception → delivery `expired`; FIFO continues

### 24.11 Risk & order policy gates (inventory §D, §E)

- [x] Each `RiskGateType` denial maps to correct outcome (`api_budget` → operator, `concurrent_cap` → capacity, etc.)
- [x] Wait-for-open / confidence threshold → `no_trade` + `confidence_below_threshold`
- [x] Volatility halt (spread) → `no_trade`; session active
- [x] Each `OrderPolicyGate` failure (`data_freshness`, `price_collar`, `spread`, `strategy`, `idempotency`) → `no_trade`; no `attention_required`
- [x] Order policy `runtime` gate when session paused mid-order — correct outcome; no orphan order

### 24.12 Pipeline tools & spend (inventory §C)

- [x] `assertSessionDataSpendAvailable` / worker spend guard → `operator_required` without step auto-retry loop (`runtime-resilience.integration.test.ts`)
- [x] `data-spend-guard` in market tools — blocks tool call, does not crash runtime (`electron/main/services/tools/__tests__/data-spend-guard.test.ts`)
- [x] Tool HTTP 408/429/5xx → step retry (`provider_transient`); session active until streak
- [x] Non-retryable validation error in tool → `bug` path after step exhaust

### 24.13 Approval, pause, and queue discipline (inventory §G, §H)

- [x] `approval-recheck` failure → `failRecheck`; capital released; session active (`approval-recheck.test.ts`)
- [x] `pauseAfterCurrentStep` mid-pipeline → `paused`; no trade cycles enqueued from in-flight selector
- [x] `cycle-refill` does not run while `attention_required` (`cycle-refill.test.ts`)
- [x] Orchestrator stop → `releaseApprovalsAndCapital`; pending approvals resolved (`resilience-doctrine.test.ts`)
- [x] `enqueueTask` error → ERROR event only; does not set `attention_required` (unless child escalates)

### 24.14 Monitor & startup recovery (inventory §I, §J)

- [x] `TradeMonitor.tick` broker quote failure — next poll retries; session status unchanged (`trade-monitor.test.ts`)
- [x] Exit policy close on paused session — trade closes; stats update (`trade-monitor.test.ts`)
- [x] Startup: active → paused demotion; open trades still monitored (`resilience-doctrine.test.ts`, `session-startup-recovery.test.ts`)
- [x] Startup: stopped + open trades → safety recovery WARN event (`resilience-doctrine.test.ts`)
- [x] Startup: broker reconcile timeout per trade → WARN event; session not `attention_required`
- [x] `repairStaleRunningSteps` — stale running steps marked failed/retrying

### 24.15 Preflight boundary (inventory preflight table)

- [x] Each preflight check failure blocks `session:start` with actionable message — does not start runtime (`preflight.integration.test.ts`)
- [x] Runtime spend cap hit **after** successful start → `attention_required` (not preflight) (`runtime-resilience.integration.test.ts`)
- [x] Live readiness / ack separate from preflight — blocks live start only

### 24.16 Analytics isolation (inventory §K)

- [x] `andon_cord_fired` — does not change `session.status` (`resilience-doctrine.test.ts`)
- [x] Period autopsy run failure — trading session continues unaffected

---

## Completion tracker

### By phase

| Phase                     | Sections     | Total    | Done     | Remaining |
| ------------------------- | ------------ | -------- | -------- | --------- |
| 1. Foundation & contracts | §0–§2        | ~81      | ~81      | 0         |
| 2. Domain services        | §3–§9        | ~130     | ~130     | 0         |
| 3. Runtime & resilience   | §10–§11, §24 | ~169     | ~169     | 0         |
| 4. Integration boundaries | §12–§19      | ~117     | ~117     | 0         |
| 5. Product verification   | §20–§23, §22 | ~66      | ~66      | 0         |
| **Total**                 |              | **~593** | **~593** | **0**     |

### By layer

| Layer                   | Phase | Total items | Done     | Remaining |
| ----------------------- | ----- | ----------- | -------- | --------- |
| 0. Shared contracts     | 1     | ~38         | ~38      | 0         |
| 1. Database             | 1     | ~36         | ~36      | 0         |
| 2. Infrastructure       | 1     | 7           | 7        | 0         |
| 3. LLM                  | 2     | 13          | 13       | 0         |
| 4. Search               | 2     | 6           | 6        | 0         |
| 5. Broker               | 2     | 13          | 13       | 0         |
| 6. Signals              | 2     | 14          | 14       | 0         |
| 7. Signal engines       | 2     | ~22         | ~22      | 0         |
| 8. Pipeline             | 2     | ~55         | ~55      | 0         |
| 9. Risk                 | 2     | 7           | 7        | 0         |
| 10. Orchestration       | 3     | ~42         | ~42      | 0         |
| 11. Session             | 3     | ~32         | ~32      | 0         |
| 24. Resilience doctrine | 3     | ~95         | ~95      | 0         |
| 12. Analytics           | 4     | 7           | 7        | 0         |
| 13. Backtest            | 4     | 5           | 5        | 0         |
| 14. Replay              | 4     | 4           | 4        | 0         |
| 15. Experiences         | 4     | 8           | 8        | 0         |
| 16. IPC handlers        | 4     | ~62         | ~62      | 0         |
| 17. IPC events          | 4     | 18          | 18       | 0         |
| 18. Environment guards  | 4     | 7           | 7        | 0         |
| 19. App boot            | 4     | 6           | 6        | 0         |
| 20. E2E                 | 5     | ~48         | ~48      | 0         |
| 21. Renderer            | 5     | 14          | 14       | 0         |
| 22. CI gates            | 5     | 4           | 4        | 0         |
| **Total**               |       | **~593**    | **~593** | **0**     |

> Counts are approximate — each checkbox is one obligation; sub-bullets in IPC/E2E sections may bundle related channels.

---

## Enhanced prompt (for reuse)

Use this prompt to regenerate or extend this checklist:

```
Review the Exva codebase at /Users/ken/Documents/workspace/Exva using deep code review skills.

Create ONLY a checklist in docs/reviews/ — no prose review report.

Requirements:
1. Map every subsystem: shared contracts, DB/repos, services, IPC channels (request + event), pipelines, experiences, orchestration, risk, analytics, backtest, preload bridge, renderer pages/stores, E2E workflows.
2. Each checkbox = one specific unit or integration test that must pass for the application to ACTUALLY work.
3. Mark [x] for tests that already exist (cite the test file). Mark [ ] for gaps.
4. Include IPC handler contract tests for every channel in `electron/shared/ipc/channels.ts` plus `ipc/handle.ts` security checks.
5. Include integration tests for each user workflow: account setup → session create → preflight → start → signal/trade cycle → monitor → close → autopsy.
6. Include deterministic mock/fixture paths — never require live LLM or broker for unit/integration tests.
7. Include E2E Playwright scenarios for every nav page and UI-critical flows (sessions, trades, approvals, autopsy, strategy, signals, dev panel).
8. Add completion tracker table and a "minimum viable subset" smoke command (`bun run check`, `test:e2e`, `backtest:edgar`).
9. The checklist must be exhaustive — if a service/repo/handler/page exists in code, it must appear here.
10. Cross-check `register.ts` handler list vs `channels.ts` — no orphan or missing channels.
11. Include **Operational resilience doctrine**: complete failure inventory by layer (signals, selector, pipeline, risk, order policy, broker, approval, monitor, startup, analytics), outcome→session-status rules, retry/escalation thresholds, AppError mapping, dropReason/dead-letter catalogs, trade/monitor independence, logging contract, and §24 tests for **every inventory row**.
```

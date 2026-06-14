# Exva Complete Test Checklist

> **Purpose:** Every checkbox below is a test that must exist and pass for confidence that Exva **actually works** end-to-end — not just compiles — and that it **keeps working without operator babysitting** when brokers, providers, or markets misbehave. Run `bun run test` (Vitest) and `bun run test:e2e` (Playwright). Offline edge validation: `bun run backtest:edgar`.
>
> **Legend:** `[x]` = test exists today · `[ ]` = test needed · **(file)** = existing test location
>
> **Coverage today:** 84 Vitest files, 1 Playwright spec. This checklist identifies **~530** discrete test obligations; **~18%** are implemented (`[x]`).
>
> **Review basis:** Full-system inventory (main/renderer/shared/preload), IPC channel audit (`channels.ts` + `register.ts`), all repos/services/pipeline engines, experience registry, renderer pages/components, and gap analysis against `*.test.ts` / `*.spec.ts` (2026-06-13, gap-fill pass).

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
| **1** | Foundation & contracts | [§0](#0-shared-contracts--validation), [§1](#1-database--persistence), [§2](#2-infrastructure-services)                                                                                                     | ~81    | ~6    | Shared types validate; every repo round-trips; event bus + secrets work in isolation                                          |
| **2** | Domain services        | [§3](#3-llm-runtime-electronmainservicesllm)–[§9](#9-risk--capital-electronmainservicesrisk)                                                                                                                | ~130   | ~41   | LLM/broker/signal/pipeline/risk services covered with deterministic mocks — no live APIs                                      |
| **3** | Runtime & resilience   | [§10](#10-orchestration--trading-lifecycle-electronmainservicesorchestration), [§11](#11-session-management-electronmainservicessession), [§24](#24-autonomous-runtime--failure-handling-24-doctrine-tests) | ~169   | ~31   | Golden trade paths pass; every failure-inventory row has a doctrine test; session stays `active` unless escalation rules fire |
| **4** | Integration boundaries | [§12](#12-analytics--autopsy-electronmainservicesanalytics)–[§19](#19-app-boot--composition), [§15](#15-experiences-electronmainexperiences)                                                                | ~117   | ~8    | Every IPC channel + event wired; boot/shutdown clean; experiences + analytics paths tested                                    |
| **5** | Product verification   | [§20](#20-e2e-workflows-playwright)–[§23](#23-critical-path-smoke-script), [§22](#22-ci--quality-gates)                                                                                                     | ~66    | ~1    | Playwright covers nav + critical flows; renderer stores react to events; `bun run check` + smoke script green                 |

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

- [ ] Structured log: `sessionId`, `cycleId`, `stage`, `outcome`, `reasonCategory`, `errorCode` (where applicable)
- [ ] `events` row via `emitEvent` with level `WARN` or `ERROR` matching `outcomeLevel`
- [ ] `failureHistory` entry with `retryAt` when a delayed refill is scheduled
- [ ] IPC `agent_event` / `research_phase_failed` / `step:failed` where UI/DevPanel consumers expect it
- [ ] No raw secrets in logs (`log-safety.ts` redaction verified)

---

<!-- ═══ PHASE 1: Foundation & contracts (§0–§2) ═══ -->

## 0. Shared contracts & validation

### 0.1 Domain models (`electron/shared/domain/`, `electron/shared/domain.ts`)

- [x] Session strategy/timeframe helpers, `canTransition`, `isSessionEditable` (`electron/shared/__tests__/domain.test.ts`)
- [ ] `domain.ts` re-exports — parity with `domain/*.ts` exports (no drift)
- [ ] `domain/session.ts` — session summary/status shapes
- [ ] `domain/enums.ts` — enum literals exhaustive in Zod
- [ ] `environment-mode.ts` — `sessionMatchesEnvironment`, `executionModeForEnvironment` for paper/live matrix
- [ ] `experience.ts` — experience descriptor shape validation
- [ ] `autopsy.ts` — lesson promotion ladder transitions, export formats
- [ ] `signals.ts` — signal source config discriminated unions (edgar_8k, timer, web_search, prediction_event, mock, manual)
- [ ] `signal-dead-letters.ts` — dead-letter reason codes and replay eligibility
- [ ] `signal-source-capabilities.ts` — capability flags per source type
- [ ] `trade.ts` — trade lifecycle status transitions, execution analytics fields, touch/cost columns
- [ ] `workspace.ts` — workspace prefs defaults and patch semantics
- [ ] `prediction-event-triggers.ts` — trigger matching logic
- [ ] `mock-scenario.ts` — scenario fixture schema validation
- [ ] `promotion-ladder.ts` — lesson promotion eligibility

### 0.2 Instruments (`electron/shared/instruments/`)

- [x] `trade-exit-analytics.ts` — exit reason classification (`electron/shared/instruments/__tests__/trade-exit-analytics.test.ts`)
- [ ] `edgar-item-codes.ts` — item code parsing, whitelist filtering, materiality tiers
- [ ] `edgar-tradability.ts` — tradability gate per filing type + market cap
- [ ] `filing-polarity.ts` — bullish/bearish/neutral classification from item codes
- [ ] `filing-signal-stubs.ts` — stub signal construction for tests
- [ ] `post-filing-reaction.ts` — stale-move detection thresholds
- [ ] `us-market-holidays.ts` — holiday calendar, early close, weekend handling
- [ ] `session-instrument-classes.ts` — instrument class compatibility matrix
- [ ] `experience-launchability.ts` — launchability pre-check per experience
- [ ] `search-providers.ts` — provider capability flags

### 0.3 IPC DTOs & validation (`electron/shared/ipc/`, `electron/shared/validation/`)

- [ ] Every `channels.*` payload in `dto.ts` / `endpoints.ts` validates with Zod on malformed input
- [ ] `schemas.ts` — shared validation schemas reject unknown fields and coerce types correctly

### 0.4 AI contracts (`electron/shared/ai/`)

- [ ] `effective-ai-phase-config.ts` — phase config merge (session overrides + presets + defaults)
- [ ] `ai-phase-config.ts` — base phase config schema
- [ ] `ai-phase.ts` — phase/stage identifiers
- [ ] `trade-signals.ts` — signal action/confidence/sizing bounds
- [ ] `selector-candidate.ts` — candidate schema, rejection reasons
- [ ] `selector-diagnostics.ts` — diagnostics payload shape
- [ ] `ai-phase-trace.ts` — trace assembly shape for replay
- [ ] `worker-prompt-payload.ts` — worker prompt payload assembly

### 0.5 Shared infra (`electron/shared/infra/`)

- [ ] `errors.ts` — `AppError` codes, `toIpcError` mapping for renderer-safe messages

---

## 1. Database & persistence

### 1.1 Schema & migrations

- [x] Fresh DB migration applies cleanly (`electron/main/db/migrations.test.ts`)
- [ ] Migration is idempotent on re-run
- [ ] All **45** tables in `schema.ts` have at least one round-trip CRUD test (including `research_summaries`, `experience_experiments`, `developer_settings`, `runtime_log_overrides`, `capital_reservations`)
- [ ] Foreign key constraints enforced (session → trades, trades → agent_runs, signal deliveries → events, etc.)
- [ ] `mappers.ts` — row ↔ domain mapping for every repo (null handling, JSON columns, `strategy_config_json`)

### 1.2 Agent repos

- [ ] `agent-runs-repo` — create, list by cycle, token/cost aggregation
- [ ] `agent-messages-repo` — store tool calls, list by run, ordered retrieval

### 1.3 Broker repos

- [x] `broker-accounts-repo` — CRUD, balance fields (`electron/main/db/repositories/brokers/broker-accounts-repo.test.ts`)
- [ ] `broker-routing-repo` — default routing, session overrides, instrument-class routing

### 1.4 Experience repos

- [ ] `experience-experiments-repo` — record, list, compare experiments

### 1.5 Market repos

- [ ] `instrument-cache-repo` — get/set/clear per session, TTL semantics

### 1.6 Preset repos (5)

- [ ] `global-presets-repo` — list/create/update/delete
- [ ] `risk-presets-repo` — preset round-trip
- [ ] `timeframe-presets-repo` — preset round-trip
- [ ] `research-posture-presets-repo` — preset round-trip
- [ ] `trade-rule-presets-repo` — preset round-trip

### 1.7 Session repos (12+)

- [ ] `session-repo` — create, update, archive, duplicate, focus, list, status transitions
- [x] `session-strategies-repo` — strategy migration (`electron/main/db/repositories/sessions/session-strategy-migration.test.ts`)
- [ ] `session-ai-phases-repo` — per-phase model/settings persistence
- [ ] `session-ai-settings-repo` — worker guidance markdown
- [ ] `session-broker-assignments-repo` — allocation percentages sum to 100%
- [ ] `session-execution-steps-repo` — step state machine persistence
- [ ] `session-research-posture-repo` — posture config round-trip
- [ ] `session-risk-config-repo` — risk limits, stops, spend caps
- [ ] `session-selector-settings-repo` — selector retry intervals
- [ ] `session-templates-repo` — template CRUD
- [ ] `session-timeframe-config-repo` — holding style persistence
- [ ] `session-trade-rules-repo` — entry/exit rules, side bias

### 1.8 System repos

- [ ] `events-repo` — append, list, filter by session/cycle
- [x] `stats-repo` — dashboard aggregates (`electron/main/db/repositories/system/stats-repo.test.ts`)
- [ ] `api-call-log-repo` — external API audit log append/list

### 1.9 Trade repos

- [ ] `trades-repo` — full lifecycle: pending → open → closed, PnL, force-close
- [ ] `trade-approvals-repo` — pending approval CRUD, decide transitions
- [ ] `trade-autopsies-repo` — per-trade autopsy storage
- [ ] `period-autopsies-repo` — period autopsy storage
- [ ] `autopsy-lessons-repo` — lesson CRUD, promote
- [ ] `capital-reservations-repo` — reserve/release during approval

### 1.10 Workspace repos

- [ ] `provider-accounts-repo` — AI + search provider CRUD
- [x] `workspace-prefs-repo` — prefs get/patch (`electron/main/db/repositories/workspace/workspace-prefs-repo.test.ts`)

### 1.11 Signal repos (`services/signals/repos/`)

- [ ] `signal-sources-repo` — CRUD, enable/disable
- [ ] `signal-events-repo` — event append, list, dedup
- [ ] `signal-deliveries-repo` — FIFO per session, delivery state transitions
- [ ] `signal-dead-letters-repo` — dead letter storage, replay clears queue
- [ ] `cik-ticker-cache` — CIK → ticker resolution cache hit/miss

---

## 2. Infrastructure services

### 2.1 Event bus & notifications

- [ ] `event-bus.ts` — subscribe, publish, unsubscribe, no listener leaks
- [ ] `event-bus-observer.ts` — logs events without throwing
- [ ] `notification-service.ts` — desktop notification triggered on trade/approval events

### 2.2 Secrets & logging

- [ ] `secrets-service.ts` — keychain save/retrieve/delete (mock keytar)
- [ ] `log-safety.ts` — redacts API keys from log output
- [ ] `log.ts` — structured log levels respected

### 2.3 Instrument cache service

- [ ] `instrument-cache-service.ts` — get/clear delegates to repo correctly

---

<!-- ═══ PHASE 2: Domain services (§3–§9) ═══ -->

## 3. LLM runtime (`electron/main/services/llm/`)

- [x] `model-pricing.ts` — token cost estimation (`electron/main/services/llm/__tests__/model-pricing.test.ts`)
- [x] `resolve-run-cost.ts` — run cost resolution (`electron/main/services/llm/__tests__/resolve-run-cost.test.ts`)
- [x] `runtime-retry.ts` — provider retry/timeout (`electron/main/services/llm/__tests__/runtime-retry.test.ts`)
- [x] `tool-loop-guard.ts` — repeated tool-call detection (`electron/main/services/llm/__tests__/tool-loop-guard.test.ts`)
- [x] `run-agent-execute.ts` — agent execution path (`electron/main/services/llm/__tests__/run-agent-execute.test.ts`)
- [x] `reasoning-options.ts` — adapter reasoning config (`electron/main/services/llm/adapters/__tests__/reasoning-options.test.ts`)
- [ ] `provider-registry.ts` — lazy adapter init per provider account
- [ ] `runtime.ts` — `LLMRuntime` facade delegates to pipeline runtime
- [ ] `anthropic-adapter.ts` — normalized request/response (mocked HTTP)
- [ ] `openai-adapter.ts` — normalized request/response (mocked HTTP)
- [ ] `openrouter-adapter.ts` — normalized request/response (mocked HTTP)
- [ ] `provider-adapter.ts` — shared adapter interface compliance

---

## 4. Search (`electron/main/services/search/`)

- [x] `sanitize-search-query.ts` — query sanitization (`electron/main/services/search/sanitize-search-query.test.ts`)
- [x] `search-registry.ts` — provider routing (`electron/main/services/search/search-registry.test.ts`)
- [ ] `brave-adapter.ts` — search request/response (mocked)
- [ ] `tavily-adapter.ts` — search request/response (mocked)
- [ ] `duckduckgo-adapter.ts` — search request/response (mocked)
- [ ] `mcp-adapter.ts` — MCP search bridge (mocked)

---

## 5. Broker layer (`electron/main/services/broker/`)

### 5.1 Core services

- [x] `broker-routing-service.ts` — instrument class routing (`electron/main/services/broker/__tests__/broker-routing-service.test.ts`)
- [ ] `broker-service.ts` — quote, order, position facade
- [ ] `broker-registry.ts` — lazy adapter cache per account
- [ ] `broker-capital-service.ts` — session capital allocation
- [ ] `broker-balance-cache-service.ts` — balance cache hit/miss
- [ ] `broker-balance-ticker.ts` — periodic refresh emits `broker_balance_updated`
- [ ] `instrument-normalizer.ts` — symbol canonicalization across brokers

### 5.2 Adapters

- [x] `mock-adapter.ts` — orders, quotes, positions, scenarios (`electron/main/services/broker/adapters/mock-adapter.test.ts`)
- [x] `mock-discovery-fixtures.ts` — scenario fixtures (`electron/main/services/broker/mock/mock-discovery-fixtures.test.ts`)
- [ ] `mock-market-simulator.ts` — price path simulation for open positions
- [ ] `mock-discovery-fixtures.ts` — scenario catalog completeness (extends existing test)
- [ ] `alpaca-adapter.ts` — paper order placement (mocked HTTP)
- [ ] `coinbase-advanced-trade-adapter.ts` — crypto order (mocked HTTP)
- [ ] `tradovate-adapter.ts` — futures order (mocked HTTP)
- [ ] `polymarket-adapter.ts` — prediction market order (mocked HTTP)

---

## 6. Signal sources & delivery (`electron/main/services/signals/`)

### 6.1 Signal sources

- [ ] `edgar-signal-source.ts` — Atom feed poll, 8-K parse, item-code filter, CIK whitelist
- [ ] `web-search-signal-source.ts` — search-triggered signal emission
- [ ] `timer-signal-source.ts` — interval tick, market-hours gating
- [ ] `prediction-event-signal-source.ts` — Polymarket event matching
- [ ] `mock-signal-source.ts` — deterministic fixture signals

### 6.2 Signal runtime

- [ ] `signal-service.ts` — source CRUD, subscription management
- [ ] `signal-bus.ts` — fan-out to subscribed sessions, persist events
- [ ] `signal-source-registry.ts` — runtime instance lifecycle
- [ ] `signal-delivery-lifecycle.ts` — delivery state machine + events
- [x] `signal-delivery-gate.ts` — gate before delivery (`electron/main/services/signals/__tests__/signal-delivery-gate.test.ts`)
- [ ] `complete-signal-delivery.ts` — marks delivery complete, advances FIFO
- [x] `signal-dead-letters-replay.ts` — replay dead letters (`electron/main/services/signals/__tests__/signal-dead-letters-replay.test.ts`)

### 6.3 CIK cache

- [ ] `cik-ticker-cache.ts` — SEC lookup, cache populate, stale refresh

---

## 7. Deterministic signal engines (`electron/main/services/signal/`)

### 7.1 Aggregators

- [x] `technical-aggregator.ts` (`electron/main/services/signal/aggregators/technical-aggregator.test.ts`)
- [x] `fundamental-aggregator.ts` (`electron/main/services/signal/aggregators/fundamental-aggregator.test.ts`)
- [x] `review-aggregator.ts` (`electron/main/services/signal/aggregators/review-aggregator.test.ts`)
- [x] `trade-signal-aggregator.ts` (`electron/main/services/signal/aggregators/trade-signal-aggregator.test.ts`)
- [ ] `catalyst-two-call-aggregator.ts` — EDGAR 2-call merge (partially covered in golden-path integration)

### 7.2 Scoring & selector

- [x] `selector-candidate-merger.ts` (`electron/main/services/signal/scoring/selector-candidate-merger.test.ts`)
- [x] `selector-scoring-engine.ts` (`electron/main/services/signal/scoring/selector-scoring-engine.test.ts`)
- [x] `selector-risk-filter.ts` (`electron/main/services/signal/scoring/selector-risk-filter.test.ts`)
- [x] `selector-submission-builder.ts` (`electron/main/services/signal/scoring/selector-submission-builder.test.ts`)

### 7.3 Rules engines (zero-LLM)

- [ ] `mean-reversion-signal.ts` — SPY/QQQ 15m mean reversion entry/exit
- [ ] `trend-following-signal.ts` — GC/CL 4h trend entry/exit
- [ ] `prediction-market-candidate-engine.ts` — Polymarket candidate extraction/scoring

### 7.3b Signal engine registry (`electron/main/services/signal/registry/`)

- [ ] `signal-engine-registry.ts` — register/resolve engines by id
- [ ] `register-default-engines.ts` — default engine bundle wires at boot
- [ ] `register-trade-signal-engines.ts` — trade-signal engine registration

### 7.4 Execution profile

- [x] `trade-execution-profile.ts` (`electron/main/services/signal/execution/trade-execution-profile.test.ts`)

### 7.5 Policy engines

- [ ] `candidate-validation-service.ts` — pre-pipeline candidate rejection
- [x] `order-policy-gate.ts` (`electron/main/services/orchestration/policy/__tests__/order-policy-gate.test.ts`)
- [x] `outcome-classifier.ts` (`electron/main/services/orchestration/policy/__tests__/outcome-classifier.test.ts`)

---

## 8. Pipeline (`electron/main/services/pipeline/`)

### 8.1 Core runtime

- [ ] `pipeline-runtime.ts` — end-to-end phase execution with mocked LLM
- [x] `worker-graph-scheduler.ts` — dependency batching (`electron/main/services/pipeline/core/worker-graph-scheduler.test.ts`)
- [ ] `concurrent-group-runner.ts` — concurrency limits respected
- [x] `pipeline-config.test.ts` — config resolution (`electron/main/services/pipeline/__tests__/pipeline-config.test.ts`)
- [x] `pipeline-spend-tracker.test.ts` — spend cap enforcement (`electron/main/services/pipeline/__tests__/pipeline-spend-tracker.test.ts`)
- [x] `phase-worker-modes.test.ts` — worker mode config (`electron/main/services/pipeline/__tests__/phase-worker-modes.test.ts`)
- [ ] `ai-phase-config-resolver.ts` — session → effective config
- [ ] `pipeline/effective-ai-phase-config.ts` — catalog validation at boot (`assertValidPipelineDefinitionCatalog`)
- [ ] `pipeline-registry.ts` — pipeline descriptor lookup
- [ ] `trace-assembler.ts` — agent trace assembly per stage
- [ ] `worker-executor.ts` — worker invocation + tool loop integration

### 8.2 Execution

- [x] `extract-terminal-submission.test.ts` (`electron/main/services/pipeline/execution/__tests__/extract-terminal-submission.test.ts`)
- [x] `worker-structured-output.test.ts` (`electron/main/services/pipeline/execution/__tests__/worker-structured-output.test.ts`)
- [x] `worker-tool-requirements.test.ts` (`electron/main/services/pipeline/execution/__tests__/worker-tool-requirements.test.ts`)
- [ ] Stage dispatch — each phase invokes correct workers
- [ ] Trace assembly — agent traces persisted per cycle/stage

### 8.3 Implementations & routing

- [x] `pipeline-router.test.ts` — routes to correct cycle plan (`electron/main/services/pipeline/implementations/__tests__/pipeline-router.test.ts`)
- [x] `phase-definitions.test.ts` — phase worker definitions (`electron/main/services/pipeline/implementations/__tests__/phase-definitions.test.ts`)
- [x] `default-trade-analysis.test.ts` — default cycle plan (`electron/main/services/pipeline/implementations/__tests__/default-trade-analysis.test.ts`)
- [ ] `edgar-8k-analysis.ts` — EDGAR cycle plan (skips selector, catalyst-two-call)
- [ ] `mean-reversion-analysis.ts` — rules-only decision phase
- [ ] `trend-following-analysis.ts` — rules-only decision phase
- [ ] `prediction-event-cycle` (`pipelines.ts`) — event scouts in selector
- [ ] `default-analysis.ts` / `default-analysis-steps.ts` — default cycle step graph
- [ ] `pipeline-descriptor-store.ts` — descriptor registration, duplicate-id rejection
- [ ] `pipelines.ts` — all 5 pipeline descriptors registered with correct signal-source mapping
- [ ] `register-analyses.ts` — instrument analysis registration at boot
- [ ] `analysis-resolver.ts` — resolve analysis kind per instrument class
- [x] `trade-engine-input-builders.test.ts` (`electron/main/services/pipeline/implementations/inputs/__tests__/trade-engine-input-builders.test.ts`)
- [ ] `catalyst-decision-input-builders.ts` — EDGAR input construction
- [ ] `rules-engine-input-builders.ts` — mean reversion inputs
- [ ] `rules-trend-following-input-builders.ts` — trend following inputs

### 8.4 Engines (finalizers, input, entry, cache)

- [ ] `selector-instrument-cache` engine — cache read/write
- [ ] `selector-scope` engine — scope filtering
- [ ] `broker-coverage` engine — broker availability check
- [ ] `prediction-market-candidates` engine — Polymarket candidate extraction
- [ ] `manual-shortlist` entry mode — shortlist seeding
- [ ] `signal-seeded` entry mode — signal-driven entry
- [ ] Finalizer engines delegate to aggregators: `technical-aggregator`, `fundamental-aggregator`, `review-aggregator`, `trade-signal-aggregator`, `selector-submission-builder`, `selector-risk-filter`
- [ ] `worker-output.ts` — worker output normalization

### 8.5 Analysis layer (`electron/main/services/pipeline/analysis/`)

- [ ] `stage-runner.ts` — runs analysis stages in order
- [ ] `interpreter.ts` — interprets worker outputs into phase inputs
- [ ] `services.ts` — analysis service wiring (market data, spend guards)

### 8.6 Phase definitions (`electron/main/services/pipeline/definitions/`)

- [ ] `selector.phase.ts` — selector phase worker graph
- [ ] `technical.phase.ts` — technical phase workers
- [ ] `fundamental.phase.ts` — fundamental phase workers
- [ ] `review.phase.ts` — review phase workers
- [ ] `decision.phase.ts` — decision phase workers
- [ ] `all-phases.ts` / `phase-catalog.ts` — full catalog matches registered pipelines

### 8.7 Prompting

- [x] `pipeline-worker-prompts.test.ts` (`electron/main/services/pipeline/prompting/__tests__/pipeline-worker-prompts.test.ts`)
- [x] `strategy-prompt-context.test.ts` (`electron/main/services/pipeline/prompting/__tests__/strategy-prompt-context.test.ts`)
- [x] `preset-behavior-guidance.test.ts` (`electron/main/services/pipeline/prompting/__tests__/preset-behavior-guidance.test.ts`)

### 8.8 Worker tools

- [x] `worker-tool-factory.test.ts` (`electron/main/services/pipeline/worker-tools/__tests__/worker-tool-factory.test.ts`)
- [ ] `resolve-search-provider.ts` — search provider resolution for workers
- [ ] `data-spend-guard.ts` — data API spend limits in tool calls

### 8.9 LLM-callable tools (`electron/main/services/tools/`)

- [x] `market-tools.test.ts` — quotes/OHLCV (`electron/main/services/tools/__tests__/market-tools.test.ts`)
- [x] `fetch-url-tool.test.ts` (`electron/main/services/tools/__tests__/fetch-url-tool.test.ts`)
- [x] `social-discovery-tools.test.ts` (`electron/main/services/tools/__tests__/social-discovery-tools.test.ts`)
- [ ] `search-tool.ts` — web search via registry
- [ ] `trending-symbols-tool.ts` — trending symbol discovery

---

## 9. Risk & capital (`electron/main/services/risk/`)

- [x] `risk-engine.ts` — pre-trade gate (`electron/main/services/risk/__tests__/risk-engine.test.ts`)
- [x] `exit-policy-evaluator.ts` — exit rules (`electron/main/services/risk/__tests__/exit-policy-evaluator.test.ts`)
- [x] `capital-reservation-service.ts` (`electron/main/services/risk/__tests__/capital-reservation-service.test.ts`)
- [x] `live-readiness-service.ts` (`electron/main/services/risk/__tests__/live-readiness-service.test.ts`)
- [ ] `broker-allocation-gate.ts` — broker allocation checks (`electron/main/services/risk/broker-allocation-gate.ts`)
- [ ] `experience-capital-allocator.ts` — capital split across experiences
- [ ] `correlation-exposure-service.ts` — correlation/exposure limits, `resolveAssetGroup`

---

<!-- ═══ PHASE 3: Runtime & resilience (§10–§11; §24 at end of doc) ═══ -->

## 10. Orchestration & trading lifecycle (`electron/main/services/orchestration/`)

### 10.1 Agent orchestrator

- [x] `agent-orchestrator.ts` — cycle scheduling basics (`electron/main/services/orchestration/cycle/__tests__/agent-orchestrator.test.ts`)
- [ ] Signal listener enqueues trade cycle on delivery
- [ ] Pause stops new cycles; monitor continues
- [ ] Stop drains gracefully; force-stop aborts immediately
- [ ] `orchestrator-step.ts` — `enqueueCycleTask` scheduling
- [ ] `runtime-outcome.ts` — outcome classification helpers

### 10.2 Selector & trade cycle

- [x] `run-selector.ts` (`electron/main/services/orchestration/cycle/__tests__/run-selector.test.ts`)
- [ ] `trade-cycle.ts` — `executeTradeCycle` full phase chain (partially via mock-trade-rehearsal)
- [ ] `run-trade-pipeline.ts` — AI phases for one candidate, `persistTradeAiRuns`
- [ ] `order-placer.ts` — broker order submission + error handling
- [ ] `order-policy-task.ts` — order policy task construction
- [ ] `approval-flow.ts` — human approval required path
- [ ] `approval-recheck.ts` — re-validation after approval delay
- [ ] `post-decision-gates.ts` — post-decision policy
- [ ] `effect-runner.ts` — `persistPendingTradeFromPipeline`, `finalizeOpenedTrade`
- [ ] `trade-record-builder.ts` — trade record construction

### 10.3 Execution step runner

- [x] `trading-step-runner.ts` (`electron/main/services/orchestration/cycle/__tests__/trading-step-runner.test.ts`)
- [x] `trading-cycle-context.ts` (`electron/main/services/orchestration/cycle/__tests__/trading-cycle-context.test.ts`)

### 10.4 Scheduling

- [x] `cycle-refill.ts` (`electron/main/services/orchestration/cycle/scheduling/__tests__/cycle-refill.test.ts`)
- [x] `trade-closed-handler.ts` (`electron/main/services/orchestration/cycle/scheduling/__tests__/trade-closed-handler.test.ts`)
- [ ] `instrument-queue.ts` — FIFO ordering, dedup on resolved instruments

### 10.5 Market hours

- [x] `market-hours-service.ts` (`electron/main/services/orchestration/cycle/__tests__/market-hours-service.test.ts`)

### 10.6 Trade monitor (lifecycle)

- [ ] `trade-monitor.ts` — open position monitoring, exit triggers, PnL updates, force-close
- [ ] Exit policy integration — stop-loss, take-profit, time-based exit, max-hold days
- [ ] **Monitor independence** — `TradeMonitor` ticks while session is `paused` / `monitoring_only` (orchestrator intake paused, exits still managed)
- [ ] Monitor survives broker quote failures on one tick — retries next poll without session escalation
- [ ] Trade closed → stats update → autopsy trigger; selector restart only when flat and runtime active

### 10.7 Integration: golden paths

- [x] Scripted worker outputs → buy decision (no LLM) (`electron/main/services/orchestration/__tests__/scripted-golden-path.integration.test.ts`)
- [x] Mock trade rehearsal — full mock cycle (`electron/main/services/orchestration/__tests__/mock-trade-rehearsal.integration.test.ts`)
- [x] Runtime resilience — spend cap + capacity outcomes (`electron/main/services/orchestration/cycle/__tests__/runtime-resilience.integration.test.ts`)
- [ ] **EDGAR experience** — signal → catalyst-two-call → risk → mock order → monitor → close
- [ ] **Rules mean-reversion** — timer tick → rules engine → decision → mock order
- [ ] **Rules trend-following** — timer tick → trend rules → mock order
- [ ] **BTC momentum breakout** — crypto timer → rules pipeline → Coinbase mock order
- [ ] **Prediction event** — event signal → full pipeline → Polymarket mock order
- [ ] **Approval-required path** — decision → approval pending → capital reserved → approve → order
- [ ] **Approval rejection** — decision → reject → capital released → session stays active → next signal
- [ ] **Selector-only path** — no signal → selector discovers → validates → trades
- [ ] **Signal FIFO** — two signals queued → first completes (including failure terminal) before second starts
- [ ] **Concurrent sessions** — two sessions, isolated state, no cross-contamination
- [ ] **Broker down during order** — order fails → trade rejected → capital released → session active → delayed refill
- [ ] **Provider flapping** — 2 transient LLM failures then success → session never `attention_required`
- [ ] **3 transient streak** — 3 consecutive transient failures → `attention_required` with explicit event message

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
- [ ] `listing-service.ts` — session list/summary aggregation

### 11.2 Strategy context

- [x] `posture-signal-compatibility` (`electron/main/services/session/__tests__/posture-signal-compatibility.test.ts`)
- [ ] `session-strategy-context-service.ts` — aggregated strategy config
- [ ] `session-strategy-config.ts` — config resolution from experience + overrides

### 11.3 Preflight (6 checks)

- [ ] `task-boundary-check.ts` — task boundary validation
- [ ] `provider-credentials-check.ts` — AI/search credentials present
- [ ] `broker-reachability-check.ts` — broker connectivity (mocked)
- [ ] `broker-allocation-check.ts` — allocation sums, min capital
- [x] `selector-config-check.ts` (`electron/main/services/session/preflight/selector-config-check.test.ts`)
- [x] `instrument-conflict-check.ts` (`electron/main/services/session/preflight/instrument-conflict-check.test.ts`)
- [ ] `runPreflight()` integration — all 6 pass → start allowed; each failure → actionable error with check name

### 11.4 Session integration

- [x] `session-onboarding.integration.test.ts` — create → configure → start (`electron/main/services/session/__tests__/session-onboarding.integration.test.ts`)
- [ ] Onboarding with each of **6** experiences succeeds preflight
- [ ] Template use → session created with correct defaults
- [ ] Duplicate session → independent runtime state
- [ ] Archive session → excluded from default list, cannot start

### 11.5 Experience bootstrap

- [ ] `experiences/session-bootstrap.ts` — `loadExperiencePresetBundle` applies experience defaults to new session
- [x] `validate-source-capabilities.ts` — experience ↔ signal compatibility (`electron/main/experiences/__tests__/validate-source-capabilities.test.ts`)
- [ ] `experiences/index.ts` — `registerExperience`, `validateExperienceRegistry`, duplicate-id rejection

### 11.6 Multi-runtime hosts

- [ ] `session-runtime-host.ts` — in-process runtime host boot/shutdown
- [ ] `utility-process-runtime-host.ts` — utility-process runtime host boot/shutdown
- [ ] `runtime-worker-deps.ts` — worker deps shape matches orchestrator deps
- [ ] Host selection via env/config — correct host used for session runtime

---

<!-- ═══ PHASE 4: Integration boundaries (§12–§19) ═══ -->

## 12. Analytics & autopsy (`electron/main/services/analytics/`)

- [x] `paper-scorecard-service.ts` (`electron/main/services/analytics/__tests__/paper-scorecard-service.test.ts`)
- [x] `trade-autopsy-service.ts` (`electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts`)
- [x] `period-autopsy-service.ts` (`electron/main/services/analytics/__tests__/period-autopsy-service.test.ts`)
- [ ] `autopsy-export-service.ts` — export autopsy data (JSON/CSV)
- [ ] `experience-scorecard-service.ts` — experience-level PnL, cost, win rate
- [ ] `research-summary-service.ts` — cross-experience research summary + `research_summaries` persistence
- [ ] `walk-forward-report.ts` — walk-forward metrics used by experience scorecard

---

## 13. Backtest & experiments (`electron/main/services/backtest/`)

- [x] `edgar-drift-backtest.ts` (`electron/main/services/backtest/edgar-drift-backtest.test.ts`)
- [x] `edgar-historical-ingest.ts` (`electron/main/services/backtest/edgar-historical-ingest.test.ts`)
- [x] `edgar-ohlcv-join.ts` — filing ↔ OHLCV join (`electron/main/services/backtest/edgar-historical-ingest.test.ts`, `joinFilingsWithOhlcv`)
- [ ] `scripts/run-edgar-backtest.ts` — CLI smoke test with fixture data
- [ ] Experiment record → compare via IPC round-trip

---

## 14. Replay (`electron/main/services/replay/`)

- [x] `cycle-replay-service.ts` — offline cycle reconstruction (`electron/main/services/replay/__tests__/cycle-replay-service.test.ts`)
- [ ] Replay from saved cycle fixture matches original trace (fixtures in `replay/__fixtures__/cycle-replay/`)
- [ ] `cycle-replay-acceptance.ts` — assertion helpers (`assertSubmissionFires`, `assertZeroAiAuthoredSizing`, etc.)
- [ ] Build/save cycle fixture IPC round-trip (`ipc/session/replay.ts`)

---

## 15. Experiences (`electron/main/experiences/`)

- [ ] `edgar-catalyst/descriptor.ts` — defaults, pipeline, signal config
- [ ] `rules-mean-reversion/descriptor.ts` — SPY defaults
- [ ] `rules-qqq-mean-reversion/descriptor.ts` — QQQ defaults
- [ ] `btc-momentum-breakout/descriptor.ts` — BTC crypto defaults
- [ ] `commodities-trend-following/descriptor.ts` — GC/CL futures defaults
- [ ] `prediction-event-edge/descriptor.ts` — Polymarket defaults
- [ ] `experiences/index.ts` — all 6 experiences registered; `validateExperienceRegistry` passes at boot
- [ ] All 6 experiences pass `validate-source-capabilities` with their signal source types

---

## 16. IPC handlers — request/response contract tests

> Each handler in `electron/main/ipc/` needs: valid payload → success, invalid payload → `VALIDATION_FAILED`, environment guard enforcement where applicable.

### 16.1 Dashboard (`system/dashboard.ts`)

- [ ] `dashboard:get-stats` — returns stats matching DB state
- [ ] `dashboard:get-cost-breakdown` — cost aggregation by provider/model

### 16.2 Trades (`trading/trades.ts`)

- [ ] `trades:list-active` — filters by environment mode
- [ ] `trades:get-detail` — full trade + agent traces
- [ ] `trades:force-close` — closes open trade, emits `trade_closed`
- [ ] `trades:approve` — approves pending trade

### 16.3 Trade autopsy (`trading/autopsy.ts`)

- [ ] `trades:autopsy:summarize` — generates LLM summary (mocked)
- [ ] `trades:autopsy:list` — lists autopsies for trade
- [ ] `trades:autopsy:export` — exports autopsy data
- [ ] `trades:autopsy:list-lessons` / `add-lesson` / `update-lesson`

### 16.4 Period autopsy (`trading/period-autopsy.ts`)

- [ ] `autopsy:period:run` — batch autopsy over date range
- [ ] `autopsy:period:list` / `get` / `preview` / `export`
- [ ] `autopsy:period:lessons:*` — list, add, update, promote

### 16.5 Approvals (`trading/approvals.ts`)

- [ ] `approval:list` — pending approvals for session
- [ ] `approval:decide` — approve/reject with capital release

### 16.6 Experiences (`experiences.ts`)

- [ ] `experiences:list` — returns all 6 experiences with id, pipelineId, signalSourceType, capabilities

### 16.7 Analytics (`analytics.ts`)

- [ ] `experiences:getScorecard` — scorecard for one experienceId
- [ ] `experiences:listScorecards` — all experience scorecards
- [ ] `experiences:listExperiments` — experiments for experienceId
- [ ] `experiences:recordExperiment` — insert experiment row
- [ ] `experiences:compareExperiments` — A/B comparison by experiment ids
- [ ] `experiences:getResearchSummary` — summary + persistence to `research_summaries`

### 16.8 Session (`session/session.ts`)

- [ ] `session:start` — preflight → runtime boot
- [ ] `session:pause` / `resume` / `stop` / `force-stop`
- [ ] `session:get-status` / `get-execution-progress`
- [ ] `session:retry-step` / `pause-after-current-step` / `clear-failed-step`
- [ ] `session:list` / `create` / `update` / `focus` / `go-global` / `archive` / `duplicate`
- [ ] `session:instrument-cache:get` / `clear`
- [ ] `session:buildCycleFixture` / `saveCycleFixture`
- [ ] `session:getPaperScorecard`
- [ ] `session:getLiveReadiness` / `acknowledgeLiveReadiness` / `testLiveBrokerConnection`

### 16.9 Templates (`session/templates.ts`)

- [ ] `template:list` / `create` / `delete` / `use` / `build-payload-from-session`

### 16.10 Strategy (`workspace/strategy.ts`)

- [ ] `strategy:get` — full strategy config
- [ ] `strategy:get/save-research-posture`
- [ ] `strategy:get/save-rules`
- [ ] `strategy:get/save-risk-config`
- [ ] `strategy:get/save-timeframe-config`
- [ ] `strategy:save-ai-settings` / `save-ai-phase` / `save-ai-phase-worker`
- [ ] `strategy:get-provider-models`
- [ ] `strategy:global-presets:*` — list/create/update/delete
- [ ] `strategy:workspace-default-model:get` / `save`

### 16.11 Workspace (`workspace/workspace.ts`, `workspace/config.ts`)

- [ ] `workspace:view:get` — aggregated workspace view
- [ ] `workspace:prefs:patch` — prefs update
- [ ] `config:get-strategy` / `save-strategy` (legacy)

### 16.12 Accounts (`workspace/accounts.ts`)

- [x] Broker account helpers (`electron/main/ipc/__tests__/broker-account-helpers.test.ts`)
- [ ] `accounts:providers:*` — list/save/delete/test
- [ ] `accounts:brokers:*` — list/add/remove/test/test-ephemeral
- [ ] `accounts:routing:get` / `update`
- [ ] `accounts:save-api-key` — keychain integration (mocked)
- [ ] Legacy: `accounts:save-broker` / `test-broker` / `remove-broker` — still wired or explicitly removed

### 16.13 Broker accounts (`trading/broker-accounts.ts`)

- [ ] `broker-accounts:list` / `refresh-balance` / `update-settings`

### 16.14 Signals (`signals.ts`)

- [ ] `signals:sources:*` — list/create/update/delete/enable/disable/test
- [ ] `signals:events:list`
- [ ] `signals:dead-letters:list` / `replay`
- [ ] `signals:sessions:get-subscriptions` / `set-subscriptions` / `get-readiness`

### 16.15 Events (`system/events.ts`)

- [ ] `events:list` — filter by session/type
- [ ] `events:get-agent-traces` / `get-agent-traces-by-cycle`
- [ ] `events:get-messages-by-cycle`
- [ ] `events:get-api-call-log`

### 16.16 Developer (`system/developer.ts`)

- [ ] `developer:get-settings` / `update-settings`
- [ ] `developer:set-log-level` / `stop-log-override`
- [ ] `developer:get-scope-diagnostics`
- [ ] `developer:export-debug-bundle`
- [ ] `developer:open-path`
- [ ] `events:list-v2`

### 16.17 IPC infrastructure (`ipc/handle.ts`, `ipc/environment-guards.ts`)

- [ ] `handle()` rejects untrusted sender (sub-frame / non-owned webContents)
- [ ] `handle()` maps errors via `toIpcError` — no raw stack traces to renderer
- [ ] `payloadMeta` / log-safety — sensitive keys flagged in IPC debug logs
- [ ] Every channel in `channels.ts` has a registered handler in `register.ts` (no orphan channels)

---

## 17. IPC events — main → renderer

> Verify each event fires with correct payload shape when the triggering action occurs.

- [ ] `trade_opened` — after broker order fill
- [ ] `trade_closed` — after exit or force-close
- [ ] `agent_event` — during pipeline execution
- [ ] `approval_required` / `approval_resolved`
- [ ] `session_started` / `session_stopped` / `session_status_changed`
- [ ] `trade_status_changed`
- [ ] `selector_run_completed`
- [ ] `research_phase_started` / `research_phase_step` / `research_phase_complete` / `research_phase_failed`
- [ ] `step:started` / `step:succeeded` / `step:failed` / `step:retrying`
- [ ] `broker_balance_updated`
- [ ] `stats_update`
- [ ] `notification`
- [ ] `andon_cord_fired`
- [ ] `signal_received` / `signal_delivery_updated` / `signal_dead_lettered`

---

## 18. Environment guards (`electron/main/ipc/environment-guards.ts`)

- [ ] `clearFocusIfEnvironmentMismatch` — unfocuses session on mode switch
- [ ] `assertExecutionModeMatchesWorkspace` — rejects mismatched session mode
- [ ] `assertBrokerModeMatchesWorkspace` — rejects mismatched broker mode
- [ ] `assertFocusedSessionMatchesWorkspace` — focused session env check
- [ ] Paper workspace cannot start live session
- [ ] Live workspace cannot start paper-only session
- [ ] Trade list filtered by environment mode

---

## 19. App boot & composition

- [ ] `app-services.ts` — all services wire without circular deps
- [ ] `electron/main/index.ts` — boot sequence: DB → migrations → services → IPC → window
- [ ] `electron/preload/exva-api.ts` — all `channels.*` exposed on `window.exva` with matching method names
- [ ] Preload `ExvaApi` interface matches `src/lib/exva.ts` consumer API
- [ ] Shutdown — graceful drain, no orphaned intervals/connections
- [ ] DB rebuild from scratch (`EXVA_DB_REBUILD_FROM_SCRATCH`) — clean state
- [ ] `db/seed.ts` — seed data compatible with fresh migration (if used in dev/E2E)

---

<!-- ═══ PHASE 5: Product verification (§20–§23, §22) ═══ -->

## 20. E2E workflows (Playwright)

### 20.1 Launch & shell

- [x] App launches, main window appears (`e2e/launch-smoke.spec.ts`)
- [ ] Renderer reaches Dashboard with empty state
- [ ] Preload bridge: `window.exva` exposes all channel methods

### 20.2 Account setup

- [ ] Add mock broker account → appears in Brokers page
- [ ] Add AI provider account (mocked keychain) → appears in Accounts
- [ ] Configure broker routing defaults

### 20.3 Session lifecycle (paper)

- [ ] Create EDGAR session from experience picker → configure → preflight passes → start
- [ ] Session status shows running; execution progress updates
- [ ] Pause → resume → stop — status transitions correct
- [ ] Force-stop while cycle running — immediate halt

### 20.4 Trading (mock)

- [ ] Mock session produces a trade (deterministic fixture, no LLM variance)
- [ ] Trade appears in Trades page; TradeDetail drawer shows traces
- [ ] Force-close from UI → trade closed, stats updated
- [ ] Pending approval appears in approvals panel → approve → order placed

### 20.5 Signals

- [ ] Create signal source → enable → events appear
- [ ] Subscribe session to source → readiness check passes
- [ ] Dead letter → replay → delivery retried

### 20.6 Analytics

- [ ] Trade autopsy overlay generates summary
- [ ] Period autopsy runs over date range
- [ ] Paper scorecard displays in session drawer
- [ ] Leaderboard shows experience scorecards
- [ ] Cost breakdown page shows API spend

### 20.7 Strategy config

- [ ] Edit research posture, rules, risk, timeframe → persists across reload
- [ ] AI phase worker overrides save and load
- [ ] Apply preset → config updates

### 20.8 Developer panel

- [ ] Events stream in DevPanel
- [ ] Agent traces viewable by cycle
- [ ] Cycle replay from fixture
- [ ] Debug bundle export produces valid archive

### 20.9 Live readiness

- [ ] Live readiness modal blocks live session start until acknowledged
- [ ] Acknowledgement invalidates on config change
- [ ] Test live broker connection (mocked)

### 20.10 Crash recovery

- [ ] Kill app mid-session → restart → session rehydrates to correct state
- [ ] Open trades resume monitoring after restart

### 20.11 Environment mode

- [ ] Switch workspace paper ↔ live (`WorkspaceContextChip`) → sessions/trades filtered correctly
- [ ] Cannot create mismatched-mode session
- [ ] Focus session / go-global updates workspace view

### 20.12 Navigation — all pages load

- [ ] Dashboard (`Dashboard.tsx`)
- [ ] Sessions (`SessionsPage.tsx`)
- [ ] Brokers (`BrokersPage.tsx`)
- [ ] Trades (`TradesPage.tsx`)
- [ ] Period autopsy (`PeriodAutopsyPage.tsx`)
- [ ] Leaderboard (`LeaderboardPage.tsx`)
- [ ] Strategy (`StrategyConfig.tsx`)
- [ ] Costs (`CostBreakdown.tsx`)
- [ ] Signals (`SignalSourcesPage.tsx`)
- [ ] Dev panel (`DevPanel.tsx`)
- [ ] Accounts (`AccountsPage.tsx`)
- [ ] TopNav session controls reflect live status

### 20.13 Session UI

- [ ] `CreateEditSessionModal` — create and edit session fields
- [ ] `SessionTemplatesModal` — template list, use template
- [ ] `SessionDetailDrawer` — strategy summary, paper scorecard link
- [ ] `SessionExecutionProgress` — step events update UI
- [ ] `SessionTable` — filter by status, archive, duplicate actions
- [ ] Attention-required sessions navigable from dashboard

### 20.14 Approvals & runtime feedback

- [ ] `PendingApprovalsPanel` — lists pending; polling or events refresh list
- [ ] `ApprovalDetailModal` — approve/reject with note
- [ ] `RuntimeEventToast` — surfaces trade/approval/session events

### 20.15 Trade & autopsy UI

- [ ] `TradeDetail` — execution analytics, agent traces, link to autopsy
- [ ] `AutopsyPage` overlay — summarize, lessons panel
- [ ] `PeriodLessonsPanel` / `LessonsPanel` — lesson CRUD
- [ ] `AndonCordCard` — displays when andon cord fires
- [ ] `ChatHistoryModal` — agent message history view

### 20.16 Accounts UI

- [ ] `AddBrokerModal` — add mock broker
- [ ] `AddAiProviderModal` — add AI provider
- [ ] `AddSearchProviderModal` — add search provider
- [ ] Strategy `ProviderModelPicker` / `CostSummaryCard` — model selection reflects in strategy

---

## 21. Renderer contract tests (recommended)

> Lightweight tests for `src/`, stores, hooks, and IPC client — no full component library needed.

### 21.1 IPC client & types

- [ ] `src/lib/exva.ts` — every IPC method maps to correct `channels.*` string
- [ ] `src/lib/exva.ts` — method signatures match `electron/preload/exva-api.ts` / `dto.ts`
- [ ] `src/lib/schemas.ts` — client-side Zod schemas align with main validation
- [ ] `src/lib/environment-mode.ts` — mirrors shared `environment-mode.ts` behavior
- [ ] `src/lib/types.ts` — key DTO types match shared IPC DTOs

### 21.2 Stores & hooks

- [ ] `sessionStore` — status/stats update on `session_status_changed`, `stats_update`
- [ ] `tradeStore` — trade list updates on `trade_opened` / `trade_closed`
- [ ] `workspaceStore` — `loadWorkspaceView` reflects focus + environment mode
- [ ] `strategyStore` — strategy patch persists via IPC mocks
- [ ] `useExvaEvent` — subscribes, delivers payloads, cleans up on unmount
- [ ] `usePolling` — pauses when session idle (matches `App.tsx` behavior)
- [ ] `App.tsx` — live readiness gate blocks start until acknowledged

### 21.3 Navigation

- [ ] `lib/nav.ts` page keys match `App.tsx` routes and `TopNav` / `AppNavSidebar`

---

## 22. CI & quality gates

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] `bun run check` — full gate (typecheck + lint + format + test)

---

## 23. Critical path smoke script

> Single command that runs the minimum subset proving the app works:

```bash
bun run test && bun run test:e2e && bun run backtest:edgar
```

### Minimum viable subset (if full suite too slow)

- [ ] All `[x]` unit tests pass (`bun run test`)
- [ ] `mock-trade-rehearsal.integration.test.ts` passes
- [ ] `session-onboarding.integration.test.ts` passes
- [ ] `scripted-golden-path.integration.test.ts` passes
- [ ] `runtime-resilience.integration.test.ts` passes
- [ ] `trading-cycle-context.test.ts` passes
- [ ] `outcome-classifier.test.ts` passes
- [ ] `edgar-drift-backtest.test.ts` passes
- [ ] E2E launch smoke passes

---

<!-- ═══ PHASE 3 (continued): Resilience doctrine tests — work before Phase 4 ═══ -->

## 24. Autonomous runtime & failure handling (§24 doctrine tests)

> Maps directly to **Operational resilience doctrine** above. These tests prove the session **does not go down** unless escalation rules fire, and that logs/events capture why.

### 24.1 Outcome classifier (`outcome-classifier.ts`)

- [x] Risk concurrent cap → `session_capacity` (`electron/main/services/orchestration/policy/__tests__/outcome-classifier.test.ts`)
- [ ] `BROKER_UNREACHABLE` / `PROVIDER_UNREACHABLE` → `transient`, not `operator_required`
- [ ] `SPEND_CAP_EXCEEDED` / daily loss / profit target → `operator_required` with correct `reasonCategory`
- [ ] `INSTRUMENT_CONFLICT` → `no_trade`
- [ ] `createOrderPolicyError` — gate failures map to `no_trade` vs `operator_required` correctly

### 24.2 `TradingCycleContext` failure handling

- [x] `no_trade` records failure history, does not change session status (`electron/main/services/orchestration/cycle/__tests__/trading-cycle-context.test.ts`)
- [x] `session_capacity` does not call `setStatus` (`runtime-resilience.integration.test.ts`)
- [x] `operator_required` → `attention_required` (`runtime-resilience.integration.test.ts`)
- [ ] `transient` — 1–2 failures keep session `active`; streak counter increments
- [ ] `transient` — exactly 3 consecutive → `attention_required` + ERROR event with streak message
- [ ] Successful step after streak → `clearAttentionRequired` + `resetHardFailureStreak`
- [ ] `failureHistory` pruned after 1h window (`runtime-resilience.integration.test.ts` partial)
- [ ] `getNearestRetryAt` / `noInstrumentRetryTimer` — delayed refill scheduled and cleared on stop

### 24.3 Trade cycle terminal paths (`trade-cycle.ts`, `effect-runner.ts`)

- [ ] Decision skip → `completeSignalDelivery` rejected + `finishWithoutOpenPosition` — session stays active
- [ ] Risk gate fail → signal rejected (`risk_gate_rejected`) + delayed refill — no `attention_required`
- [ ] Broker order fail → capital released, trade `rejected`, `trade_closed` emitted, signal rejected — session active
- [ ] Uncaught exception in `executeTradeCycle` → `attention_required` only path for trade-cycle crash
- [ ] `pauseIfRequested` — user pause mid-cycle does not leave orphan capital reservations

### 24.4 Selector & signal delivery resilience

- [ ] Selector failure (non-operator) → `scheduleCycleRefillAfterDelayIfIdle` with `noInstrumentRetryMinutes`
- [ ] `instrument-queue.ts` — no instruments → `no_trade` outcome, session active
- [ ] Signal FIFO queue — failure terminal on delivery 1 unblocks delivery 2
- [ ] `complete-signal-delivery.ts` — called at every terminal path (traded, rejected, dropped)
- [ ] Dead letter only for unrecoverable signal-source errors — not for no-trade cycles

### 24.5 External dependency retries

- [ ] `runtime-retry.ts` — 4 retries with backoff `[1s, 2s, 4s, 8s]` before surfacing error
- [ ] `runtime-retry.ts` — structured warn logs per attempt with `willRetry`
- [ ] Broker adapter mock — simulate down then up within retry window → order succeeds without escalation
- [ ] Search adapter mock — transient failure retried inside tool call without session pause

### 24.6 Session lifecycle vs monitor independence

- [x] Stop with open trades → `monitoring_only` drain (`session-service.test.ts`)
- [ ] Pause orchestrator → `TradeMonitor` still polls open trades
- [ ] `monitoring_only` → selector blocked (`trade-closed-handler.test.ts` partial) but monitor exits fire
- [ ] Startup recovery — active session demoted to `paused` on boot; open trades on stopped session → safety recovery event
- [ ] Resume from `attention_required` — orchestrator restarts (`session-runtime-manager.ts` path)

### 24.7 Observability & operator surfacing

- [ ] Every `attention_required` transition has preceding ERROR event explaining why
- [ ] DevPanel / Events list shows failure history `reasonCategory` for debugging
- [ ] `RuntimeEventToast` surfaces `attention_required` without requiring Trades page
- [ ] `api-call-log` captures failed external calls with latency/status for post-mortem
- [ ] Debug bundle export includes last N failures + session status timeline

### 24.8 E2E autonomous operation (no babysitting)

- [ ] Paper session runs 30+ minutes with intermittent mock broker failures — never stuck without user action unless spend cap hit
- [ ] Operator never required for: no-trade streak, broker reject, capacity full, approval reject
- [ ] Operator required for: spend cap, missing provider key — UI shows actionable preflight/readiness message

### 24.9 Signal layer (inventory §A, §M, §N)

- [ ] Each dead-letter reason (`unsupported_by_experience`, `unsupported_by_signal_source`, `unsupported_by_assigned_broker`, `no_compatible_broker_route`) — session stays `active`; `signal_dead_lettered` emitted
- [ ] Paused session → delivery `waiting_for_resume`; resume → `queued` → processing
- [ ] `waiting_for_resume` expiry (4h) → terminal `expired`
- [ ] Duplicate EDGAR accession → no second delivery
- [ ] No subscribers → `dropped_pre_fanout`; session unaffected
- [ ] Each `dropReason` in catalog → correct terminal `status` on delivery row
- [ ] Dead-letter replay succeeds when config fixed; re-dead-letters when still invalid

### 24.10 Selector & market hours (inventory §B)

- [ ] `weekend_utc_market_closed` / `market_holiday` / `exchange_closed` — session active; signal terminal; delayed refill
- [ ] Mock session skips exchange-hours filter (`skipExchangeHoursFilter`) — tradable path unchanged
- [ ] Selector cap drops excess symbols — logged; enqueued count ≤ `max_concurrent_trades`
- [ ] `canScheduleSelector` false when open trades — selector skipped without ERROR escalation
- [ ] Signal-triggered selector exception → delivery `expired`; FIFO continues

### 24.11 Risk & order policy gates (inventory §D, §E)

- [ ] Each `RiskGateType` denial maps to correct outcome (`api_budget` → operator, `concurrent_cap` → capacity, etc.)
- [ ] Wait-for-open / confidence threshold → `no_trade` + `confidence_below_threshold`
- [ ] Volatility halt (spread) → `no_trade`; session active
- [ ] Each `OrderPolicyGate` failure (`data_freshness`, `price_collar`, `spread`, `strategy`, `idempotency`) → `no_trade`; no `attention_required`
- [ ] Order policy `runtime` gate when session paused mid-order — correct outcome; no orphan order

### 24.12 Pipeline tools & spend (inventory §C)

- [ ] `assertSessionDataSpendAvailable` / worker spend guard → `operator_required` without step auto-retry loop
- [ ] `data-spend-guard` in market tools — blocks tool call, does not crash runtime
- [ ] Tool HTTP 408/429/5xx → step retry (`provider_transient`); session active until streak
- [ ] Non-retryable validation error in tool → `bug` path after step exhaust

### 24.13 Approval, pause, and queue discipline (inventory §G, §H)

- [ ] `approval-recheck` failure → `failRecheck`; capital released; session active
- [ ] `pauseAfterCurrentStep` mid-pipeline → `paused`; no trade cycles enqueued from in-flight selector
- [ ] `cycle-refill` does not run while `attention_required`
- [ ] Orchestrator stop → `releaseApprovalsAndCapital`; pending approvals resolved
- [ ] `enqueueTask` error → ERROR event only; does not set `attention_required` (unless child escalates)

### 24.14 Monitor & startup recovery (inventory §I, §J)

- [ ] `TradeMonitor.tick` broker quote failure — next poll retries; session status unchanged
- [ ] Exit policy close on paused session — trade closes; stats update
- [ ] Startup: active → paused demotion; open trades still monitored
- [ ] Startup: stopped + open trades → safety recovery WARN event
- [ ] Startup: broker reconcile timeout per trade → WARN event; session not `attention_required`
- [ ] `repairStaleRunningSteps` — stale running steps marked failed/retrying

### 24.15 Preflight boundary (inventory preflight table)

- [ ] Each preflight check failure blocks `session:start` with actionable message — does not start runtime
- [ ] Runtime spend cap hit **after** successful start → `attention_required` (not preflight)
- [ ] Live readiness / ack separate from preflight — blocks live start only

### 24.16 Analytics isolation (inventory §K)

- [ ] `andon_cord_fired` — does not change `session.status`
- [ ] Period autopsy run failure — trading session continues unaffected

---

## Completion tracker

### By phase

| Phase                     | Sections     | Total    | Done    | Remaining |
| ------------------------- | ------------ | -------- | ------- | --------- |
| 1. Foundation & contracts | §0–§2        | ~81      | ~6      | ~75       |
| 2. Domain services        | §3–§9        | ~130     | ~41     | ~89       |
| 3. Runtime & resilience   | §10–§11, §24 | ~169     | ~31     | ~138      |
| 4. Integration boundaries | §12–§19      | ~117     | ~8      | ~109      |
| 5. Product verification   | §20–§23, §22 | ~66      | ~1      | ~65       |
| **Total**                 |              | **~530** | **~90** | **~440**  |

### By layer

| Layer                   | Phase | Total items | Done    | Remaining |
| ----------------------- | ----- | ----------- | ------- | --------- |
| 0. Shared contracts     | 1     | ~38         | 2       | ~36       |
| 1. Database             | 1     | ~36         | 4       | ~32       |
| 2. Infrastructure       | 1     | 7           | 0       | 7         |
| 3. LLM                  | 2     | 13          | 6       | 7         |
| 4. Search               | 2     | 6           | 2       | 4         |
| 5. Broker               | 2     | 13          | 3       | 10        |
| 6. Signals              | 2     | 14          | 2       | 12        |
| 7. Signal engines       | 2     | ~22         | 10      | ~12       |
| 8. Pipeline             | 2     | ~55         | 14      | ~41       |
| 9. Risk                 | 2     | 7           | 4       | 3         |
| 10. Orchestration       | 3     | ~42         | 12      | ~30       |
| 11. Session             | 3     | ~32         | 14      | ~18       |
| 24. Resilience doctrine | 3     | ~95         | 5       | ~90       |
| 12. Analytics           | 4     | 7           | 3       | 4         |
| 13. Backtest            | 4     | 5           | 3       | 2         |
| 14. Replay              | 4     | 4           | 1       | 3         |
| 15. Experiences         | 4     | 8           | 1       | 7         |
| 16. IPC handlers        | 4     | ~62         | 1       | ~61       |
| 17. IPC events          | 4     | 18          | 0       | 18        |
| 18. Environment guards  | 4     | 7           | 0       | 7         |
| 19. App boot            | 4     | 6           | 0       | 6         |
| 20. E2E                 | 5     | ~48         | 1       | ~47       |
| 21. Renderer            | 5     | 14          | 0       | 14        |
| 22. CI gates            | 5     | 4           | 0       | 4         |
| **Total**               |       | **~530**    | **~90** | **~440**  |

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

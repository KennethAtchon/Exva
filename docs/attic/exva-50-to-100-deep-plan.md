# Exva 50 → 100: Full-System Rearchitecture & Brainstorm — Deep Plan

> **Date:** 2026-07-11  
> **Status:** Archived reference. Finish-line implementation audited 2026-07-13 and found incomplete/unsafe. Execution record: `docs/attic/finish-line/`. Active repairs: `docs/plans/finish-line-fix-up.md`.
> **Owner:** Kenneth Atchon
> **Audience:** Ken + implementing engineers/agents
> **Scope:** The entire Exva codebase — signal architecture (primary), pipeline, brokers, risk, research loop, autonomy, UI, and the delete list. This is the "what would it take to make this an actual hands-free money-printing tool" document.
> **Method:** Full repo read (680 main-process files, 55 SQLite tables), live runtime DB inspection, prior reviews (`trading-engine-debug-and-roadmap-2026-06-26.md`, `profitability-system-review-2026-06-22.md`), and external prior-art research (NautilusTrader, freqtrade, broker API landscape 2026).

---

### TLDR: shortcuts taken

Self-snitch list — every guess and corner cut in this document:

1. **I did not re-run the app end-to-end.** The claim "the system has still never opened a position" is from the live DB (`trades`: 64 rows, 100% `no_trade`, zero `opened_at`), which matches the pre-fix numbers from 06-26. It's possible the app simply hasn't been launched since the bars fix — either way, zero live evidence exists that any strategy works.
2. **Broker recommendations (Kalshi, Tradier, Kraken) are from API-landscape research.** Finish-line doc 03 implements them fully; **IBKR and Schwab are permanently dropped** (no strategy needs their coverage).
3. **Effort estimates (S/M/L/XL) are judgment calls**, not measured.
4. **I assumed the 5-phase pipeline runtime (selector→technical→fundamental→review→decision) is worth keeping as the AI execution substrate.** I read its structure and tests but did not trace every engine binding. If a deeper read finds the dual-registry problem (§4.4) is load-bearing in more places, Phase 2 grows.
5. **The proposed `MarketSignal` union covers the six current source types plus eight proposed ones.** I have not enumerated every field every future source will need — the payload union is designed to be extended, and the first new source added will stress-test it.
6. **Alpha-source ideas in §9.7 are hypotheses, not validated edges.** Every one must pass the research-contract gate before real capital. This doc deliberately does not promise profitability; it builds the machine that can find and verify edge.
7. **I did not audit the renderer page-by-page.** UI consolidation (§9.9) is directional, based on the page list and nav structure, not screenshots of every page.

### User journey

The end-state journey this plan builds toward (hands-free operator, in Ken's words):

1. **Arrive:** Ken opens Exva (or gets a phone notification). The Dashboard answers, in one screen: _am I making money, what's running, what needs me?_ — live P&L, per-experience edge scorecards, promotion ladder status, and an attention queue.
2. **See:** Each experience shows its evidence state: `backtested → paper (n=63/100 trades, expectancy +$0.31 ±0.42) → live-small → live-scaled`, with the numbers that gate the next rung.
3. **Click (rarely):** The only routine human actions are (a) approving a promotion to the next capital rung, (b) answering an approval request on a live trade above the auto-approve threshold, (c) acknowledging a kill-switch trip. Everything else — signal intake, research, sizing, order placement, exits, autopsies, labeling, drift monitoring — runs without him.
4. **What happens next:** Signals arrive from real information sources (filings, options flow, prediction-market dislocations, scans), each gets a typed envelope, a calibrated edge estimate, deterministic gates, and either a sized order or a labeled skip-observation. Overnight, autopsy + labeling jobs turn every decision into training data.
5. **Leave satisfied:** Ken closes the app knowing the system will page him if anything degrades (data starvation, drawdown, drift), and that every dollar of capital is sitting on a strategy that earned its allocation with out-of-sample evidence.

### Core decisions (sign-off required)

| #   | Decision                                                                                                                                                          | Recommendation                                     | Why it needs Ken                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **Kill the "timer is a signal" model.** Scheduled scans become a Scheduler concern; `SignalEvent` becomes a typed `MarketSignal` union carrying real information. | Yes — this is the root of the signal-handling pain | Breaks the current mental model and touches every experience descriptor |
| 2   | **Build the backtester before adding any new alpha source.** No new experience ships without replayable historical validation.                                    | Yes — evidence before features                     | Delays fun new features by ~3-4 weeks                                   |
| 3   | **Broker order contract v2** (limit orders, order types, quantity, streaming) before new brokers; then Kalshi → Tradier → Kraken. **IBKR permanently dropped.**   | Yes                                                | Order of broker work; IBKR/Schwab closed in finish-line 03              |
| 4   | **Merge `services/signal/` + `services/signals/` into one `signals/` domain** and collapse the dual engine registries into the pipeline engine registry.          | Yes                                                | Large mechanical refactor; conflicts with any in-flight work            |
| 5   | **Delete list** (§6.5): mock-rehearsal migration shims, `web_search` signal source, legacy scoring duplicates, archived plan folders out of the repo.             | Yes                                                | Deleting is irreversible-ish; confirm nothing is loved                  |

---

## 1. Executive Summary

Exva today is a beautifully instrumented machine that has never done its job. The codebase has ~680 main-process TypeScript files, 55 database tables, 1,200+ passing unit tests, five experiences, four broker adapters, a five-phase LLM pipeline with spend guards, a capital-reservation system, autopsies, replay, dead-letter queues, and a research/labeling spine — and the production database shows **zero positions ever opened**. Sixty-four trade cycles, sixty-four skips. The June bars-window bug that data-starved every deterministic strategy was found and fixed, but the system has not been re-run to prove the fix, and the deeper structural problems that let a total data outage masquerade as "no setup today" for weeks are only partially addressed.

The signal layer — the part Ken explicitly dislikes — is the clearest symptom of how the system grew. `SignalEvent` is shaped like an SEC EDGAR filing (`accessionNumber`, `filedAt`, `documentUrl`, `companyName`) because EDGAR was the first source; every subsequent source (timers, prediction markets, web search, mocks) squats in those fields and stuffs its real content into an untyped `payloadJson: Record<string, unknown>`. Worse, the dominant "signal" in the system is a **timer tick** — a clock event that carries no information at all — which means the concept of "signal" has been diluted to "reason to wake up." Meanwhile two sibling directories, `services/signal/` (rules engines, aggregators, scoring) and `services/signals/` (sources, bus, deliveries), split one domain across a naming coin-flip, and the pipeline layer keeps a second, parallel engine registry that overlaps the first.

The proposed direction has four movements, in strict order: **(1) prove the machine can trade at all** — run it, watch a real paper position open and close, and add the health monitoring that makes silent starvation impossible; **(2) rebuild the signal domain** around a typed `MarketSignal` union with a Scheduler split out, one merged directory, and a Signal → Candidate → Forecast → Decision ladder where every stage carries calibrated numbers; **(3) build the evidence machine** — a general bar-replay backtester and a point-in-time data store, so strategies are validated before they spend a dollar of AI or capital; **(4) expand outward** — broker order contract v2, new brokers (Kalshi, Tradier, Kraken, IBKR), new information-bearing alpha sources, and the promotion ladder that moves capital automatically from paper to live as evidence accumulates.

What makes this hard is not any single component — it's that Exva's failure mode is _building more machine instead of running the machine_. This document therefore front-loads verification and deletion, and gates every shiny addition behind evidence. The reader should expect: a concrete current-state map (§4), the target architecture (§5), an exhaustive brainstorm of adds/removes/fixes (§9), a phased migration plan (§10), and honest risk accounting (§12).

---

## 2. Problem Statement

### 2.1 What hurts today

**The system has produced zero evidence about its own edge.** Every scorecard, autopsy, calibration bucket, and promotion gate is starving for the one input it needs: closed trades. The live DB has 64 `no_trade` rows and nothing else. The strategies have never been exercised against a single bar of real data (per the 06-26 review, the z-score/breakout/SMA code paths were dead code in production). Until the loop runs end-to-end, all 55 tables of observability instrument nothing.

**The signal abstraction is wrong in four independent ways:**

1. **Wrong shape.** `SignalEvent` (electron/shared/domain/signals.ts:41) hard-codes EDGAR fields at the top level and hides everything else in `payloadJson`. A prediction-market dislocation, an options-flow anomaly, and an 8-K filing have nothing in common except "something happened about an instrument at a time" — the type should say exactly that and then discriminate.
2. **Wrong membership.** `timer` is a `SignalSourceType`. A timer is not information; it is a schedule. Three of five experiences "receive signals" that are actually just cron ticks, which forces the delivery/dead-letter/queue machinery to process non-events and makes the Signal Sources UI page describe clocks.
3. **Wrong location(s).** `services/signal/` and `services/signals/` are two halves of one domain. The first holds rules engines, aggregators, and selector scoring (compute); the second holds sources, bus, gate, deliveries, dead letters (transport). Nobody can guess which import path holds what, and `pipeline/engines/finalizer/` duplicates several of the first directory's aggregators.
4. **Wrong output.** Signals produce `action + confidence` where confidence is an uncalibrated heuristic shape (`min(0.95, |z|/4)`). The profitability review's P2 finding stands: signal strength, forecast probability, and expected value are three different numbers, and the system conflates them, which poisons everything downstream (thresholds, Kelly sizing, promotion decisions).

**The execution contract is too weak to trade well.** `BrokerOrder` supports market-ish orders sized in USD with optional stop/take-profit — no limit orders, no time-in-force, no quantity-denominated orders, no partial-fill model, no order-event stream. For prediction markets and options — the two places Exva's information edge is most plausible — crossing the spread with a market order _is_ the edge, gone. Monitoring is poll-based; close detection latency is a function of poll cadence.

**There is no general backtester.** `edgar-drift-backtest.ts` exists for one source. Every other strategy idea can only be validated by waiting weeks of wall-clock paper trading. That makes iteration on entry rules, thresholds, and sizing effectively impossible — the walk-forward report needs ≥10 closed trades and there have never been any.

**Operational trust is unearned.** The bars outage hid for a multi-day run because "no data" and "no setup" produced identical outcomes. A probe check now warns at session start, but there is still no continuous health model: no "this session has skipped N consecutive cycles for the same reason" alarm, no data-freshness watchdog while running, no notification channel that reaches a human who isn't staring at the app.

### 2.2 Who is affected

One person: Ken, as operator and capital owner. The cost of the current state is (a) zero return on a very large engineering investment, (b) false confidence risk — the huge test suite and observability create the _feeling_ of rigor while the core question (is there edge?) is untested, and (c) every new feature built on the misshapen signal core increases the eventual refactor bill.

### 2.3 Why now

Three reasons. First, the bars fix landed but was never validated — the single highest-value action available (run it) costs almost nothing. Second, the codebase is at an inflection point: five experiences all shoehorned into the EDGAR-shaped envelope is survivable; ten would calcify it permanently. Third, the research spine (observations, labels, contracts, promotion tables) is already built and waiting — the missing pieces (backtester, calibrated forecasts, typed signals) are exactly the ones that turn that spine from decoration into a working evidence loop.

---

## 3. Goals, Non-Goals, and Invariants

**Goals**

| #   | Goal                             | Success Looks Like                                                                                                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Prove end-to-end execution       | ≥1 real paper position opened and closed by the runtime, visible in `trades` with `opened_at`/`closed_at` set, within days of starting Phase 0                           |
| G2  | Signals carry information, typed | `MarketSignal` discriminated union in `shared/domain`; zero uses of the old EDGAR-shaped envelope; timers no longer signals                                              |
| G3  | One signal domain                | Single `electron/main/services/signals/` tree (transport + strategy); `services/signal/` deleted; one engine registry                                                    |
| G4  | Evidence before capital          | Every experience has a runnable backtest against cached historical data; promotion gates read backtest + paper results automatically                                     |
| G5  | Calibrated decisions             | Every trade/skip decision persists `EdgeEstimate` (signal strength, forecast probability, expected net value, uncertainty); confidence heuristics no longer drive sizing |
| G6  | Execution contract v2            | Limit orders, order type, TIF, qty-or-notional, and order-event polling contract shipped; ≥1 adapter (Alpaca) fully implements it                                        |
| G7  | Broaden brokers deliberately     | Kalshi + Tradier + Kraken adapters shipped behind the same contract; IBKR/Schwab permanently dropped                                                                     |
| G8  | Hands-free operation             | Promotion ladder + kill switches + notifications mean the system runs multi-day unattended and pages Ken only on defined conditions                                      |
| G9  | Net-cost honesty                 | AI spend + data spend + execution costs are subtracted in every scorecard and every pre-trade edge gate                                                                  |
| G10 | Smaller, sharper codebase        | Delete list executed; file count and table count go down or hold flat even as capability grows                                                                           |

**Non-Goals**

| #   | Non-Goal                                                      | Why It Is Out Of Scope                                                                                                                                 |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1  | Guaranteed profitability                                      | No plan can promise edge; this plan builds the machine that finds, verifies, sizes, and kills edges honestly                                           |
| N2  | Multi-user / hosted deployment                                | Exva stays local-first, single-operator; no server backend                                                                                             |
| N3  | HFT / latency-sensitive strategies                            | Electron + poll-based adapters can't compete below seconds; edges pursued are minutes-to-days horizon                                                  |
| N4  | Rewriting in Rust/Python or adopting NautilusTrader wholesale | Prior art informs the event/clock/cache separation, but a platform swap throws away 1,200 tests and a working Electron shell                           |
| N5  | Custom-trained ML price models (v1)                           | Calibration of LLM/rules forecasts against outcomes comes first; gradient-boosted feature models are a later experiment on top of the same label spine |
| N6  | Mobile app                                                    | Notifications reach the phone via ntfy/Telegram/email; no native client                                                                                |

**Invariants**

| #   | Invariant                                                                                                         | Why It Must Hold                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| I1  | Renderer never touches SQLite, brokers, providers, or secrets directly                                            | Existing security boundary; everything routes through preload/IPC                      |
| I2  | Deterministic gates own money decisions; LLMs never choose size                                                   | The model forms the view, math forms the bet — core discipline from both prior reviews |
| I3  | Every live order passes RiskEngine → allocation gate → order-policy gate                                          | No new code path may bypass the gate chain                                             |
| I4  | Paper mode by default; live requires explicit readiness acknowledgement per session                               | Existing `live_allowed` + readiness flow stays load-bearing                            |
| I5  | Every decision (trade AND skip) writes a `signal_observation`; every resolvable observation gets a `signal_label` | The research loop dies without labeled skips                                           |
| I6  | Secrets stay in OS Keychain as `secretRef`s                                                                       | No credentials in SQLite or logs                                                       |
| I7  | Migrations leave the DB usable at every phase boundary                                                            | Ken's daily driver DB must never brick                                                 |
| I8  | Bun stays the package manager; no npm/pnpm lockfiles                                                              | Repo convention                                                                        |
| I9  | In-app docs + glossary updated in the same PR as any operator-visible change                                      | Rule E.3 from the 06-26 review, kept                                                   |

**Global constraints** (for agents executing tasks from this plan): TypeScript strict; Drizzle + better-sqlite3 for persistence; Zod schemas in `electron/shared/validation` for all IPC payloads; Vitest for unit tests; new domain types live in `electron/shared/domain/`; no placeholder code (`TBD`, "handle appropriately") in landed diffs; every phase below must leave `bun run check` green.

---

## 4. Current State

### 4.1 Architecture and components

The runtime shape (accurate as of today, verified against code):

```text
Renderer (React/Zustand/TanStack Query, 17 pages)
  └─ preload bridge (window.exva, typed endpoints)
      └─ IPC handlers (electron/main/ipc/*, Zod-validated)
          └─ createAppServices (composition root, app-services.ts)
              ├─ SessionService → SessionRuntimeManager → SessionRuntime
              │     ├─ AgentOrchestrator (selector cycles, trade cycles, PQueue)
              │     └─ TradeMonitor (poll-based exit management)
              ├─ LLMRuntime → PipelineRuntime (5 AIPhases + engines)
              ├─ SignalService / SignalBus / SignalSourceRegistry (intake)
              ├─ RiskEngine / CapitalReservation / allocation + policy gates
              ├─ BrokerRegistry → adapters (Alpaca, Coinbase, Tradovate, Polymarket, Mock)
              ├─ Search registry (Brave/Tavily/DuckDuckGo/MCP) + worker tools
              ├─ Research services (observations, labels, promotion gate, drift ticker)
              └─ Analytics (scorecards, autopsies, walk-forward, replay)
```

Two intake paths coexist and interleave:

- **Selector-driven:** orchestrator runs the `selector` AIPhase (AI discovery or manual shortlist), gets `ResolvedInstrument[]`, enqueues trade cycles (`instrument-queue.ts`).
- **Signal-driven:** an `ISignalSource` polls/ticks, emits a `SignalEvent`, `SignalBus.handleSignal` persists it, fans out to subscribed sessions through `evaluateSignalDeliveryGate` (broker-capability check), enqueues a `session_signal_deliveries` row, which the orchestrator drains into trade cycles; incompatible signals become `signal_dead_letters` with replay support.

Five experiences bind these together via `ExperienceDescriptor` (id, capabilities, pipelineId, `SignalDescriptor[]`, default presets, prompt variant, and — good — a locked `ExperienceResearchContract`): `rules-mean-reversion`, `rules-breakout`, `rules-trend-following` (all timer-driven deterministic), `prediction-event-edge` (Polymarket poll → forecaster + red-team LLM pipeline → deterministic edge gate), `edgar-catalyst` (8-K poll → filter → LLM), plus `options-flow-edge` (timer chain-scan → UOA detector → AI classification, v1 trades the underlying).

### 4.2 Data / state model

55 tables. The ones that matter for this plan, grouped:

- **Signal intake:** `signal_sources`, `signal_events` (EDGAR-shaped), `session_signal_sources` (subscriptions), `session_signal_deliveries` (queue with 8 statuses), `signal_dead_letters` (with replay).
- **Research spine (built, starving):** `signal_observations` (64), `signal_labels` (48), `model_versions`, `backtest_runs`, `promotion_decisions`, `experience_experiments`, `research_summaries`.
- **Trading:** `trades` (rich columns: MFE/MAE, slippage, spread, commission, AI cost — all unused so far), `trade_approvals`, `capital_reservations`, `decision_traces`.
- **Config sprawl:** 9 per-session config tables (`session_ai_settings`, `session_ai_phases`, `session_ai_phase_workers`, `session_risk_config`, `session_selector_settings`, `session_timeframe_config`, `session_research_posture`, `session_trade_rules`, `session_strategies`) + 5 preset tables + broker assignment/routing/overrides.
- **Observability:** `events`, `session_execution_steps`, `agent_runs`, `agent_messages`, `api_call_log`, `autopsy_lessons`, `period_autopsies`, `trade_autopsies`.

Live DB reality check (today): `trades` = 64 rows, all `no_trade`; `signal_observations` = 64; `signal_labels` = 48; 3 sessions, all deterministic-rules experiences. **No position has ever been opened.**

### 4.3 Critical runtime flows

- **Signal fan-out:** source → `SignalBus.handleSignal` → dedupe by `(sourceId, accessionNumber)` (an EDGAR-ism: sources without accession numbers get **no dedupe at all**) → insert event → per-subscribed-session capability gate → delivery row or dead letter → orchestrator drains queue → trade cycle → `completeSignalDeliveryFromContext` marks terminal status.
- **Trade cycle:** `run-trade-pipeline` → `default-trade-cycle` plan (candidate validation → technical → fundamental → review → decision → risk gate) → `effect-runner` (pending trade, traces, approval or auto-approve, capital reservation) → `OrderPolicyGate` → `order-placer` → open trade → `TradeMonitor` polls to close.
- **Startup:** previously-active sessions rehydrate as paused (monitor-only); `SignalService.replayStartup` re-queues `processing` deliveries and — notably — **drops all undispatched events** with reason `startup_replay_not_implemented` (a confessed gap in signal-service.ts:463).

### 4.4 Observed pain points and root causes

| #   | Pain                                                                                                                                     | Root cause                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Zero trades ever; edge unknown                                                                                                           | Bars bug (fixed, unvalidated) + no backtester to validate any other way                                                                                              |
| C2  | `SignalEvent` is EDGAR-shaped; payloads untyped                                                                                          | First source's shape became the universal envelope; no discriminated union                                                                                           |
| C3  | Timer ticks are "signals"                                                                                                                | No Scheduler abstraction; polling cadence and information events conflated                                                                                           |
| C4  | `services/signal/` vs `services/signals/` split; `pipeline/engines/finalizer/*` duplicates `signal/aggregators/*` and `signal/scoring/*` | Incremental growth across three refactor generations (signal-driven plan → cognitive rearchitecture → definition-first pipeline), none finished cleaning up the last |
| C5  | Confidence is a heuristic, not a probability                                                                                             | P2 from the profitability review, still true for rules experiences; only the prediction pipeline computes a real `p_hat`                                             |
| C6  | No limit orders / order types / qty orders                                                                                               | `BrokerOrder` designed for the market-order happy path                                                                                                               |
| C7  | Dedupe only via `accessionNumber`                                                                                                        | EDGAR-ism; other sources can double-fire                                                                                                                             |
| C8  | Startup drops undispatched signals silently                                                                                              | Fan-out replay never implemented                                                                                                                                     |
| C9  | Data starvation looked like healthy skips for weeks                                                                                      | No health model separating "no data" from "no setup" (partially fixed: preflight probe + warn log)                                                                   |
| C10 | Mock-rehearsal shims threaded through `SignalService` (ensure/migrate/sync methods)                                                      | Test scaffolding grew into the production service's public API                                                                                                       |
| C11 | Nine session-config tables, five preset tables                                                                                           | Config accreted per feature; each table has repo + tests + IPC + UI                                                                                                  |
| C12 | `session_signal_deliveries` pause-expiry hardcodes 4h; TTL not signal-aware                                                              | Staleness is a property of the signal kind, not the queue                                                                                                            |
| C13 | Two review docs live in `docs/reviews/oldreviews/`; 40+ archived plans in-repo                                                           | History mixed with active docs; agents keep reading stale specs                                                                                                      |

---

## 5. Desired End State

Describe-as-if-built:

### 5.1 The signal domain (one tree, typed, scheduled vs informed)

```text
electron/main/services/signals/
  sources/            # ISignalSource impls: edgar, prediction-market, options-flow,
                      #   volume-scanner, news, insider, earnings-calendar, manual, mock
  bus/                # SignalBus, delivery gate, deliveries/dead-letters repos, TTL logic
  scheduler/          # NEW: SessionScheduler — cadence/cron per experience; NOT signals
  strategy/           # rules engines (breakout, mean-reversion, trend, UOA detector)
  forecast/           # calibration store, EdgeEstimate builders, forecaster contracts
  scoring/            # selector candidate merging/scoring (kept, relocated)
```

`electron/shared/domain/market-signal.ts` defines the envelope:

```ts
interface MarketSignalBase {
  id: string;
  sourceId: string;
  kind: MarketSignalKind; // discriminant
  instrumentClass: InstrumentClass;
  symbols: string[]; // 1+ affected instruments
  occurredAt: string; // when the information came into being
  detectedAt: string; // when we saw it
  ttl: string; // kind-specific staleness horizon, e.g. "PT2H"
  dedupeKey: string; // mandatory; source computes it
  provenance: { url?: string; raw?: unknown };
}

type MarketSignal =
  | (MarketSignalBase & { kind: "filing"; payload: FilingPayload })
  | (MarketSignalBase & {
      kind: "market_dislocation";
      payload: DislocationPayload;
    })
  | (MarketSignalBase & { kind: "flow_anomaly"; payload: FlowAnomalyPayload })
  | (MarketSignalBase & { kind: "scan_hit"; payload: ScanHitPayload })
  | (MarketSignalBase & { kind: "news"; payload: NewsPayload })
  | (MarketSignalBase & { kind: "calendar_event"; payload: CalendarPayload })
  | (MarketSignalBase & { kind: "manual"; payload: ManualPayload });
```

Timers are gone from this union. `SessionScheduler` owns cadence: a rules experience declares `schedule: { cadence: "15m", marketHours: "regular" }` and the scheduler invokes its scan; if the scan finds a setup it emits a `scan_hit` signal _with the computed evidence in the payload_ (z-score, band values, bar window hash). The signal stream now contains only things worth logging as information.

### 5.2 The decision ladder

Every path from signal to order moves through four typed stages, each persisted:

```text
MarketSignal → Candidate (tradable instrument + hypothesis binding + freshness check)
            → Forecast  (EdgeEstimate: strength, p, EV net of costs, uncertainty, modelVersion)
            → Decision  (deterministic gate: net-edge floor, uncertainty cap, risk, allocation)
            → Order     (contract v2) | Skip (labeled observation)
```

`EdgeEstimate` (already sketched in `shared/domain/edge-estimate.ts`) becomes mandatory on every decision trace. Calibration jobs compare forecast `p` to labeled outcomes per model version and bucket; a strategy whose forecasts are uncalibrated gets its sizing haircut automatically.

### 5.3 The evidence machine

- `services/backtest/` grows a **general bar-replay engine**: feed any strategy implementing `DeterministicStrategy { warmupBars, evaluate(bars, ctx): StrategySignal | null }` a historical window from the data store, apply the same cost model and exit policy as live, write a `backtest_runs` row with fold-aware metrics.
- `services/marketdata/` (new): a **point-in-time OHLCV store** (SQLite tables `ohlcv_bars` keyed by symbol/timeframe/ts, provider-agnostic ingest from Alpaca/Tradier/Kraken data endpoints), so backtests and live share one data access path and outages are detectable by freshness queries.
- Promotion is computed, not vibes: `PromotionGateService` reads research contract thresholds + backtest folds + paper scorecard CIs and emits `promotion_decisions` with the evidence attached; the UI just renders the ladder.

### 5.4 Execution contract v2

```ts
interface BrokerOrderV2 {
  clientOrderId: string;
  instrument: InstrumentRef; // symbol + class + metadata
  side: "BUY" | "SELL";
  quantity:
    | { kind: "notional_usd"; value: number }
    | { kind: "units"; value: number }; // shares/contracts
  orderType: "market" | "limit" | "stop" | "stop_limit";
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: "day" | "gtc" | "ioc" | "fok";
  bracket?: { stopLossPrice?: number; takeProfitPrice?: number };
}
```

Adapters advertise capabilities (`supportsLimit`, `supportsBracket`, `supportsStreaming`, `quantityKinds`) and the order-policy gate refuses order shapes the adapter can't honor. The trade monitor consumes an `OrderEventFeed` interface (websocket where available, poll fallback) instead of raw polling.

### 5.5 Brokers

Adapter roster: Alpaca (stocks/crypto/options), Polymarket (paper + live), **Kalshi** (regulated US event contracts — the legal twin of the Polymarket experience, with a real demo environment), **Tradier** (cheap, simple options execution — where options-flow-edge graduates from trading the underlying to trading contracts), Coinbase, Tradovate (futures), **Kraken** (crypto depth + real websockets), Mock. **IBKR and Schwab are permanently dropped** (finish-line 03) — no strategy needs their coverage.

### 5.6 Hands-free autonomy

A `SupervisorService` (new, small) runs continuously: session heartbeats, consecutive-same-skip-reason alarms, data-freshness checks, drawdown/drift kill switches (wired to the existing `drift-monitor-ticker`), and a notification sink (ntfy.sh push + optional email). The promotion ladder moves capital between rungs automatically within Ken-approved bounds; only rung _upgrades_ require a tap.

### 5.7 What gets deleted

`services/signal/` (merged), duplicate finalizer engines, `timer` and `web_search` source types, mock-rehearsal shims out of `SignalService` (moved behind a dev-only seam), the 4h hardcoded pause-expiry (replaced by TTL), `docs/plans/archieve/` (moved out of repo or to `docs/attic/` excluded from agent context), and any session-config table that folds into the consolidated strategy config (§9.10).

---

## 6. Gap Analysis

| Area             | Current State                                              | Target State                                             | Required Change                                            |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Proof of life    | 0 positions ever                                           | Paper trades flowing, health-monitored                   | Run Phase 0; supervisor alarms                             |
| Signal envelope  | EDGAR-shaped + `payloadJson`                               | `MarketSignal` discriminated union                       | New domain type, source rewrites, table migration          |
| Timers           | Are signals                                                | Are schedules                                            | New `SessionScheduler`; strip `timer` from union           |
| Directory layout | `signal/` + `signals/` + pipeline dupes                    | One `signals/` tree, one engine registry                 | Mechanical merge + dedupe                                  |
| Dedupe           | `accessionNumber` only                                     | Mandatory `dedupeKey` per signal                         | Source-computed keys, unique index                         |
| Startup replay   | Drops undispatched events                                  | Re-fan-out with TTL check                                | Implement replay path (already stubbed with reason string) |
| Forecasts        | Heuristic confidence (rules); real p_hat (prediction only) | `EdgeEstimate` on every decision + calibration store     | Forecast stage in ladder; calibration job                  |
| Backtesting      | EDGAR-only                                                 | General bar-replay engine over shared strategy interface | New engine + data store                                    |
| Market data      | Fetched ad hoc via broker adapters per cycle               | Point-in-time store, shared by live + backtest           | `services/marketdata/` + ingest jobs                       |
| Order contract   | Market-only, USD notional                                  | v2: limit/stop/TIF/qty + capabilities                    | Contract change, adapter migration, gate updates           |
| Brokers          | 4 + mock                                                   | +Kalshi, +Tradier, +Kraken (IBKR/Schwab dropped)         | New adapters behind v2                                     |
| Monitoring       | Poll-only                                                  | `OrderEventFeed` (stream or poll)                        | Interface + Alpaca/Kraken websocket impls                  |
| Autonomy         | Manual start/stop; approval prompts                        | Supervisor + notifications + auto-ladder                 | New service + config                                       |
| Config           | 9 session tables + 5 preset tables                         | Consolidated strategy config document                    | Schema consolidation (measured, later phase)               |
| Docs             | Archive mixed with active                                  | Attic'd archive; docs index reflects reality             | Move + index rewrite                                       |

The hard gaps in prose: the **signal table migration** (C2) is the riskiest data change — `signal_events` rows are referenced by deliveries, dead letters, and observations, so the migration keeps the old table, adds a `kind` + `payload_json_v2` + `dedupe_key` column set, and backfills `kind='filing'` for EDGAR rows / `kind='manual'` for the rest, rather than rewriting history. The **engine-registry merge** (C4) is mechanically large but semantically safe because the pipeline registry's engine kinds already superset the signal registry's bindings — the tests in `pipelines-registration.test.ts` and `signal-engine-registry.test.ts` define the contract to preserve. The **order contract v2** cannot be a big-bang: `BrokerOrderV2` ships alongside `BrokerOrder` with an adapter shim (`v1→v2` lift is trivial: market + notional + day), and gates learn v2 first.

---

## 7. Options Considered

### Option A: Status quo + spot fixes

Keep the architecture; fix bugs as found; add features on the existing envelope.

| Dimension        | Assessment                                                   |
| ---------------- | ------------------------------------------------------------ |
| Build complexity | None                                                         |
| Migration risk   | None now; compounding later                                  |
| Runtime risk     | Silent-failure classes remain                                |
| Reversibility    | n/a                                                          |
| Team fit         | Fine                                                         |
| Testability      | Unchanged                                                    |
| Maintainability  | Degrading — every new source deepens the EDGAR-envelope debt |

Honest read: this is how the codebase got here. Rejected, but its kernel of truth — _run the machine before rebuilding it_ — is kept as Phase 0.

### Option B: Targeted rearchitecture on the existing platform (recommended)

Keep Electron/SQLite/pipeline runtime; rebuild the signal domain, add the evidence machine, extend execution, expand brokers, add autonomy — in phases that each leave the system runnable.

| Dimension        | Assessment                                                            |
| ---------------- | --------------------------------------------------------------------- |
| Build complexity | High but phased; nothing big-bang                                     |
| Migration risk   | Moderate — signal table + engine merge are the two real migrations    |
| Runtime risk     | Low per phase; each phase gated by `bun run check` + a live paper run |
| Reversibility    | Good — old envelope kept during transition                            |
| Team fit         | Excellent — same stack, same test idioms                              |
| Testability      | Improves (backtester makes strategies testable at all)                |
| Maintainability  | Strongly improves (one signal tree, typed payloads, deletion list)    |

### Option C: Adopt an existing engine (NautilusTrader/freqtrade) as the core, keep Exva as UI

Run a Python/Rust trading engine as a sidecar; Exva becomes the control plane.

| Dimension        | Assessment                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| Build complexity | Very high — process management, IPC to Python, model mismatch           |
| Migration risk   | Extreme — 55 tables, 1,200 tests, all flows re-plumbed                  |
| Runtime risk     | High during transition; two sources of truth                            |
| Reversibility    | Poor                                                                    |
| Team fit         | Poor — TS codebase, Bun tooling, single maintainer                      |
| Testability      | Engine tested upstream, but the seam is new and untested                |
| Maintainability  | Mixed — free backtester/venue adapters, but permanent polyglot boundary |

Not a strawman: Nautilus genuinely solves backtest/live parity and venue adapters better than Exva ever will. But Exva's differentiator is the LLM research pipeline + local-first UX, not execution microstructure, and the integration tax lands on exactly one person. Its best ideas — event-driven core, unified clock for backtest/live, message-bus decoupling, adapter capability flags — are imported into Option B instead.

### Option D: Burn down to one experience

Delete everything except `prediction-event-edge`, perfect it live, regrow from there.

| Dimension        | Assessment                                          |
| ---------------- | --------------------------------------------------- |
| Build complexity | Low (deletion) then medium                          |
| Migration risk   | Low technically, high emotionally                   |
| Runtime risk     | Concentrated in one strategy's edge existing at all |
| Reversibility    | Poor — deleted breadth is gone                      |
| Team fit         | Fine                                                |
| Testability      | Simplest possible surface                           |
| Maintainability  | Best short-term                                     |

Attractive for focus, rejected as the plan-of-record because the deterministic rules experiences are _nearly free to keep_ once the scheduler split lands, and multi-experience capital allocation is core to the end vision. But D's spirit shows up as the ruthless delete list and as "no new alpha sources until the backtester exists."

---

## 8. Recommendation

**Option B**, with Option A's Phase-0 humility and Option D's deletion appetite.

Why B over the status quo: the EDGAR envelope, the timer conflation, and the missing backtester are not cosmetic — they are why the system can neither express its next ten features nor prove its first one. Why B over the smaller change (just fix signals): signals-only stops short of the money question; a beautifully typed signal that flows into an uncalibrated forecast and a market-order-only broker contract still can't print anything. Why not C/D: covered above.

Assumptions the recommendation depends on: (1) the bars fix actually works — Phase 0 verifies within days; (2) the pipeline runtime is sound enough to keep as substrate (its integration tests and the shipped prediction pipeline suggest yes); (3) Ken continues operating solo and local-first. Facts that would change it: if Phase 0 reveals the orchestrator/monitor loop is fundamentally broken (not just starved), the sequencing flips to stabilize-execution-first; if a Kalshi/IBKR spike shows adapter effort is 3× estimate, broker breadth shrinks rather than delaying the evidence machine.

---

## 9. Detailed Design (and the full brainstorm)

This is the largest section, per this document's purpose: exhaust the fixes.

### 9.1 Phase 0 — Run the machine (do this before any refactor)

1. **Launch and verify.** `bun run start`, resume the three sessions (or reset + reseed), and watch one full cycle with real bars. Success = `decision_traces` showing a _computed_ z-score/band/SMA (not the pinned 0.2), and — market permitting — a filled paper order with `opened_at` set.
2. **Force the loop if the market won't cooperate.** The mock broker + `debugForceTrade` + mock rehearsal exist precisely for this; additionally run one BTC-USD breakout session (24/7 market) so cycles exercise round the clock.
3. **Ship the consecutive-skip alarm now** (small): in `runtime-outcome.ts` / `recordFailure` path, count consecutive identical `reasonCategory` per session; at N=10 emit an `attention_required`-grade event + notification. This is the guardrail the 06-26 postmortem demanded and it should not wait for the supervisor service.
4. **Baseline snapshot.** Export a scorecard of the first real week (even if it's all losses) — this is the "before" photo for everything else.

### 9.2 The `MarketSignal` union (full type sketch)

Payloads, one per kind — these are the contract for every current and near-term source:

```ts
interface FilingPayload {
  // EDGAR 8-K/Form 4 etc.
  filingType: string; // "8-K", "4", "13D"
  accessionNumber: string;
  itemCodes: string[];
  companyName: string | null;
  documentUrl: string;
  filedAt: string;
  polarityHint?: "positive" | "negative" | "unclear";
}
interface DislocationPayload {
  // prediction markets
  marketId: string;
  question: string;
  outcome: string;
  marketMid: number; // implied probability
  spreadBps: number;
  liquidityUsd: number;
  resolutionAt: string;
  resolutionCriteria: string;
}
interface FlowAnomalyPayload {
  // options UOA, unusual volume
  underlying: string;
  anomalyType: "volume_oi" | "iv_spike" | "skew_shift" | "volume_surge";
  metric: number; // e.g. volume/OI ratio
  baseline: number;
  contracts?: OptionContractRef[];
  direction: "bullish" | "bearish" | "unclear";
}
interface ScanHitPayload {
  // scheduled rules-scan found a setup
  strategyId: string; // "mean-reversion-zscore"
  evidence: Record<string, number>; // { zScore: -2.3, sma20: ..., barCount: 30 }
  barWindowHash: string; // reproducibility anchor for replay/backtest join
  proposedAction: "buy" | "sell";
}
interface NewsPayload {
  headline: string;
  url: string;
  publishedAt: string;
  sourceQuality: "wire" | "major" | "aggregator" | "social";
  tickersMentioned: string[];
}
interface CalendarPayload {
  // earnings, FOMC, CPI, FDA dates
  eventType: "earnings" | "fomc" | "cpi" | "fda" | "expiry" | "other";
  scheduledAt: string;
  symbol?: string;
}
interface ManualPayload {
  note: string | null;
}
```

Design rules: `dedupeKey` is computed by the source (filing → accession; dislocation → `marketId:date:bucket(mid,2bps)`; flow → `underlying:anomalyType:hour`; scan*hit → `strategyId:symbol:barWindowHash`) and enforced with a unique index — replacing the accession-only dedupe (C7). `ttl` is set per kind (filing: hours; dislocation: minutes-to-hours by time-to-resolution; scan_hit: one bar period; news: kind-dependent) and replaces the hardcoded 4h pause-expiry (C12); the delivery gate and the startup replay both consult it, which also finally makes the startup re-fan-out safe to implement (C8): re-deliver anything unexpired, drop the rest \_with the TTL as the stated reason*.

**Migration:** additive columns on `signal_events` (`kind`, `payload_v2`, `dedupe_key`, `ttl`, `occurred_at`), backfill, dual-read period where `SignalBus` accepts both shapes, then source-by-source cutover, then old columns dropped in a final cleanup migration. Deliveries/dead-letters/observations reference event ids and are untouched.

### 9.3 The Scheduler split

New `services/signals/scheduler/session-scheduler.ts`:

```ts
interface ScheduleSpec {
  cadence: string; // "15m", "1h", cron later
  marketHours: "regular" | "extended" | "24_7";
  jitterPct?: number; // avoid thundering-herd polling
}
interface ScheduledScan {
  experienceId: string;
  schedule: ScheduleSpec;
  run(ctx: ScanContext): Promise<MarketSignal[]>; // empty = quiet tick, not logged as signal
}
```

The three rules experiences and the options-flow chain scan convert from timer signal sources into `ScheduledScan`s. Consequences worth spelling out: `signal_events` volume drops to only-information; the Signal Sources UI page splits into "Signal Sources" (information feeds with last-signal timestamps) and "Schedules" (cadences with next-fire times — the `nextFireAt` snapshot field already anticipates this); market-hours filtering moves from delivery-time filtering into the scheduler (don't scan a closed market, rather than scan-and-drop); and the `PollResult {detected, passed, dropped}` accounting becomes scan telemetry rather than signal noise.

The EDGAR and prediction-market pollers remain genuine signal sources (they watch external state and emit when it changes) — but their _polling loop_ also moves onto the scheduler so cadence, jitter, and backoff live in one place.

### 9.4 Directory merge and registry unification

Mechanical plan (mostly `git mv` + import rewrites):

- `services/signal/rules/*` → `services/signals/strategy/`
- `services/signal/aggregators/*` + `services/signal/scoring/*`: reconcile against `pipeline/engines/finalizer/*` — for each duplicated aggregator keep the pipeline-registered one, port any behavior deltas, delete the twin; non-duplicated scoring (candidate merger, option contract selector, prediction candidate engine) → `services/signals/scoring/`.
- `services/signal/registry/*` (ENGINE_BINDINGS) dissolves into `pipeline/engines/registry.ts` — one registration path, one startup assertion (`assertValidPipelineDefinitionCatalog` already exists as the check of record).
- `services/signal/execution/trade-execution-profile.ts` → `services/orchestration/` (it's execution policy, not signal).
- Mock-rehearsal `ensure*/migrate*/sync*` methods move out of `SignalService` into `experiences/mock-rehearsal-bootstrap.ts` invoked from the composition root behind `if (env.enableMockRehearsal)` — the production signal service API shrinks to sources/subscriptions/deliveries/dead-letters.

Guard: `selector-migration-guards.test.ts` and the registry tests pin behavior; run the golden-path integration tests after each move batch.

### 9.5 Forecast layer & calibration (making numbers mean things)

- Rules strategies stop emitting `confidence`; they emit `strength` (the raw statistic) inside `ScanHitPayload.evidence`. A **forecast adapter** per strategy maps strength → probability using the calibration store: initially an identity-ish prior with wide uncertainty, tightening as labels accumulate (`signal_labels` per strategy/bucket → empirical win rates with Wilson intervals).
- The prediction pipeline already produces `p_hat` + uncertainty band — it plugs into the same `EdgeEstimate` shape unchanged.
- New `forecast/calibration-service.ts`: nightly job computes reliability buckets + Brier per `modelVersion`; writes to `model_versions`; exposes `calibrationHaircut(modelId, p)` that the deterministic decision gate multiplies into size. Uncalibrated → max haircut. This operationalizes P1/P2 from the profitability review instead of leaving calibration buried in autopsies.
- Decision gate becomes one shared module (the prediction `evaluatePredictionEdge` generalizes): `netEdge = EV - costs`, floors, uncertainty caps, fractional Kelly with haircuts — used by _all_ experiences, so "how we decide to bet" is one audited file.

### 9.6 The evidence machine: data store + backtester

**`services/marketdata/`** (new):

- Tables: `ohlcv_bars(symbol, instrument_class, timeframe, ts, o, h, l, c, v, provider, ingested_at)` with a `(symbol, timeframe, ts)` unique key; `data_coverage(symbol, timeframe, first_ts, last_ts, provider)` for freshness/coverage queries.
- `MarketDataService.getBars(symbol, timeframe, window)` serves live cycles (read-through cache: DB first, provider on miss, write-back) and backtests (DB only, fail-loud on gaps). Providers: Alpaca data (already integrated), Tradier (when adapter lands), Kraken public OHLC (free), stooq/yfinance-style bulk backfill for deep history via a one-shot ingest script.
- This kills the per-cycle "adapter fetch with fingers crossed" pattern and gives the supervisor a freshness signal (`last_ts` lag) to alarm on.

**`services/backtest/replay-engine.ts`** (new, generalizing `edgar-drift-backtest`):

```ts
interface BacktestSpec {
  experienceId: string;
  symbols: string[];
  timeframe: TradingTimeframe;
  window: { start: string; end: string };
  folds: number; // purged walk-forward
  costs: ExperienceResearchContract["costs"];
  exitPolicy: ExitPolicyConfig; // same evaluator as live
}
```

- Deterministic strategies replay directly (strategy interface shared with live scans — the `ScanHitPayload.barWindowHash` makes live decisions reproducible in replay).
- LLM strategies can't be cheaply replayed; they get **frozen-decision replay** (re-run recorded decisions against subsequent bars — the replay fixtures and `agent_messages` snapshots already support this) plus forward paper trading as their evidence path. Be honest in the UI about which evidence class a strategy has.
- Output: `backtest_runs` rows with per-fold expectancy CI, Sharpe lower bound, max drawdown, trade count, cost drag — the exact fields the promotion gate's thresholds name. Wire `walk-forward-report`'s purged-fold upgrade here (P1).

### 9.7 Alpha-source brainstorm (post-backtester, in rough priority order)

Every item below enters as: research contract first → historical/backtest or forward-paper evidence → promotion ladder. None ship enabled-by-default.

1. **Kalshi event contracts** — same forecaster+red-team pipeline as Polymarket, but US-regulated with a clean API and demo env; also enables cross-venue comparison (same event priced on both = a real dislocation detector between venues).
2. **EDGAR Form 4 insider-buy clusters** — the EDGAR plumbing exists; cluster purchases by officers/directors (multiple insiders, open-market buys, size vs salary) have the best-documented drift of any filing signal. Payload: `filing` kind, new item codes.
3. **Unusual volume scanner (equities)** — deterministic `scan_hit`: RVOL vs 20-day baseline + price break; feeds the same evidence/LLM-context step as options flow ("why is this moving?").
4. **Earnings/FOMC/CPI calendar** — `calendar_event` signals used two ways: as _blackout_ inputs to the risk gate (don't hold through binary events unless the strategy is explicitly an event strategy) and as scheduled attention for event strategies. Cheap, high hygiene value.
5. **Options-flow-edge v2** — graduate from trading the underlying to defined-risk verticals via Tradier; the UOA detector, contract selector, and research contract already exist.
6. **Crypto funding-rate / basis dislocations** — Kraken/Coinbase perp funding extremes as mean-reversion context signals; 24/7 market keeps the loop exercised.
7. **News wire (RSS: PR Newswire/GlobeNewswire/Business Wire)** — `news` signals feeding the existing evidence engine; strictly as _context enrichment_ for other signals first (freshness cross-check), standalone news-trading only after the freshness gate proves itself.
8. ~~Congressional/insider-adjacent alt-data (Quiver-style)~~ — **permanently dropped** (finish-line 06). Murky edge + API cost; roster closed at items 1–7.

Explicitly **not** doing: social-sentiment firehoses (X/Reddit) as primary signals (noise, API cost, crowding), sub-minute anything (N3), and any source that can't state a falsifiable hypothesis.

### 9.8 Brokers & execution (detail)

**Contract v2 rollout:** define `BrokerOrderV2` + `AdapterCapabilities`; wrap existing adapters with a v1-compat shim; teach `OrderPolicyGate` + `order-placer` v2; migrate Alpaca fully (it supports everything); then Polymarket (limit orders on the CLOB are _the_ fix for spread-crossing — maker instead of taker), then the rest. Add `OrderEventFeed` with poll-based default; Alpaca + Kraken get websocket implementations; `TradeMonitor` consumes the feed instead of owning poll loops.

**New adapters, ordered:**

| Broker     | Why                                                                             | Effort | Notes                                                                       |
| ---------- | ------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Kalshi     | Regulated event contracts; demo env; pairs with existing prediction pipeline    | M      | REST + websocket; per-contract fees must enter the cost model               |
| Tradier    | Options execution with a sane REST API + paper sandbox; unlocks options-flow v2 | M      | Also a usable equities data source                                          |
| Kraken     | Crypto depth, real websockets, solid docs                                       | M      | Public OHLC helps the data store even pre-trading; paper = validate + ghost |
| ~~IBKR~~   | **Permanently dropped** (finish-line 03)                                        | —      | No strategy needs gateway coverage                                          |
| ~~Schwab~~ | **Permanently dropped** (finish-line 03)                                        | —      | Low marginal value over Alpaca+Tradier                                      |

**Data-vs-execution decoupling:** broker assignment stays about _execution_; `MarketDataService` chooses data providers independently (e.g., Tradier data + Alpaca execution is legal). This removes today's implicit "your broker is your data feed" coupling that caused the bars catastrophe to be a _trading_ outage.

### 9.9 Hands-free autonomy & operator surface

- **`SupervisorService`** (new, ~300 lines, not a framework): per-session heartbeat (expected next activity vs now), consecutive-skip alarm (from Phase 0), data-freshness lag alarm, daily-loss and drawdown kill switches (session-pause + notification), drift alarm (existing ticker wired to notifications), AI-spend runaway alarm.
- **Notifications:** `notification-service.ts` exists; add sinks: ntfy.sh push (zero-infra phone push), optional SMTP. Severity routing: kill-switch/attention → push; promotion-ready/daily summary → digest.
- **Promotion ladder automation:** rungs `backtest → paper → live_small → live_scaled`, capital bounds per rung stored on the experience; gate computes eligibility continuously; _within-rung_ sizing adjusts automatically (calibration haircuts, drawdown de-risking); _rung changes upward_ require one approval tap; downward moves (evidence degrades) are automatic and notify.
- **Daily rhythm, scheduled in-process:** overnight jobs — label resolution (`label-builder-ticker` exists), calibration refresh, period-autopsy run, scorecard digest notification. The app must be running for these; document that (or register a launchd agent — small `scripts/` addition, optional).
- **UI consolidation (directional):** 17 pages → gravity toward 5 hubs: **Dashboard** (money + attention + ladder), **Sessions** (runtime), **Signals & Schedules** (split per §9.3), **Research** (scorecards, backtests, calibration, autopsies — currently smeared across Leaderboard/Autopsy/PeriodAutopsy/CostBreakdown), **Settings** (accounts, brokers, presets, dev panel). In-app docs stay (they're good and E.3 keeps them honest).

### 9.10 Config & schema diet (later, measured)

Nine session-config tables is a lot of repo/IPC/UI surface for what is conceptually one strategy document per session. Target (Phase 6, only after everything above is stable): a versioned `session_strategy_config` JSON document validated by Zod, with the presets system writing documents instead of rows-per-table. Explicitly _not_ early — it's churn-heavy, user-visible, and nothing else depends on it. Same posture for merging the three autopsy tables into one keyed-by-scope table.

### 9.11 Delete list (full)

| Item                                                    | Where                                                | Replacement                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `services/signal/` directory                            | after §9.4 merge                                     | `services/signals/`                                                                                        |
| Duplicate finalizer/aggregator twins                    | `pipeline/engines/finalizer/` vs `signal/aggregators | scoring`                                                                                                   | single registered engine each |
| `timer` signal source + type                            | sources, enums, UI                                   | `SessionScheduler`                                                                                         |
| `web_search` signal source                              | sources                                              | evidence-engine tool usage (search stays as a _tool_, not a source); revisit only with a concrete contract |
| Mock-rehearsal methods on `SignalService`               | signal-service.ts:92-175                             | dev-only bootstrap module                                                                                  |
| `debugInjectSignal`'s SPY/manual guessing               | signal-service.ts:333                                | typed debug injection per signal kind in Dev Panel                                                         |
| Hardcoded 4h pause-expiry                               | signal-bus.ts:192                                    | per-kind TTL                                                                                               |
| `startup_replay_not_implemented` drop                   | signal-service.ts:463                                | TTL-aware re-fan-out                                                                                       |
| EDGAR-ism dedupe                                        | signal-bus.ts:106                                    | `dedupeKey` unique index                                                                                   |
| `docs/plans/archieve/` (40+ files) + `docs/archive/`    | repo                                                 | `docs/attic/` with an index note, excluded from default agent reading paths (or a separate branch)         |
| Stale `docs/architecture/*` sections after each phase   | docs                                                 | updated same-PR (I9)                                                                                       |
| Legacy IPC/config surfaces flagged in ai-runtime.md §14 | ipc/                                                 | inventory in Phase 5, delete what UI no longer calls                                                       |

### 9.12 File layout (target, signal domain)

```text
electron/shared/domain/
  market-signal.ts            # union + payloads + TTL/dedupe helpers
  edge-estimate.ts            # (exists) becomes mandatory on decisions
electron/main/services/signals/
  sources/                    # edgar, prediction-market(+kalshi), options-flow,
                              #   volume-scanner, calendar, news, manual, mock
  scheduler/session-scheduler.ts
  bus/{signal-bus,delivery-gate,ttl}.ts + repos/
  strategy/{breakout,mean-reversion,trend-following,uoa-detector}.ts
  forecast/{calibration-service,forecast-adapter}.ts
  scoring/{selector-candidate-merger,option-contract-selector,...}.ts
electron/main/services/marketdata/
  market-data-service.ts, providers/, ingest/
electron/main/services/backtest/
  replay-engine.ts, folds.ts, edgar-drift-backtest.ts (ported onto engine)
electron/main/services/supervisor/
  supervisor-service.ts, alarms.ts, sinks/
```

---

## 10. Migration / Implementation Plan

Each phase leaves `bun run check` green and the app operable on the daily DB.

**Phase 0 — Prove it trades (days).** Objective: first opened+closed paper positions; consecutive-skip alarm shipped; baseline scorecard exported. No schema changes. Rollback: n/a (additive alarm only). Done when: `trades.opened_at` non-null exists for ≥1 real-bars session and ≥1 24/7 (BTC) session.

**Phase 1 — Signal envelope + scheduler (1-2 weeks).** Objective: `MarketSignal` union shipped; additive `signal_events` columns + backfill; dual-read bus; rules experiences moved onto `SessionScheduler` emitting `scan_hit`; TTL replaces 4h expiry; dedupeKey index; startup re-fan-out implemented. Validation: golden-path integration tests + a live paper day where scan_hits flow end-to-end. Rollback: dual-read means old-shape sources still work; feature-flag scheduler per experience.

**Phase 2 — Directory merge + registry unification (≈1 week, mechanical).** Objective: `services/signal/` gone; one engine registry; mock shims extracted. Validation: registry assertion at boot, full suite, one replay-fixture run. Rollback: git revert (no schema).

**Phase 3 — Evidence machine (2-4 weeks).** Objective: `marketdata` store + ingest + freshness; replay-engine with purged folds; all three rules strategies backtested over ≥2 years; forecast adapters + calibration service; shared decision gate with EdgeEstimate persisted on every decision trace. Validation: backtest determinism test (same spec → same run hash); promotion gate reads real `backtest_runs`. Rollback: store is additive; decision gate behind per-experience flag during cutover.

**Phase 4 — Execution v2 + brokers (2-4 weeks, parallelizable with late Phase 3).** Objective: `BrokerOrderV2` + capabilities + `OrderEventFeed`; Alpaca fully migrated; Polymarket limit orders; Kalshi adapter (paper first); Tradier adapter; Kraken data (trading optional). Validation: adapter contract tests per capability; paper orders of each new shape observed filling. Rollback: v1 shim keeps old paths alive until each adapter certifies.

**Phase 5 — Autonomy (1-2 weeks).** Objective: SupervisorService + ntfy sink; ladder automation with one-tap upgrades; nightly jobs wired; legacy IPC inventory + deletion; docs/attic move. Validation: a 72h unattended paper run with zero silent stalls (every stall produced a notification). Done when Ken stops opening the app to check if it's alive.

**Phase 6 — Config diet + UI consolidation (optional, measured).** Only if Phases 0-5 are stable and the 9-table config sprawl is still the top pain.

Cutover discipline throughout: old signal columns dropped only after two clean weeks on the new envelope; `services/signal/` deleted only in Phase 2's final commit; every phase updates in-app docs + glossary (I9).

---

## 11. Testing and Verification Strategy

- **Unit:** every new payload kind round-trips Zod; dedupeKey collision tests; TTL boundary tests (expired-at-boot, expired-in-queue, fresh); scheduler market-hours/jitter; calibration bucket math (known label sets → known haircuts); decision-gate table tests (edge/uncertainty/cost grids → trade|skip).
- **Integration (existing harness):** golden-path tests extended for `scan_hit` flow; startup re-fan-out test replacing the `startup_replay_not_implemented` assertion; approval-recheck under v2 orders; dead-letter replay with TTL.
- **Backtest determinism:** identical `BacktestSpec` twice → identical run hash; a seeded synthetic bar series with a known planted setup → the strategy must find exactly it (tests intent, not just behavior — Rule 9).
- **Adapter certification suite:** one shared spec run against every adapter's paper env (place limit, cancel, partial-fill sim where possible, order-event feed emits terminal state); mock adapter implements the full v2 surface so orchestration tests exercise everything.
- **Live verification per phase:** a scripted checklist — start session, observe scan → signal → forecast → decision → order → monitor → close → observation → label — with the Dev Panel replay confirming the trace. This is the `verify`-skill journey, not a unit suite.
- **Watch during rollout:** `session_execution_steps` retry rates, `signal_dead_letters` growth, `api_call_log` cost/day, supervisor alarm counts, and the calibration Brier trend per model version.

## 12. Risks and Failure Modes

| #   | Risk                                                                   | Likelihood | Impact                          | Detection                                                | Mitigation                                                                         | Rollback                                          |
| --- | ---------------------------------------------------------------------- | ---------- | ------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Phase 0 reveals deeper runtime breakage than data starvation           | Med        | High (resequences plan)         | First live run                                           | Timeboxed debug; fix-forward before refactors                                      | n/a                                               |
| 2   | Signal migration corrupts delivery/observation joins                   | Low        | High                            | FK checks + row-count assertions in migration test       | Additive columns, dual-read, no destructive step until Phase 5                     | Restore pre-migration DB backup (script it)       |
| 3   | Registry merge silently changes selector/aggregator behavior           | Med        | Med                             | Golden-path + replay-fixture diffs                       | Move in small batches; pin with existing tests first                               | git revert per batch                              |
| 4   | Backtester overfits (evidence machine becomes cherry-picking machine)  | Med        | High (false edge → real losses) | Deflated-Sharpe/fold-degradation flags in promotion gate | Locked research contracts, purged folds, paper stage always required               | Ladder demotes automatically                      |
| 5   | New brokers underestimate (auth, rate limits, order semantics)         | High       | Med (schedule)                  | Spike results                                            | 1-day spike per broker before commitment; Kalshi/Tradier chosen for API simplicity | Ship fewer adapters                               |
| 6   | Live gaps between poll cycles miss fast exits (until event feeds land) | Med        | Med                             | MFE/MAE vs exit slippage in autopsies                    | Keep positions defined-risk / bracket-protected; prioritize Alpaca websocket       | Widen stops or pause strategy                     |
| 7   | AI spend outruns edge (research pipeline costs > captured edge)        | Med        | Med                             | `api_call_log` per-experience cost vs scorecard net      | G9 cost-in-every-gate; spend alarms                                                | Disable LLM experiences, rules keep running       |
| 8   | Solo-maintainer bandwidth: plan stalls mid-refactor                    | Med        | Med                             | Phase checklists                                         | Every phase independently valuable + shippable; no phase >4 weeks                  | Stop at any phase boundary; system stays coherent |

Top-risk prose: **Risk 4 is the sneaky one.** The moment a backtester exists, the temptation is to iterate thresholds until the fold report glows. The defense is structural: the research contract (hypothesis + thresholds) is written _before_ the backtest runs, `experience_experiments` records every attempt (making trial-count visible for false-discovery penalties), and paper trading remains a mandatory rung regardless of backtest beauty. **Risk 2 is the scary one but the most controllable:** the migration plan never rewrites or deletes rows until a multi-week bake, and a `scripts/db-backup.sh` before each phase is a one-liner that should exist anyway.

## 13. Operational Rollout

Environments are just modes here: mock → paper → live_small → live_scaled. Sequencing: every phase's changes soak on paper sessions before any live rung is touched; live capital does not enter until Phase 5's supervisor + kill switches are live (that's a hard gate — hands-free live trading without the pager is how accounts die). Kill/abort conditions per session: daily loss limit, max drawdown, drift alarm, calibration collapse (Brier above contract bound), or any supervisor data-starvation alarm — all pause intake automatically and notify. Communication: it's Ken's own money; the "comms plan" is the notification digest working.

## 14. Open Questions

| #   | Question                                                                                                          | Why It Matters                        | Owner     | Needed By      |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------- | -------------- |
| 1   | Does Phase 0 produce real fills, and do the rules strategies show _any_ life on real bars?                        | Everything resequences if not         | Ken       | Before Phase 1 |
| 2   | Kalshi account/API eligibility + fee schedule acceptable?                                                         | Decides the flagship prediction venue | Ken       | Phase 4 start  |
| 3   | Keep Tradovate/futures at all? (No strategy currently needs it; adapter is `launchCapable`-questionable)          | Delete-list candidate                 | Ken       | Phase 2        |
| 4   | How much history for the data store (2y? 5y?) and is free-tier data quality acceptable for the timeframes traded? | Backtest validity                     | Eng spike | Phase 3        |
| 5   | Approval posture at `live_small`: auto-approve under $X, or every live order tapped?                              | Defines "hands-free"                  | Ken       | Phase 5        |
| 6   | Is `web_search` source deletion OK, or is there an attachment to it?                                              | Delete list #4                        | Ken       | Phase 1        |
| 7   | Should the app self-register a launchd agent so nightly jobs run without the window open?                         | Autonomy completeness                 | Ken       | Phase 5        |

## 15. Appendix

**Key code anchors:** signal envelope `electron/shared/domain/signals.ts:41`; bus + 4h expiry + dedupe `electron/main/services/signals/signal-bus.ts:104-205`; startup drop `electron/main/services/signals/signal-service.ts:463`; delivery statuses `electron/shared/domain/signals.ts:82`; duplicated aggregators `electron/main/services/signal/aggregators/` vs `electron/main/services/pipeline/engines/finalizer/`; order contract `electron/main/services/broker/adapters/broker-adapter.ts:20`; prediction edge gate `electron/shared/quant/prediction-edge.ts`; research contract `electron/shared/domain/research-contract.ts`; promotion gate `electron/main/services/research/promotion-gate.ts`; EDGAR backtest to generalize `electron/main/services/backtest/edgar-drift-backtest.ts`.

**Prior art notes:** NautilusTrader — the borrowed ideas are its strict event-driven core with a swappable clock (identical strategy code in backtest and live), message-bus decoupling of components, and per-venue adapter capability declarations; not borrowed: Rust core, its data model, or running it as a sidecar. freqtrade — validates the "strategy as a small pure function over bars + config, engine owns everything else" shape this plan gives `DeterministicStrategy`/`ScheduledScan`. Agentic-trading survey (arXiv 2605.19337) frames LLM traders as expert-system decision pipelines with audit trails — Exva's forecaster/red-team/deterministic-gate split is already the right shape; the gap was calibration and evidence, which §9.5-9.6 close.

**Terminology:** _scan_hit_ — a scheduled deterministic scan that found a setup (replaces "timer signal"); _EdgeEstimate_ — the strength/probability/EV/uncertainty tuple on every decision; _rung_ — a promotion-ladder capital stage; _attic_ — archived docs moved out of agent-default reading paths.

**Prior review lineage:** this plan absorbs and supersedes the open items of `profitability-system-review-2026-06-22.md` (P1 stats-safe scorecards → §9.6; P2 probability separation → §9.5; P4/P6 Kelly discipline → shared decision gate) and `trading-engine-debug-and-roadmap-2026-06-26.md` (its guardrails A.7 → Phase 0 alarm + supervisor; its Part C/D pipelines are kept and become ladder tenants).

# Current System and Stress Run Review - 2026-07-20

**Verdict:** The last recoverable seven-session run produced zero trades because four sessions were blocked before strategy evaluation by confirmed market-data and Polymarket discovery defects; the three EDGAR sessions also produced no input, but the system did not persist enough source-poll evidence to determine whether they were healthy and quiet or silently failing.

## Scope and Evidence

- Request: debug the current system and the run described as "last night," using `docs/reviews/prompt.md`.
- Recoverable run: the active database contains only a fresh `STRESS-01..06` plus `STRESS-PM-01` matrix created on 2026-07-20. It contains no session that started Sunday night.
- Actual runtime window: app PID 62928 started at `2026-07-20T16:57:23.201Z` (`09:57:23 PDT`); sessions started at about `17:01Z` (`10:01 PDT`); graceful shutdown began at `2026-07-21T01:45:03.979Z` (`18:45:03 PDT`) and all sessions were stopped by `01:46:20.854Z` (`18:46:20 PDT`). The session run lasted about 8 hours 45 minutes.
- Repository: branch `main`, HEAD `e6a21ca402edcf0f9d9df35aa0f370f1e9df341a`, ahead of `origin/main` by one commit.
- Worktree: dirty, with 48 staged paths and an unstaged deletion of the staged `docs/feature-requests/session-activity-indicator.md`. The run exercised behavior present in the dirty activity-monitoring worktree, but the application does not persist a source commit/worktree fingerprint, so the exact bytes loaded by PID 62928 cannot be proven after shutdown.
- Review lanes: red for order/money and broker-routing paths; yellow for scheduling, source health, selector orchestration, persistence, and activity analytics.
- Active database inspected read-only: `~/Library/Application Support/exva/exva.db`, 6,582,272 bytes, last modified `2026-07-20T18:46:20-0700`.
- Database state at investigation time: no `exva.db-wal` or `exva.db-shm`, and no Exva Electron process was running. SQLite URI `mode=ro&immutable=1` was used after plain `sqlite3 -readonly` could not open the path.
- Logs inspected: `~/.exva/logs/exva-2026-07-20.log` for the run and `exva-2026-07-19.log` for startup/history separation. The run did not restart. A second process, PID 88920, was refused by the single-instance lock at `01:41:38Z`; the incumbent continued until graceful shutdown.
- Prior report inspected and re-verified: `docs/reviews/2026-07-19-overnight-stress-session-review.md`.
- Required engineering docs, current `package.json`, active SQLite schema, current source, affected call sites, and focused tests were inspected.
- External contract verification: a read-only request to the live Gamma markets endpoint confirmed its current field shape. Firecrawl was attempted first but rejected the request for insufficient credits; the same metadata-only check was then performed with `curl` and `jq`.
- Excluded: secret values, complete prompts, complete AI messages, raw tool payloads, state-changing SQL, session actions, broker-order experiments, and autopsy generation.

### Commands Run

```bash
git status --short --branch
git rev-parse HEAD
git log -10 --date=iso-local --pretty=format:%h%x09%ad%x09%s

sqlite3 "file:/Users/ken/Library/Application%20Support/exva/exva.db?mode=ro&immutable=1" ".tables"
sqlite3 "file:/Users/ken/Library/Application%20Support/exva/exva.db?mode=ro&immutable=1" ".schema <relevant-table>"
sqlite3 -header -column "file:/Users/ken/Library/Application%20Support/exva/exva.db?mode=ro&immutable=1" "PRAGMA query_only = ON; <SELECT-only investigation queries>"

jq -s -r '<time-bounded warning/error and subsystem aggregations>' "$HOME/.exva/logs/exva-2026-07-20.log"

curl -sS "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=2" \
  | jq '<field-presence, type, and decoded-array-length projection only>'

bunx vitest run \
  electron/main/services/broker/__tests__/instrumented-broker-adapter.test.ts \
  electron/main/services/broker/__tests__/instrument-normalizer.test.ts \
  electron/main/services/broker/adapters/__tests__/alpaca-adapter.test.ts \
  electron/main/services/scheduling/__tests__/market-calendar-registry.test.ts \
  electron/main/services/signals/strategy/mean-reversion-signal.test.ts \
  electron/main/services/signals/strategy/breakout-signal.test.ts \
  electron/main/services/signals/scoring/prediction-market-candidate-engine.test.ts \
  electron/main/services/signals/sources/__tests__/prediction-event-signal-source.test.ts \
  electron/main/services/signals/sources/__tests__/edgar-signal-source.test.ts \
  electron/main/services/orchestration/cycle/__tests__/consecutive-skip-alarm.test.ts \
  electron/main/services/orchestration/cycle/__tests__/orchestrator-step.test.ts \
  electron/main/services/orchestration/cycle/__tests__/agent-orchestrator.test.ts \
  electron/main/services/sessions/__tests__/session-activity-tracker.test.ts \
  electron/main/services/sessions/__tests__/session-activity-remediation.test.ts \
  electron/shared/domain/__tests__/session-activity-analytics.test.ts

bun run typecheck
```

Results: 15 focused test files passed, 114 tests passed, and typecheck passed. Full lint, format, knip, full test, proof, build, and live/paper broker experiments were not run.

## System/Funnel Summary

### Run Funnel

| Stage                             |             Count/result | Interpretation                                                                                            |
| --------------------------------- | -----------------------: | --------------------------------------------------------------------------------------------------------- |
| Sessions                          |      7, all `paper_only` | All ended `stopped` after graceful shutdown                                                               |
| Enabled input subscriptions       |                        7 | 4 event-source, 3 scheduled-scan                                                                          |
| Seeded backing sources            |                  4 total | Includes enabled `source/edgar_8k` and `source/prediction_event`; July 19 seeding gap is fixed            |
| Persisted source polls            |              unavailable | Source poll status/results are in memory and were lost on shutdown                                        |
| Signal events                     |                        0 | No source or schedule event reached persistence                                                           |
| Session deliveries                |                        0 | Expected downstream of zero signal events                                                                 |
| Dead letters                      |                        0 | No delivery was attempted                                                                                 |
| Equity schedule executions        |          11 shared scans | SPY and QQQ API requests succeeded, but only 8 bars existed for each                                      |
| Crypto schedule executions        |                        8 | All 8 `BTC-USD` OHLCV requests failed                                                                     |
| Prediction selector cycles        |                       97 | All persisted `selector/succeeded`, all diagnostics `0 discovered / 0 verified / 0 accepted / 0 rejected` |
| Agent runs                        |         97 selector runs | 3,000,423 input tokens, 108,319 output tokens, `$0.2352` estimated selector cost                          |
| Decision traces                   |                        0 | No instrument reached a trade cycle                                                                       |
| Trades / approvals / reservations |                0 / 0 / 0 | No order gate or broker placement was reached                                                             |
| Paper positions                   |                        0 | No exposure                                                                                               |
| Equity snapshots                  |                        0 | No equity-series reconciliation is possible                                                               |
| Realized P&L                      | `$0.00` from zero trades | No trading P&L occurred                                                                                   |

### Session Matrix

| Session        | Input path                            |                      Work observed | First divergence                                           | Result   |
| -------------- | ------------------------------------- | ---------------------------------: | ---------------------------------------------------------- | -------- |
| `STRESS-01`    | EDGAR event source                    |   0 events, 0 deliveries, 0 cycles | Indeterminate: no durable poll telemetry                   | 0 trades |
| `STRESS-02`    | EDGAR event source                    |   0 events, 0 deliveries, 0 cycles | Indeterminate: no durable poll telemetry                   | 0 trades |
| `STRESS-03`    | EDGAR event source                    |   0 events, 0 deliveries, 0 cycles | Indeterminate: no durable poll telemetry                   | 0 trades |
| `STRESS-04`    | Mean reversion, SPY/QQQ 1h            | 11 shared scans; 8 bars per symbol | Required 20 warmup bars; strategy never evaluated          | 0 trades |
| `STRESS-05`    | Mean reversion, SPY/QQQ 1h            |   Same shared group as `STRESS-04` | Required 20 warmup bars; strategy never evaluated          | 0 trades |
| `STRESS-06`    | Breakout, BTC-USD 4h                  |        8 scans; 8/8 OHLCV failures | Canonical crypto symbol sent to Alpaca stock-bars endpoint | 0 trades |
| `STRESS-PM-01` | Prediction selector plus event source |                 97 selector cycles | Gamma rows discarded before discovery                      | 0 trades |

### External/Provider Health

| Provider                                   |  OK | Error | Notes                                                                                                                |
| ------------------------------------------ | --: | ----: | -------------------------------------------------------------------------------------------------------------------- |
| Alpaca telemetry rows                      | 248 |    16 | The 16 errors are the instrumented and HTTP layers for 8 failed BTC requests                                         |
| DuckDuckGo                                 | 267 |    92 | 25.6% error rate; retries and other sources still returned evidence, but this was downstream of empty `list_markets` |
| `fetch_url`                                | 148 |     6 | Not the first divergence                                                                                             |
| Stocktwits                                 |  45 |     0 | Not the first divergence                                                                                             |
| Polymarket account/connection              | 108 |     0 | Account health does not validate Gamma discovery parsing                                                             |
| OpenRouter control calls in `api_call_log` |   2 |     0 | `$0.0167`, global/control scope                                                                                      |

## Findings

### P1 High: Scheduled market data drops instrument class and sends `BTC-USD` to Alpaca's stock endpoint

- Status: current and reproduced by runtime telemetry plus current code.
- Expected: the scheduled path should preserve `instrumentClass`, resolve the session's assigned broker, normalize `BTC-USD` to Alpaca's `BTC/USD`, and use the crypto bars endpoint.
- Observed: `BarFetcher` omits `instrumentClass` at `electron/main/services/marketdata/market-data-service.ts:27-31`; the composition root picks the first global Alpaca account and forwards the display symbol unchanged at `electron/main/services/app-services.ts:381-401`; Alpaca classifies a symbol as crypto only when it contains `/` at `electron/main/services/broker/adapters/alpaca-adapter.ts:85-92`.
- Evidence: all 8 `getOhlcv` calls for `BTC-USD/4h` were errors. The recorded HTTP target was `/v2/stocks/BTC-USD/bars`. The always-open crypto schedule persisted `last_success_at` and `consecutive_failures=0` despite these failures.
- First divergence: `MarketDataService.getBars()` removes `input.instrumentClass` when invoking the fetcher at `market-data-service.ts:66-70`.
- Causal chain: scheduled `BTC-USD` -> class discarded -> first global Alpaca adapter -> unnormalized `BTC-USD` -> slash heuristic says stock -> stock endpoint rejects crypto symbol -> exception becomes empty/no signal -> no event, delivery, cycle, or trade.
- Impact/blast radius: `STRESS-06` was structurally unable to evaluate its breakout strategy for the entire run. The same path affects any scheduled canonical crypto symbol and bypasses session-specific routing for every asset class.
- Alternatives rejected: Alpaca credentials and general connectivity were healthy because account/balance calls and SPY/QQQ bars succeeded. Calendar gating is not primary because the subscription used `always-open`. The July 19 detached-method bug is fixed at `electron/main/services/broker/instrumented-broker-adapter.ts:83-99` and has a passing class-adapter regression test.
- Minimal fix: include `instrumentClass` in `BarFetcher`; resolve the adapter through `BrokerRoutingService` for the session/subscription; normalize the canonical symbol through `instrument-normalizer.ts`; send Alpaca `BTC/USD`; remove the global "first Alpaca account" shortcut.
- Regression proof: wire a scheduled `BTC-USD` scan through the production composition path and assert the request reaches `/v1beta3/crypto/us/bars`, not `/v2/stocks/*`; also assert the session's assigned broker account is used.

### P1 High: The equity schedule never had enough bars to evaluate, but every scan was recorded as healthy

- Status: current and demonstrated in `STRESS-04` and `STRESS-05`.
- Expected: mean reversion should receive at least 20 warmup bars or persist an explicit data-readiness failure; a successful provider call should not be treated as a successful strategy scan when no instrument was evaluable.
- Observed: the database contains 8 SPY and 8 QQQ one-hour bars, covering `12:00Z` through `19:00Z`. Mean reversion requires 20 bars. Eleven provider requests per symbol were marked `ok`, but `ScheduledStrategyExecutor` returns `null` without a reason when `bars.length < warmupBars` at `electron/main/services/scheduling/scheduled-strategy-executor.ts:170-171`.
- Evidence: `ohlcv_bars` has exactly 8 rows per symbol; the API log has 11/11 successful `getOhlcv` calls for each; signal events remain zero; both schedule subscribers have zero execution steps. The shared schedule's last success was `19:46:27Z`, correctly before the next NYSE-regular tick after 16:00 ET.
- First divergence: Alpaca's fixed `barCount * 3` wall-clock lookback at `electron/main/services/broker/adapters/alpaca-adapter.ts:67-82` does not compensate for a weekend and closed market hours, so a request for 21 hourly bars returns only the current trading day's bars.
- Causal chain: 21-bar request after weekend -> fixed 63-hour wall-clock window -> only 8 market-hour bars -> strategy warmup check returns `null` -> executor resolves `[]` -> coordinator treats resolution as success at `schedule-coordinator.ts:303-322` -> activity UI says waiting for the next tick while no strategy evaluation occurred.
- Impact/blast radius: both equity sessions missed every possible evaluation in the run. Any scheduled strategy launched after a weekend/holiday or with a sparse feed can remain falsely healthy until enough sessions accumulate.
- Alternatives rejected: "the strategy found no setup" is not supported because `strategy.evaluate()` at `scheduled-strategy-executor.ts:174-179` was never reached. Market closure explains why scans stopped after `19:46Z`, not why the 11 open-market scans were unevaluable.
- Minimal fix: fetch/adaptively widen until the requested warmup count is met, coalesce cached and fetched bars, persist `insufficient_bars` with actual/required counts, and fail the schedule group when every instrument is unevaluable while retaining per-instrument isolation for partial batches.
- Regression proof: pin a Monday-after-weekend clock, request 21 hourly bars, and assert the production fetcher returns at least 20 ordered bars or an explicit failed schedule state. Add all-failed and partial-failure tests around `ScheduledStrategyExecutor` and `ScheduleCoordinator`.

### P1 High: Polymarket discovery expects an obsolete `tokens` field and discards every live market

- Status: current and independently verified against the live Gamma response.
- Expected: `list_markets` should normalize the broker's current discovery response into real, quoteable YES/NO candidates and distinguish provider/parse failure from a genuine empty market set.
- Observed: `PolymarketMarketRow` declares only `tokens` for outcome data at `electron/main/services/broker/adapters/broker-adapter.ts:175-186`; the candidate engine maps missing `row.tokens` to `[]` and skips the market at `electron/main/services/signals/scoring/prediction-market-candidate-engine.ts:46-79`.
- Evidence: a metadata-only live request showed both sampled rows had no `tokens`; each had JSON-encoded string fields `clobTokenIds`, `outcomes`, and `outcomePrices`, each decoding to two items. All 97 persisted selector diagnostics were `discovered=0`, `verified=0`, `accepted=0`, `rejected=0`. All 97 agent messages contained a `list_markets` tool call.
- First divergence: raw Gamma rows are cast directly at `electron/main/services/broker/adapters/polymarket-adapter.ts:1231-1243` instead of validated and normalized at the adapter boundary.
- Causal chain: Gamma returns valid current shape -> unchecked cast -> `tokens=[]` fallback -> every row skipped -> `list_markets` returns no symbols -> both discovery workers submit valid empty arrays -> selector stage persists `succeeded` -> five-minute retry -> 97 repetitions, no decision traces or trades.
- Impact/blast radius: `STRESS-PM-01` spent `$0.2352`, 3,000,423 input tokens, and 108,319 output tokens without ever evaluating one market. The prediction selector cannot converge while the contract mismatch remains.
- Alternatives rejected: the July 19 missing-tool defect is fixed. `list_markets` is registered and required, and runtime messages prove it was called. Risk, liquidity, quote, and market-hours gates are not primary because no candidate reached verification. The model did not invent symbols in this run; it received an empty authoritative universe.
- Minimal fix: parse `clobTokenIds`, `outcomes`, and `outcomePrices` at the adapter boundary with schema validation, equal-length checks, typed normalization, and explicit provider/parse errors. Do not collapse non-2xx, routing, malformed JSON, and a legitimate empty set into the same `[]` result.
- Regression proof: replace the synthetic `tokens` fixture in `prediction-market-candidate-engine.test.ts:10-23` with the current Gamma shape; assert distinct YES/NO candidates and token metadata; add malformed-array and non-2xx failure cases.

### P1 High: Prediction outcome identity and executable metadata are lost after discovery

- Status: current latent blocker; not reached in this run because the earlier Gamma parser returned zero candidates.
- Expected: YES and NO outcomes must remain distinct from discovery through verification, quote selection, risk, final selection, and order placement, with the exact outcome token selected deterministically.
- Observed: discovery creates YES and NO rows with the same `pm:<conditionId>` symbol at `prediction-market-candidate-engine.ts:92-115`; live sampled condition IDs produce 69-character canonical symbols, but `candidateSchema` caps symbols at 20 characters at `electron/shared/ai/selector-candidate.ts:16-23`; `list_markets` omits executable metadata at `electron/main/services/tools/prediction-market-tools.ts:27-33`; the worker candidate schema has no `predictionOutcome` or metadata fields at `electron/main/services/pipeline/definitions/selector.schemas.ts:4-23`; merger identity is only class plus symbol at `selector-candidate-merger.ts:20-23`; final selection replaces metadata with catalyst text at `electron/main/services/signals/scoring/selector-submission-builder.ts:10-21`.
- Evidence: `getMarketSnapshot()` chooses the first market token regardless of intended outcome at `electron/main/services/broker/adapters/polymarket-adapter.ts:206-230`, while order placement rejects selections without `conditionId` and `outcomeTokenId` at `polymarket-adapter.ts:1289-1319`.
- First divergence: the typed worker boundary cannot represent the outcome identity returned by discovery.
- Causal chain: normalized YES/NO candidates -> 69-character symbols exceed the schema cap or both outcomes share one symbol -> metadata omitted -> schema strips outcome -> merger collapses outcomes -> quote reads first token -> final selection lacks executable token metadata -> order is rejected, or analysis is performed against the wrong outcome quote.
- Impact/blast radius: fixing Gamma parsing alone will not make prediction trading safe or functional. The branch remains structurally unable to produce an order-ready selection, and quote direction can disagree with the intended outcome.
- Alternatives rejected: this is not a model-quality issue; the deterministic TypeScript schemas and builders remove the required fields even if the model preserves them conceptually.
- Minimal fix: support the validated 69-character canonical market symbol or replace it with a shorter server-owned candidate ID; add a deterministic outcome identity to the typed candidate contract and merge key; preserve it through verification and final selection; resolve opaque token metadata server-side rather than trusting the model to reproduce token IDs. Quote the selected outcome token, not the first token.
- Regression proof: feed one real-length market ID with YES and NO outcomes through the full selector finalizer; assert the symbol passes validation, both outcomes remain distinct, each receives its own quote, and the final `InstrumentSelection` passes `parsePredictionMetadata()` for the selected outcome.

### P2 Medium: Successful empty selectors reset the ten-skip watchdog before recording the next skip

- Status: current and exercised 97 times.
- Expected: ten consecutive `model_no_trade` selector outcomes should set the session to `attention_required` and stop healthy-looking five-minute retries until reviewed.
- Observed: every selector execution was technically successful, so `runPhaseCycle` calls `clearAttentionRequired()` and `resetHardFailureStreak()` before the empty handoff at `electron/main/services/orchestration/cycle/orchestrator-step.ts:175-213`. `resetHardFailureStreak()` also resets `consecutiveSameSkipCount` at `trading-cycle-context.ts:282-285`. The empty handoff then records one `model_no_trade` and schedules another retry at `instrument-queue.ts:76-119`.
- Evidence: 97 consecutive empty successful selector rows, 96 retry events, no `attention_required` status, no watchdog event, and no retry suppression. Average selector duration was about 25 seconds, with five minutes scheduled after completion.
- First divergence: hard-failure recovery and no-trade streak recovery share one reset method.
- Causal chain: successful empty selector -> skip count reset to zero -> empty handoff increments to one -> five-minute timer -> repeat forever -> threshold ten never reached.
- Impact/blast radius: the current run wasted `$0.2352`; at the same rate, continuous operation would consume about `$0.64` and 8.2 million input tokens per day without market evaluation. The cost figures are estimates because 200 log entries state that pricing-table fallback was used.
- Alternatives rejected: the alarm logic itself works when invoked directly; the passing `consecutive-skip-alarm.test.ts` does not cover real success-then-empty ordering. Shutdown behavior is not primary: the final in-flight selector drained and its handoff was correctly ignored after stop.
- Minimal fix: split hard-failure reset from no-trade streak reset. Clear the no-trade streak only after substantive progress, such as a non-empty selector handoff or completed trade cycle.
- Regression proof: execute ten real successful-empty phase cycles through `runPhaseCycle` and `handleResolvedInstruments`; assert `attention_required` after cycle ten and no eleventh refill timer.

### P2 Medium: Event-source health is not durable enough to explain zero events

- Status: current observability/correctness defect; whether an upstream source failure occurred in this run is unverified.
- Expected: source status should distinguish a recent successful zero-result poll, a filtered feed, an HTTP failure, a parse failure, and a stalled poller, with durable timestamps and counters available after shutdown.
- Observed: the run persisted zero signal events, deliveries, and dead letters. The activity tracker claimed `Subscription live - waiting for next signal` 526 times for each EDGAR session because it checks only whether registry status is `running` at `electron/main/services/sessions/session-activity-tracker.ts:527-536`.
- Evidence: source poll results exist only in runtime objects. After shutdown there is no row proving when EDGAR or Prediction last polled, what HTTP status it received, or how many rows each gate dropped. In addition, Prediction's fetch helper returns `[]` for every non-2xx response at `electron/main/services/signals/sources/prediction-event-signal-source.ts:292-297`; the caller then marks the source `running` with a successful zero-result poll at `prediction-event-signal-source.ts:129-161`.
- First divergence: transport failure is converted into the same empty array as a healthy no-market result.
- Causal chain: possible non-2xx or malformed upstream result -> `[]` fallback -> source status `running` -> activity UI says subscription live -> no `signal_events` -> post-run investigation cannot distinguish quiet from broken.
- Impact/blast radius: the three EDGAR sessions cannot be assigned a proven root cause from current evidence. Prediction event subscriptions have the same diagnostic blind spot. The zero-event result must remain indeterminate rather than being labeled healthy market inactivity.
- Alternatives rejected: the July 19 missing-source-row defect is fixed. The current DB has enabled `source/edgar_8k` and `source/prediction_event`, and startup reconciliation exists in `ensure-live-signal-sources.ts`. This proves attachment availability, not successful polling.
- Minimal fix: throw on non-2xx; validate response JSON; persist per-source `last_poll_at`, `last_success_at`, HTTP/parse status, detected/passed/dropped/error counts, and cadence; derive session health from recent successful polls rather than interval existence.
- Regression proof: make a Prediction 503 set durable source status to error and surface `input_source_dead`/degraded health; prove a successful zero-result poll remains healthy; add an EDGAR transient lookup-failure case. Fix the current Prediction dedupe test, which logs `Body is unusable` yet passes because it accepts `passed === 0` without asserting `errors=[]`.

### P2 Medium: Periodic observations are stored as transitions, inflating analytics and displaying a stale next tick

- Status: current and demonstrated by this run's dirty activity-monitoring implementation.
- Expected: `session_activity_transitions` should append on state/condition change, analytics counts should reflect real transitions, and the displayed next scan tick should advance.
- Observed: 5,485 transition rows were written in 8 hours 45 minutes. `STRESS-04` and `STRESS-05` each wrote 1,007 rows; `STRESS-06` wrote 980; each EDGAR session wrote 527. Equity activity repeated `Waiting for next scan tick at Mon, 1:15 PM EDT` from `17:16Z` through `01:45Z`.
- Evidence: the tracker sweeps every 60 seconds at `electron/main/services/sessions/session-activity-tracker.ts:300-303`, immediately persists every repeated condition at `session-activity-tracker.ts:336-376`, and the repository unconditionally appends a row at `electron/main/db/repositories/sessions/session-activity-repo.ts:49-77`. After 30 minutes, scheduled sessions report both `no_signal_stale` and `waiting_scan_tick`, producing roughly two rows per sweep.
- First divergence: `reportCondition()` is documented as idempotent but increments and persists unchanged conditions on every sweep.
- Causal chain: unchanged detector observation -> count increment -> unconditional transition insert -> analytics counts every snapshot at `electron/shared/domain/session-activity-analytics.ts:57-92` -> inflated frequency/severity/transition totals and compressed history window.
- Additional cause of stale time: `ScheduleCoordinator` calculates the next `nextRunAt` in `arm()` at `schedule-coordinator.ts:224-264`, but persists state before re-arming at `schedule-coordinator.ts:341-371`. The future tick remains in memory and the DB retains the tick that just fired. Activity text also remains the original string when condition messages change.
- Impact/blast radius: UI "last updated," transition counts, condition frequencies, and severity counts are misleading; the default 50-row timeline can represent only about 25 minutes for a two-row-per-minute session; the 200-row analytics window can collapse to about 100 minutes.
- Alternatives rejected: the volume is not event-driven trading activity. Counts align with one minute sweeps before 30 minutes and two writes per sweep afterward. Existing tests intentionally accept repeated waiting snapshots but do not verify transition semantics or schedule-time advancement.
- Minimal fix: make unchanged `reportCondition()` calls true no-ops; persist the newly armed `nextRunAt`; update top-level activity when its owning condition message advances; keep periodic observations separate if occurrence counts are required.
- Regression proof: run repeated unchanged sweeps and assert one transition, condition count one, and stable `updatedAt`; activate both stale and waiting detectors and assert the second unchanged sweep adds no rows; advance the coordinator clock and assert the DB/UI next tick moves forward.

## Historical Finding Re-Verification

| July 19 finding                            | Current status                           | Evidence                                                                                                       |
| ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Detached `getOhlcv` loses `this`           | Fixed                                    | Closure calls `inner.getOhlcv(...)` directly at `instrumented-broker-adapter.ts:83-99`; regression test passes |
| EDGAR/Prediction live source rows absent   | Fixed                                    | Current DB contains enabled runtime rows; startup reconciliation was added in commit `00a41a5`                 |
| Empty market-calendar registry             | Fixed                                    | `app-services.ts:904` uses `getMarketCalendarRegistry()`; built-in calendar tests pass                         |
| Calendar lookup fail-open                  | Still current, not triggered in this run | `schedule-coordinator.ts:283-294` still catches missing calendars and treats them as open                      |
| Prediction selector lacks market discovery | Partially fixed but still nonfunctional  | `list_markets` exists and was used; current Gamma response shape is discarded                                  |
| Weak model hallucinated symbols            | Not reproduced                           | This run used `deepseek/deepseek-v4-flash`; workers used `list_markets` and returned empty candidates          |

## Data and Reconciliation

- Closed trades: 0; realized P&L is therefore `$0.00` by an empty sample, not evidence of strategy profitability.
- Open trades and paper positions: 0; no unrealized P&L or exposure existed at shutdown.
- Approvals and capital reservations: 0; no capital was reserved.
- Broker balance caches: Alpaca `$100,000` and Polymarket `$100,000`, both refreshed at `2026-07-21T01:41:27.770Z`.
- Local `paper_balances`: Polymarket remained `$100,000` from a `$100,000` starting balance. Alpaca balance is represented by broker account cache/remote paper account rather than a local `paper_balances` row.
- Equity snapshots: 0. No total-equity change, marks-stale check, drawdown, or equity-to-balance reconciliation can be calculated.
- Selector AI cost: `$0.2352` from `agent_runs`, estimated through pricing-table fallback. Global control calls added `$0.0167` in `api_call_log`. Search/fetch telemetry recorded `$0.00` cost. These categories are presented separately and were not subtracted from trading P&L.
- The 97 selector rows are schema-valid executions, but operationally all were empty. Their `session_execution_steps.outcome` is null; the no-trade meaning appears in orchestrator events/failure history rather than the canonical step outcome.

## Observability Gaps

- `api_call_log.status='ok'` means the adapter promise resolved, not that the requested number of bars was returned or a strategy could evaluate.
- Schedule success means `executor.execute()` resolved, even when every instrument failed or had insufficient data.
- Source poll status/results are not durable, so a stopped-run investigation cannot distinguish quiet feeds from failed feeds.
- Selector steps are persisted `succeeded` with null outcome even when zero instruments are accepted.
- Activity "transitions" are periodic snapshots and directly contaminate the analytics now exposed in the UI.
- The application does not log/persist a commit SHA or worktree fingerprint at startup, so a dirty-worktree run cannot be tied to exact source bytes.
- A refused second launch logged an unrelated uncaught exception, `sonic boom is not ready yet`, before the incumbent shut down normally. It did not cause the trading failures, but startup logging should not turn a normal single-instance refusal into an uncaught exception.
- Documentation drift: `docs/engineering/e2e-testing-guide.md:110-125` prescribes `npm`/`npx`, while current `package.json` and coding guidelines require Bun.

## Recommended Fix Order

1. Repair scheduled market-data routing: preserve class/session ownership, normalize symbols, use assigned adapters, and fail explicitly when all instruments are unevaluable. This restores `STRESS-04..06` and removes false schedule health.
2. Normalize the current Gamma shape and carry outcome identity/metadata end-to-end before enabling prediction orders. A parser-only patch is insufficient.
3. Split hard-failure and no-trade watchdog resets so repeated empty selectors reach `attention_required` and stop uncontrolled retries.
4. Persist source-poll health and fail non-2xx/parse errors loudly; base activity health on recent successful polls.
5. Make activity condition updates idempotent and persist the newly armed schedule time, then correct analytics semantics.
6. Add composition-level tests at the seams that failed here. Existing component tests are green because they use already-normalized symbols, synthetic Gamma `tokens`, direct alarm calls, and repeated-snapshot expectations.
7. Re-run the same seven-session matrix only after items 1-5. Require at least one evaluated strategy decision per scheduled group and non-empty, outcome-safe prediction discovery before using trade count as the soak verdict.

## Residual Risks and Open Questions

- If "last night" refers to a different Sunday-night database, it is no longer present at the default active path. The July 19 historical report is not a substitute for that missing runtime data.
- EDGAR's zero-event result remains unclassified. A future run needs durable poll status and per-gate counts to prove whether zero was expected.
- The active worktree contains a large staged activity/progress change. This review followed only incident-relevant paths and is not a complete review of all 48 staged files.
- Unknown calendar IDs still fail open. It did not trigger here because built-ins were registered, but it remains unsafe configuration behavior.
- The focused suites and typecheck pass, but they do not cover the exact production compositions that failed. No live-order or paper-order experiment was performed.

# Overnight Stress Session Review — 2026-07-19

**Verdict: zero trades was structurally guaranteed. Three code bugs and one seeding gap meant no session could ever reach the trade stage. This was not bad luck or a quiet market.**

- Matrix: 7 sessions (`STRESS-01..06` + `STRESS-POLY`) created 2026-07-18 23:01 PDT per `docs/prompts/setup-everything.md`, all `paper_only`.
- Outcome after ~11h: **0 trades, 0 decision traces, 0 signal deliveries, 0 trade approvals**. Only `STRESS-POLY` did any pipeline work (36 selector cycles, all rejected, ~$0.21 AI spend). It was stopped at 02:53 PDT; the six Alpaca sessions are still `active` and idle.
- Evidence sources: `~/Library/Application Support/exva/exva.db`, `~/.exva/logs/exva-2026-07-18.log`, source under `electron/main/**`. Method per `docs/engineering/debugging-guide.md`.

---

## Per-session inspection

| Session | Experience | Broker | Status | Cycles | Signals received | Trades | Why nothing traded |
|---|---|---|---|---|---|---|---|
| STRESS-01 | edgar-catalyst | seed-alpaca-paper ($10k) | active | 0 | 0 | 0 | Bug 2 — EDGAR poller never exists |
| STRESS-02 | edgar-catalyst | seed-alpaca-paper ($10k) | active | 0 | 0 | 0 | Bug 2 |
| STRESS-03 | edgar-catalyst | seed-alpaca-paper ($10k) | active | 0 | 0 | 0 | Bug 2 |
| STRESS-04 | rules-mean-reversion | seed-alpaca-paper ($10k) | active | scans ran | 0 | 0 | Bug 1 (bars fetch crash) + Bug 3 (weekend scans should've been gated anyway) |
| STRESS-05 | rules-mean-reversion | seed-alpaca-paper ($10k) | active | scans ran | 0 | 0 | Same as STRESS-04 |
| STRESS-06 | rules-breakout | seed-alpaca-paper ($10k) | active | scans ran | 0 | 0 | Bug 1 — BTC/ETH bar fetches crashed; this was the one session that genuinely could have traded overnight |
| STRESS-POLY | prediction-event-edge | seed-polymarket-paper ($10k) | stopped 02:53 PDT | 36 selector cycles | 0 event signals (Bug 2) | 0 | Bug 4 — selector hallucinated market symbols, every `get_quote` → "market not found", all candidates rejected |

Every session had a correct `session_input_subscriptions` row — provisioning verification in the setup prompt passed. The failures are all downstream of subscription bookkeeping.

---

## Root causes

### Bug 1 (P0, code): `getOhlcv` called unbound → every bar fetch crashed

`electron/main/services/broker/instrumented-broker-adapter.ts:94-98` detaches the method:

```ts
const getOhlcv = inner.getOhlcv;          // loses `this`
...
return getOhlcv(instrumentSymbol, timeframe, barCount);
```

`AlpacaAdapter.getOhlcv` (`electron/main/services/broker/adapters/alpaca-adapter.ts:491,515`) calls `this.now()` → `TypeError: Cannot read properties of undefined (reading 'now')`.

Evidence: **110× `getBars failed`** in the log (`scope: scheduled-strategy-executor`); `api_call_log` shows SPY/1h ×49 error, QQQ/1h ×49 error, BTC-USD/4h ×12 error, zero successes. Both mean-reversion sessions and the breakout session therefore produced **zero scan signals all night**.

Fix: call `inner.getOhlcv(...)` directly, or `inner.getOhlcv.bind(inner)`. Note every other wrapped method (`getMarketSnapshot` etc.) uses `() => inner.method(...)` and is fine — only `getOhlcv` was rewritten into the detached form.

### Bug 2 (P0, seeding/design): event-source sessions have no live signal source behind them

The runtime only instantiates pollers from rows in the `signal_sources` table (`signal-service.ts:280 bootstrapFromDb` → `signal-source-registry.ts`). That table contains exactly two rows: `manual_source` and `mock-rehearsal-signal`. **No `edgar_8k` row, no `prediction_event` row exists**, so the EDGAR and Prediction Event pollers were never created — the log has zero EDGAR/prediction source activity across the entire run.

`source_definitions` (`source-def/edgar-8k-catalyst`, `source-def/prediction-event-edge`, enabled=1) are metadata for fanout only; nothing converts them into live sources. So `STRESS-01..03` and the event path of `STRESS-POLY` were subscribed to feeds that structurally cannot emit.

The setup prompt says "Enable only the required seeded signal sources" — there were none to enable, and the setup agent had no way to notice: `list_signal_sources` returns the two rows above, and nothing cross-checks subscriptions against live sources.

Fix options: seed `signal_sources` rows for `edgar_8k` / `prediction_event` alongside the source-definition seeds, or auto-create/start a live source when an event_source subscription references its definition. Also add a launch-gate check: an `event_source` subscription with no running backing source should surface as a session WARN (same severity as `Default input provisioning failed`).

### Bug 3 (P1, code): market calendar registry is empty → weekend gating silently disabled

`electron/main/services/app-services.ts:896` builds `new MarketCalendarRegistry()` (empty) instead of `getMarketCalendarRegistry()` which registers `nyse-regular`, `nyse-extended`, `always-open` (`market-calendar-registry.ts:92-104`).

Evidence: 61× `calendar lookup failed, treating as open` with `Market calendar not found: "nyse-regular". Known calendars: ` (empty list). The coordinator's own doc comment says it "must hard-fail on misconfiguration", but `schedule-coordinator.ts:279-290` catches and treats as open — so mean-reversion scans ran every 15 min through a closed weekend market, burning bar-fetch attempts (which then hit Bug 1).

Fix: use the singleton at `app-services.ts:896`; separately decide whether "treat as open" is ever acceptable — a missing calendar should probably pause the group and emit a session event, not fake-open.

### Bug 4 (P0 for Polymarket branch, design): selector can't discover real market IDs, so it invents them

`STRESS-POLY` ran 36 selector cycles. Its scout workers only have `search_web` / `fetch_url` / `get_quote`. There is **no tool to list or search actual Polymarket markets**, even though the adapter already talks to the gamma API (`polymarket-adapter.ts:1233` lists active markets). The model (google/gemma-4-31b-it) read blog posts and invented plausible-looking symbols — `FED-JULY-2026`, `FED_HOLD_JULY_2026`, `CLARITY_ACT_2026`, `WC26-ARG-WIN`, `BTC-JUL-67500`, `ECB-SEP26-25BPS` — and every `get_quote` returned `{'error': 'market not found'}` (16 calls, 0 hits). The liquidity gate then correctly rejected all candidates: `Missing get_quote trace or valid quote snapshot`.

Result: 36 cycles × ~$0.006 = ~$0.21 spent to reject hallucinations. This will never converge no matter how long it runs.

Fix: expose a `search_markets` / `list_markets` tool backed by the gamma API to the prediction selectors, and instruct workers that only IDs from that tool are valid `get_quote` inputs.

---

## Secondary problems

1. **Silent scan failure (fail-loud violation).** Bar-fetch crashes are logged as WARN and swallowed; `schedule_runtime_states` shows `consecutive_failures=0`, 2ms runs, no error, and no session event is emitted. In the UI the sessions look healthy while their data pipeline is 100% dead. Same anti-pattern the debugging guide explicitly forbids ("broad fallback logic that masks failure modes") — it hit twice in one night (bars + calendar).
2. **No zero-activity watchdog.** Six sessions sat `active` for 11+ hours with zero signals, zero cycles, zero events past startup. Nothing flags "session has consumed no input since start."
3. **Weak model for every role.** `OPEN_ROUTER_MODEL=google/gemma-4-31b-it` drove all agents, including the control agent and selectors. Frequent `worker terminal output validation failed; retrying once` (schema non-compliance) and hallucinated symbols are partly model-capability issues. A 31B instruct model is a poor fit for selector/validator roles.
4. **Cost telemetry is estimated, not actual.** Every run logged `agent run cost estimated from pricing table fallback` — OpenRouter actual-cost accounting isn't wired up.
5. **Orphan alpha scan.** A global `alpha:funding-basis` scan emitted 2 crypto dislocation signals (BTC/USD, ETH/USD) that were `dropped_pre_fanout: no_subscribers`. Harmless but wasted work and misleading in the signal log.
6. **Timing expectation mismatch.** The matrix launched Saturday 23:01 PDT. Even with all bugs fixed, STRESS-01..05 (equities, EDGAR) could not have traded before Monday's open — weekend has no NYSE session and effectively no 8-K flow. Only STRESS-06 (crypto) and STRESS-POLY (24/7 prediction markets) were live candidates overnight — and both were killed by Bugs 1 and 4. Future overnight soaks should be weighted to 24/7 branches or run on weeknights.
7. **Session stop anomalies.** `STRESS-POLY` logged `Session stopped.` then `Session paused.` (both runtime paths fired, events out of order), and the stop was immediately followed by an `ipc handler failed` `INVALID_PAYLOAD` on channel `session:go-global` — the renderer sends a payload the main-process validator rejects.
8. **Log rotation.** All entries through 11:16 today are in `exva-2026-07-18.log` — the filename is fixed at boot rather than rolling daily, which undermines the 7-day-retention scheme on long-running processes.
9. **Search provider flakiness.** `api_call_log` shows duckduckgo 281 errors vs 294 ok (~49% error rate); retries recovered, but selector latency and cost pay for it.

---

## Recommended fix order

1. **Bug 1** — one-line fix (`instrumented-broker-adapter.ts:98`), unblocks all scheduled-scan experiences. Add a regression test that calls the instrumented adapter's `getOhlcv` against a class-based inner adapter.
2. **Bug 3** — one-line fix (`app-services.ts:896`), plus decide the fail-open vs fail-closed policy for missing calendars.
3. **Bug 2** — seed/auto-create live sources for event experiences + add the missing launch gate.
4. **Bug 4** — add market-discovery tool for prediction selectors.
5. Fail-loud pass: scan failures and empty-registry conditions must produce session events, not just log WARNs (secondary items 1–2).
6. Re-run the matrix on a weeknight, or restrict overnight soaks to breakout + Polymarket branches.

Until items 1–3 land, restarting the sessions will reproduce the same zero-trade night.

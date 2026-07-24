# Trading Recovery + Backtesting Launch — Implementation Handoff

**Date:** 2026-07-23
**Status:** Ready to implement. All root causes verified against runtime evidence (DB, logs, live SEC feed) and current source on `main` @ `5519393`. No code has been written yet.
**Goal:** Zero trades are happening. Fix the three live blockers, make the existing Backtest Lab actually usable via historical backfill, add one new backtest-validated experience, and rebalance `docs/prompts/setup-everything.md`.

---

## 0. Context an implementing agent MUST internalize first

### 0.1 What is already fixed — do NOT re-fix

All seven findings from `docs/reviews/2026-07-20-current-system-and-stress-run-review.md` are **already fixed on main** (verified file-by-file):

| 7/20 finding | Status | Evidence |
|---|---|---|
| Scheduled market data dropped `instrumentClass` (BTC-USD → stock endpoint) | Fixed | `scheduled-strategy-executor.ts:168` threads class; `marketdata/session-routed-get-bars.ts:35-76` resolves session adapter + normalizes wire symbol; `alpaca-adapter.ts:505-530` routes crypto/options/stock by wire shape |
| Fixed 3× lookback → insufficient bars silently healthy | Fixed | `alpaca-adapter.ts:75` widening multipliers `[3,7,14,30]`; `scheduled-strategy-executor.ts:243-253` explicit `insufficient_bars` diagnostic |
| Gamma `tokens` obsolete → all markets discarded | Fixed | `broker-adapter.ts:230-278` normalizes both legacy `tokens` and `clobTokenIds`/`outcomes`/`outcomePrices`; `polymarket-adapter.ts:1282-1287` throws if rows present but none usable |
| Prediction outcome identity lost after discovery | Fixed end-to-end | `selector-candidate.ts:20` symbol cap now 160; `predictionOutcome` + `instrumentMetadataJson` flow through `selector.schemas.ts:11-12`, merger identity key, and server-owned `rehydratePredictionMetadata` in the finalizer `selector-submission-builder.ts:44-135`; `polymarket-adapter.ts` `parsePredictionMetadata`/`pickTokenForOutcome` hard-fail on missing outcome tokens |
| Skip watchdog reset by empty selectors | Fixed | `trading-cycle-context.ts:283-291` split `resetHardFailureStreak` / `resetNoTradeSkipStreak`; `orchestrator-step.ts:198-204` only clears no-trade streak on `substantiveProgress` |
| Source poll health not durable; non-2xx → `[]` | Fixed | `signal_source_polls` + `signal_source_runtime_states` tables written via `persist-source-poll.ts`; EDGAR and prediction sources now `throw` on non-2xx |
| Activity transition inflation / stale nextRunAt | Fixed (cosmetic residue only) | `session-activity-tracker.ts:341-358` no-op on unchanged condition; `schedule-coordinator.ts` persists after re-arm |

The pipeline now runs end-to-end: signals fire, deliveries happen, cycles execute, decision traces persist. The blockers are three NEW defects, below.

### 0.2 Runtime evidence sources

- Active DB: `~/Library/Application Support/exva/exva.db`. Inspect read-only:
  `sqlite3 "file:$HOME/Library/Application%20Support/exva/exva.db?mode=ro&immutable=1" "<sql>"`
- Logs: `~/.exva/logs/exva-YYYY-MM-DD.log` (pino JSON; `jq` them).
- Conventions: `docs/engineering/CODING_GUIDELINES.md` (Bun, vitest, typed `AppError`s, ipc → services → repos layering). Run `bun run typecheck` + `bunx vitest run <suites>` after each phase.
- The 7/20 review's key lesson: **component tests passed while production composition failed.** Every phase below requires at least one composition-level test that drives real components in sequence with only outermost I/O faked.

---

## 1. Root causes (verified, with evidence)

### Root cause A — the edge gate vetoes 100% of rules signals (THE "nothing trades" bug)

**Runtime evidence (July 23 run):**
- Log: `risk_gate failed: Net edge -3bps below floor 0bps` repeated for sessions `ETF-REVERSION-PRIMARY` (`c5122f41-…`) and `ETF-REVERSION-CONTENDER` (`02e3680f-…`).
- `session_signal_deliveries`: every ETF delivery `rejected` with `drop_reason=risk_gate_rejected`.
- `decision_traces` (4 rows, all SPY): `edgeEstimate = {modelVersion: "proxy-1", predictedProbability: 0.5187, expectedGrossReturnBps: 0, expectedCostBps: 3, expectedNetReturnBps: -3, uncertaintyBps: 0}`.

**Code chain** (`electron/main/services/pipeline/implementations/inputs/trade-engine-input-builders.ts`):
- `computePreTradeEconomics` lines 74–77:
  ```ts
  const tpBps = (input.takeProfitPct ?? 0) * 100;
  const slBps = (input.stopLossPct ?? 0) * 100;
  const expectedGrossReturnBps = confidence * tpBps - (1 - confidence) * slBps;
  ```
- Line 95: `const netOdds = slBps > 0 ? tpBps / slBps : 0;` → `rawKelly = 0` too.
- TP/SL come from `executionProfile`, which gets them verbatim from **session riskConfig** (`executionProfileInputBuilder.build`, lines 244–248: `risk: { stopLossPct: ctx.strategyContext.riskConfig.stopLossPct, takeProfitPct: ctx.strategyContext.riskConfig.takeProfitPct, … }`).
- Gate: `evaluateEdgeDecision(...)` at lines 370–383 with `minNetEdgeBps: 0` → any net < 0 → skip → `createOutcomeError(..., reasonCategory: "cost_gate")`.

**Config evidence:** `sessions.strategy_config_json` for ETF-REVERSION-PRIMARY:
```json
"riskConfig": {"maxPositionUsd": 500, "stopLossPct": null, "stopLossType": "trailing_atr",
  "atrStopMultiplier": 2, "kellyFraction": 0.25, ...}   // no takeProfitPct key
```
`DEFAULT_RISK_SECTION` in `electron/shared/domain/session-strategy-config-defaults.ts:38-41` also ships `stopLossPct: null, takeProfitPct: null, stopLossType: "fixed_pct", atrStopMultiplier: null` — so **any default-config session is also structurally untradeable**.

**Conclusion:** sessions using ATR-trailing stops (a legitimate config) or defaults have `tpBps = slBps = 0` → gross edge always 0 → net always −cost → 100% veto. This is a config-shape bug, not a market view.

### Root cause B — EDGAR drops 100% of filings (not "rare signals")

**Runtime evidence:** `signal_source_polls` for `source/edgar_8k`: 37 polls, all `outcome=success`, `detected=1480, passed=0, dropped=1480`. Zero EDGAR `signal_events` ever. Seeded config is `{}` — no `cikWhitelist`, no `itemCodeWhitelist`, `minFilingAgeMinutes` defaults 0, so none of the configured filters explain it.

**Code:** `electron/main/services/signals/sources/edgar-signal-source.ts`
- Line 133: `const cik = extractCik(entry.id);`
- Line 309: `function extractCik(id) { return id.match(/CIK=([0-9]+)/i)?.[1] ?? null; }`
- Lines 140–144: `cik == null` → `ticker == null` → `dropped += 1; continue;`

**Live feed verification (fetched 2026-07-23):** entry `<id>` is
`urn:tag:sec.gov,2008:accession-number=0001493152-26-034443` — **no `CIK=` substring exists**. So `extractCik` returns null for every entry and every filing is dropped. The CIK IS present in two other places per entry:
- `<title>`: `8-K - Cycurion, Inc. (0001868419) (Filer)`
- `<link href>`: `https://www.sec.gov/Archives/edgar/data/1868419/000149315226034443/...`

**Secondary issues:**
- User-Agent is `"Exva Signal Monitor"` (lines 123, 243). SEC fair-access policy requires a UA with a contact email; generic UAs get 403'd eventually. Works today, fragile.
- `dropped=1480` has **no reason breakdown** — the poll persistence has `detected/passed/dropped/errors_json` columns but no per-gate counters, which is why this took a runtime+live-feed investigation to diagnose.

### Root cause C — Polymarket selector pipeline failures

**Runtime evidence (July 22 log, session `POLYMARKET-DISCOVERY-RESOLUTION` = `0c7d73fa-…`):**
- 10× `worker prompt exceeds RUNTIME_DEFAULTS.prompt limits (content unchanged — shorten session config or worker task)`
- 6× `selector failed: Stage 'discovery' in phase 'selector' produced insufficient successful workers (0/1). Rejections: openrouter provider request failed after 5 attempt(s) (timeout) | …`
- 8× zod worker-output validation failure: `{"code":"invalid_type","expected":"array","received":"undefined","path":["candidates"],"message":"Required"}`
- The single delivery that reached the session died with `drop_reason=fundamental_failed` (re-examine only after the above are fixed — likely downstream of degraded inputs).

**Code:**
1. **Prompt oversize is warn-only and the bloat source is known.** `electron/main/services/pipeline/prompting/worker-prompt-builder.ts:101-110` only `logger.warn`s when limits (8k system / 16k user chars, `electron/shared/ai/ai-phase.ts:176-179`) are exceeded — content unchanged. The bloat: `electron/main/services/pipeline/engines/input/prediction-market-candidates.ts:21` appends up to 20 **full `JSON.stringify`'d Gamma candidate objects** (each huge: description, dates, liquidity, token arrays…) to the selection instructions.
2. **Global 60s LLM timeout too short for tool-looping discovery workers.** `electron/main/services/llm/runtime-retry.ts:13`: `RETRY_CONFIG = { timeoutMs: 60_000, backoffMs: [1s,2s,4s,8s], maxRetries: 4 }` — module const, not per-phase configurable. Discovery workers run `list_markets` + web-search tool loops and legitimately exceed 60s. Note the discovery stage already has `toleratePartialFailure: true, minSuccessfulWorkers: 1` (`selector.phase.ts:112-134, 226-228`) — do not loosen the floor; raise per-worker success.
3. **Missing `candidates` key.** Truncated/timed-out workers emit terminal output that fails `candidateOutputSchema` (`pipeline/definitions/selector.schemas.ts`). Validation site: `pipeline/phases/interpreter.ts` (rejection recorded ~line 291).
4. **Latent live-only auth bug:** `electron/main/services/broker/adapters/polymarket-adapter.ts:1173-1178` memoizes `this.authClientPromise`; a rejected `createAuthedClient()` promise is cached forever → one bad handshake wedges live auth until process restart. Paper/ghost mode is unaffected (all paper paths branch to `getReadOnlyClient()` first).

### Backtesting — ALREADY EXISTS; the gap is data

Do not build a backtest engine. What exists (verified):
- **Engine:** `electron/main/services/backtest/replay-engine.ts` — `runBacktest(spec)`: purged walk-forward folds (`purgedWalkForwardFolds` from `electron/shared/quant/statistics.ts`), per-fold Sharpe/expectancy/win-rate/maxDD, cost model (spread+fee+slippage bps), exits via stop/take/maxHold (`resolveExitIndex`), determinism `runHash`. `DeterministicStrategy` interface (`{id, warmupBars, evaluate(bars, ctx)}`) is **the same object live `ScheduledStrategyExecutor` runs** — pure over `OhlcvBar[]`, no clock/DB/IO.
- **Orchestration:** `electron/main/services/operator/backtest-lab-service.ts` — `run/sweep/compare/rerunFromSpec/listRuns`, already takes `{windowStart, windowEnd}`, defaults costs from `experience.researchContract.costs`, persists `backtest_runs` + `experience_experiments`, emits `backtest_progress`.
- **IPC + UI:** `backtest.{run,list,get,compare,sweep,listStrategies}` channels in `electron/shared/ipc/channels.ts`, handlers in `electron/main/ipc/operator.ts`, panel `src/hubs/panels/backtest-lab-panel.tsx` (ResearchHub → "lab" tab).
- **Promotion ladder:** `electron/main/services/research/research-experiment-service.ts` + `promotion-gate.ts` (research→backtest→paper→live tiers, contract-hash gated).
- **Strategies registered** in `electron/main/services/strategies/` (definitions in `definitions/`): meanReversion, breakout, trendFollowing, optionsFlow, unusualVolume, crossVenueDislocation, fundingBasis, form4InsiderCluster. Bar-pure ones: mean-reversion, breakout, trend-following, unusual-volume.

**THE gap:** `MarketDataService.getBars({window})` (`electron/main/services/marketdata/market-data-service.ts`) is deliberately DB-only for backtests ("Backtests: DB only, fail-loud on gaps") and the window-miss path never calls a provider. `ohlcv_bars` currently holds **~8 bars per symbol**. Alpaca's `getOhlcv` only fetches most-recent-N (`barLookbackStartIso` + widening multipliers). There is no `{start,end}` historical range fetch anywhere. Ergo: the Lab is wired end-to-end but has nothing to chew on.

No injectable clock exists (~148 direct `Date.now()` calls) — irrelevant for bar-replay (engine iterates bar indices), only matters if someone later wants full-pipeline simulation. Out of scope.

---

## 2. Phase 1 — Make trades happen (ship first, highest pain)

### 2.1 Task 1A: price ATR/absent stops into the pre-trade economics (~1 day)

**Design decision: derive effective stop/target percentages at the risk-gate input builder, NOT a gate bypass.** `evaluateEdgeDecision` (`electron/shared/quant/decision-gate.ts`) is correct and stays untouched; the estimate fed into it was garbage.

**Step 1 — extract ATR to shared quant.**
- New file `electron/shared/quant/atr.ts`: move the private `computeATR` (Wilder ATR-14) verbatim from `electron/main/services/risk/exit-policy-evaluator.ts:131-151`. Suggested shape:
  ```ts
  export type AtrBar = { high: number; low: number; close: number };
  export function computeAtr(bars: AtrBar[], period = 14): number | null { …verbatim body… }
  ```
- `exit-policy-evaluator.ts`: delete the local function, `import { computeAtr } from "@electron/shared/quant/atr"`, call site at line ~94. (Its local minimal `OhlcvBar` type stays; `AtrBar` is structurally compatible.)
- New test `electron/shared/quant/__tests__/atr.test.ts`: <period+1 bars → null; known fixture → known ATR; Wilder smoothing (not simple mean) asserted. Existing `exit-policy-evaluator` tests must stay green (behavior unchanged).

**Step 2 — derivation ladder in `riskGateInputBuilder.build`** (`trade-engine-input-builders.ts`, insert before the `computePreTradeEconomics` call at line ~343). Compute `effectiveStopLossPct`, `effectiveTakeProfitPct`, and a `derivation` tag:

1. `riskConfig.stopLossPct != null` → use as-is. Tag `explicit`. (Current behavior for explicitly-configured sessions must remain byte-identical.)
2. Else if `riskConfig.stopLossType === "trailing_atr" && riskConfig.atrStopMultiplier != null`:
   - Fetch bars using the exact pattern already used in `rules-engine-input-builders.ts:104-119`: `ctx.services.brokerRouting.resolveAdapter(...)` (the risk-gate builder **already resolves the adapter at line 272** — reuse that one, don't resolve twice) → `ctx.services.instrumentNormalizer.toBrokerSymbol({symbol, instrumentClass, brokerType})` → `adapter.getOhlcv?.bind(adapter)` → `resolveRulesOhlcvRequest(ctx.instrument.instrumentMetadataJson)` from `./rules-ohlcv-timeframe` for `{timeframe, barCount}` (ensure barCount ≥ 15 for ATR-14; take `Math.max(barCount, 15)`).
   - Reference price: `state.quoteSnapshot` (patched into state by `candidateValidationInputBuilder`, line 214; shape in `pipeline/analysis/types.ts:48`). Use mid/last as the snapshot exposes; fall back to last bar close.
   - `slPct = atrStopMultiplier * computeAtr(bars) / referencePrice * 100`. Tag `atr_derived`.
   - Wrap the whole rung in try/catch. Any failure (no `getOhlcv`, empty bars, null ATR, bad price) → `logger.warn` with sessionId/cycleId/symbol/rung and **fall through to rung 3**. Never let a data hiccup throw from the derivation itself.
3. Else → `slPct = DEFAULT_STRATEGY_SECTION.stopLossPct` (2 — reuse the existing constant from `electron/shared/domain/session-strategy-config-defaults.ts:19` area; do NOT invent a literal). Tag `default_fallback`.
4. `takeProfitPct == null` → `tpPct = slPct * FALLBACK_REWARD_RISK_RATIO` with `const FALLBACK_REWARD_RISK_RATIO = 1` (named module const).
   **Why 1R:** symmetric reward:risk gives `expectedGrossReturnBps = (2·confidence − 1)·slBps` and `netOdds = 1 → rawKelly = 2p − 1`. It only clears the cost floor when confidence meaningfully beats 0.5 (e.g. 2% stop, confidence 0.6 → +40 gross − 3 cost = +37bps → trades; confidence 0.5187 → +3.7 − 3 ≈ +0.7bps → marginal; coin-flip → negative → still skips). It cannot manufacture asymmetric edge — this is a fix, not a bypass.

Pass `effectiveStopLossPct`/`effectiveTakeProfitPct` into `computePreTradeEconomics` (replace the current `executionProfile.takeProfitPct`/`stopLossPct` args at lines 348–349). Note this also un-zeroes Kelly (`netOdds` line 95) and `uncertaintyBps: slBps` (line 127).

**Step 3 — observability.**
- Bump `modelVersion: "proxy-1"` → `"proxy-2"` (line 120) so old/new estimates are distinguishable in `decision_traces` and calibration buckets.
- Persist the derivation tag + effective percentages in the trace fragment written at lines 356–364 (extend the fragment object; `TradeDecisionTrace` type in `electron/shared/domain` — add optional field, additive only).
- The skip string "Net edge -3bps below floor 0bps" must never again be producible from config shape alone.

**Step 4 — also fix the sibling default.** `executionProfileInputBuilder` passes riskConfig verbatim (lines 244–248) — leave it; the derivation lives in the risk-gate builder only, so there is exactly one place computing effective percentages.

**Tests** (extend `electron/main/services/pipeline/implementations/inputs/__tests__/trade-engine-input-builders.test.ts`):
- **Production-config regression:** riskConfig `{stopLossPct: null, takeProfitPct: null, stopLossType: "trailing_atr", atrStopMultiplier: 2}` + synthetic bars with known ATR + confidence 0.65 → economics has gross > 0, order proceeds. Same at confidence 0.5 → still skips (proves no bypass).
- Explicit `{stopLossPct: 2, takeProfitPct: 4}` → economics identical to current behavior (snapshot the numbers).
- Bars fetch throws → `default_fallback` rung, warn logged, high-confidence trade still proceeds.
- **Composition test (non-negotiable):** drive the real builder chain candidate-validation → execution-profile → risk-gate with real builder objects, faking only adapter (`getOhlcv`, `getMarketSnapshot`) and repos, using the exact ETF-REVERSION riskConfig JSON from §1A. Assert: order emitted, size respects `maxPositionUsd`, trace fragment contains `proxy-2` + derivation tag. This is the seam that was silently broken for weeks.

**Risks:** opens the trade tap for ALL rules sessions at once. Guardrails already exist (`maxPositionUsd`, `maxConcurrentTrades`, `dailyLossLimitUsd`, kill switches) — assert `maxPositionUsd` binds in the composition test. The extra bars fetch adds latency only on the null-stop path and reuses the already-resolved adapter.

### 2.2 Task 1B: EDGAR CIK extraction + UA + drop counters (~0.5 day)

File: `electron/main/services/signals/sources/edgar-signal-source.ts`.

**Step 1 — `extractCik`.** Change signature to accept the entry (`{id, title, link}`), try in order:
1. `id.match(/CIK=(\d+)/i)` — legacy format, keep for compatibility.
2. `link.match(/\/edgar\/data\/(\d+)\//i)` — present in current feed.
3. `title.match(/\((\d{7,10})\)/)` — current format `8-K - Cycurion, Inc. (0001868419) (Filer)`.

Normalize by stripping leading zeros before caching/lookup — `resolveTicker` re-pads with `padStart(10,"0")` (line 238) and the `CikTickerCache` key must stay consistent for both extraction paths.

**Step 2 — User-Agent.** Single module const used by BOTH fetches (feed line ~123, CIK lookup line ~243): `Exva/<app-version> (contact: <email>)` per SEC fair-access policy. Source the email from config/env (e.g. an `EXVA_SEC_CONTACT` env or settings value) with a build-time default; don't hardcode a personal address in source.

**Step 3 — per-gate drop counters.** Currently `dropped: 1480` with zero diagnosability. Count `no_cik | cik_whitelist | no_ticker | too_fresh | item_code`:
- Add optional `dropReasons?: Record<string, number>` to the `PollResult` domain type (find it via `emptyPollResult()` import in the source file; it lives in `electron/shared/domain`).
- Include the breakdown in the `pushActivity` poll summary string (line ~196).
- Persist: additive **nullable `drop_reasons_json` column** on `signal_source_polls` (Drizzle schema `electron/main/db/schema.ts` + small migration via the project's existing drizzle migration flow; `drizzle.config.ts` at repo root). Thread through `persistSourcePoll` (`electron/main/services/signals/persist-source-poll.ts`) and the repo (`signal-source-runtime-repo.ts:129-144`). Do NOT stuff it into `errors_json` — that conflates transport failures with healthy filtering (the exact conflation the 7/20 review outlawed).
- Apply the same counter pattern to `prediction-event-signal-source.ts` while there **only if trivial** (it shares `PollResult`); otherwise leave a TODO — prediction's 2800→59 funnel is mostly legitimate market filtering.

**Step 4 — expected downstream behavior (not a bug):** with config `{}` the source will now emit every ticker-resolvable 8-K (up to 40/poll, 5-min cadence market hours). Session-level gates + AI spend caps (`maxAiSpendUsd`) bound the cost. If day-one spend is too hot, set an `itemCodeWhitelist` (e.g. `["1.01","2.02","7.01","8.01"]`) in the seeded source config — mechanism already exists (`config.itemCodeWhitelist`, line 150).

**Tests** (extend `electron/main/services/signals/sources/__tests__/edgar-signal-source.test.ts`):
- Fixture `<entry>` copied **verbatim from the live 2026 feed shape** (accession-number `<id>`, CIK only in title+href) → signal emitted with correct ticker; the old `CIK=` fixture still passes.
- UA header asserted on both the feed fetch and the CIK-lookup fetch (inspect the fetch mock's headers).
- `dropReasons` totals sum to `dropped`; a no-ticker entry increments `no_ticker`.

**Verification (runtime):** start app during market hours →
```sql
SELECT detected, passed, dropped, drop_reasons_json FROM signal_source_polls
 WHERE source_id='source/edgar_8k' ORDER BY polled_at DESC LIMIT 5;
```
Expect `passed > 0` on the first poll; EDGAR rows appearing in `signal_events` and `session_signal_deliveries`.

---

## 3. Phase 2 — Polymarket reliability + backfill

### 3.1 Task 2A: Polymarket selector (~1 day)

**Fix 1 — candidate block diet** (`electron/main/services/pipeline/engines/input/prediction-market-candidates.ts`):
- Project each Gamma candidate to the minimal fields a discovery scout needs: `{symbol/id, question, outcome, price, liquidity}` (confirm exact field names against the candidate type in that file).
- Cap rows at ~12 and enforce a character budget on the whole block; when truncating, append an explicit `"...N more markets omitted (use list_markets for the full set)"` marker — the worker has the `list_markets` tool for the rest.

**Fix 2 — real-but-safe prompt enforcement** (`electron/main/services/pipeline/prompting/worker-prompt-builder.ts:101-110`):
- Keep the warn, and additionally truncate **only the engine-results/input-engine block** down to budget (never the task, strategy facts, or safety text), logging exactly what was cut and by how many chars. "Tolerant but loud."

**Fix 3 — per-phase timeout** (`electron/main/services/llm/runtime-retry.ts:13`):
- Make `timeoutMs` overridable per call/phase: thread an optional override from `PHASE_DEFAULTS`/`RUNTIME_DEFAULTS.retry` (`electron/shared/ai/ai-phase.ts`) through whatever invokes `runtime-retry` for worker runs. Selector/discovery: 120s. Everything else keeps 60s. Do NOT touch stage floors (`toleratePartialFailure: true, minSuccessfulWorkers: 1` in `selector.phase.ts` stays).

**Fix 4 — zod recovery at the interpreter** (`electron/main/services/pipeline/phases/interpreter.ts`, validation site near line 291):
- If terminal payload fails `candidateOutputSchema` AND the payload is itself a bare array whose elements parse as candidates → wrap as `{candidates: payload}`, `logger.warn`, proceed. Anything else remains a hard worker failure with the rejection reason recorded (current behavior). Expect frequency to drop anyway once Fixes 1–3 land (truncation/timeouts are the likely producers).

**Fix 5 — auth promise cache** (`electron/main/services/broker/adapters/polymarket-adapter.ts:1173-1178`):
```ts
this.authClientPromise ??= this.createAuthedClient().catch((err) => {
  this.authClientPromise = null;   // do not cache rejection forever
  throw err;
});
```

**Tests:** unit — candidate-block budget (row cap, char budget, omission marker); prompt truncation preserves task block; adapter auth retries after a failed handshake (first call rejects, second call re-attempts). Composition — interpreter discovery stage with worker 1 timing out and worker 2 returning a bare candidate array → stage succeeds with recovered candidates.

**Verification:** run the Polymarket session for a day. `jq` the day's log: zero `exceeds RUNTIME_DEFAULTS`, zero `insufficient successful workers`. Session reaches decision phase (`decision_traces` rows for `pm:` symbols). THEN re-examine the `fundamental_failed` drop with fresh traces before assuming it's a separate bug.

### 3.2 Task 2B: historical backfill → Backtest Lab usable (~1 day)

**Step 1 — Alpaca ranged fetch** (`electron/main/services/broker/adapters/alpaca-adapter.ts`):
- New method `getOhlcvRange(wireSymbol, timeframe, {startIso, endIso}): Promise<OhlcvBar[]>`.
- Reuse the existing param builder (`buildAlpacaOhlcvParams`, ~line 98–111) but with explicit `start`+`end`, `sort: "asc"`, `limit: 10000`, and **`next_page_token` paging loop** (Alpaca returns `next_page_token` in the body; keep fetching until null).
- Route stock vs crypto with the existing `isCryptoWireSymbol` helper (slash heuristic on wire symbol) → `/v2/stocks/{sym}/bars` vs `/v1beta3/crypto/us/bars`.
- Optional: add to the `BrokerAdapter` interface as optional method (`getOhlcvRange?:`) in `broker-adapter.ts` so the backfill service can capability-check.

**Step 2 — backfill service.** New `electron/main/services/marketdata/historical-backfill-service.ts`:
- Input: `{symbol, instrumentClass, timeframe, startIso, endIso, brokerAccountId?}`.
- Resolve an Alpaca adapter (broker routing / workspace broker account helpers in `marketdata/workspace-broker-account.ts`); error with typed `AppError` if none supports `getOhlcvRange`.
- Pull month-sized chunks (rate-limit friendly, small delay between chunks), normalize display→wire symbol via `instrumentNormalizer`, write through **`MarketDataService.writeBars`** (`market-data-service.ts:132-200` — upsert on `(symbol,timeframe,ts)` + maintains `data_coverage`). Idempotent by construction; resumable via `data_coverage`/`getCoverage()`.
- Emit `backfill_progress` events on the EventBus (mirror `emitProgress` in `backtest-lab-service.ts:347`): `{symbol, timeframe, chunkStart, chunkEnd, barsWritten, done}`.

**Step 3 — wiring:**
- IPC: `backtest.backfill` + `backtest.coverage` — channel defs in `electron/shared/ipc/channels.ts`, zod-validated handlers in `electron/main/ipc/operator.ts` (follow the existing `backtest.*` handler pattern), preload typings in the `src/lib/exva.ts` / preload api surface (`api.backtestBackfill`, `api.backtestCoverage`).
- UI: `src/hubs/panels/backtest-lab-panel.tsx` — coverage readout for the selected symbol/timeframe (`firstTs`–`lastTs` from `data_coverage`), a "Backfill range" control (symbol/timeframe/date-range + progress via `backfill_progress`), and a warning when the requested run window exceeds coverage.
- CLI: `scripts/backfill-bars.ts` following the `scripts/run-edgar-backtest.ts` pattern — `bun scripts/backfill-bars.ts SPY 1h 2026-01-01 2026-07-01` for headless bulk pulls (SPY/QQQ/AAPL/NVDA/BTC-USD).

**Tests:** backfill service with a fake ranged fetcher — paging joins across chunks, idempotent re-run writes no dupes, `data_coverage` rows correct. **Composition:** synthetic 6-month bars → backfill → `BacktestLabService.run` over the window → folds/Sharpe/`runHash` produced; `rerunFromSpec` hash-stable (extend `electron/main/services/backtest/__tests__/`).

**Verification:** run the CLI for SPY 1h 6 months → `SELECT COUNT(*) FROM ohlcv_bars WHERE symbol='SPY' AND timeframe='1h'` expect thousands; open Backtest Lab tab, run mean-reversion over the window, get fold metrics.

**Risks:** Alpaca free-tier rate limits (chunking + delay + resumability handles it); IEX-vs-SIP data quality — record `provider` in coverage (column exists).

---

## 4. Phase 3 — one new experience, gated on backtest (~1 day; depends on 1A + 2B)

**Pick: `rules-unusual-volume` (stock).** Rationale: strategy already registered and `available` (`electron/main/services/strategies/definitions/unusual-volume.ts` — pure bars, RVOL ≥ 2.5 vs 20-bar baseline, 15m–1d timeframes, needs ~25 bars), shares `DeterministicStrategy` with the replay engine (backtestable TODAY once bars exist), and RVOL spikes on liquid symbols fire multiple times per week — the direct answer to "silent sessions". Funding-basis / cross-venue / form4 are stretch goals (missing venues or a new signal source).

**Gate first, register second:**
1. Backfill ≥6 months of 15m + 1h bars for SPY/QQQ/AAPL/NVDA (Phase 2B outputs).
2. `BacktestLabService.sweep` over `rvolThreshold` (e.g. 2.0–3.5) and the strategy's price-break parameter; walk-forward folds per the engine defaults.
3. Judge against the experience's `researchContract.validation` thresholds using the existing promotion machinery (`research-experiment-service.ts`, `promotion-gate.ts`) — `minOutOfSampleTrades`, `minNetExpectancyUsd`, `minLowerBoundSharpe`, `maxDrawdownPct`, `requiredFolds`.
4. **If it fails validation: STOP. Do not ship the experience. Write the numbers into a short report (docs/reviews/ or the run record) and pick the next candidate.** "Experiences that actually work" means the gate is the point.

**On pass, add the experience (mirror `rules-breakout` end to end):**
- `electron/main/experiences/rules-unusual-volume/descriptor.ts` — id, displayName, `pipelineId` (new `rules-unusual-volume-cycle`), `researchContract` with the **backtested** costs/validation numbers (not copy-pasted aspirations).
- Pipeline descriptor + worker bindings registered alongside the other rules pipelines (grep how `rules-breakout-cycle` registers).
- Input builder `electron/main/services/pipeline/implementations/inputs/rules-unusual-volume-input-builders.ts` — mirror `rules-trend-following-input-builders.ts`; **must pass full OHLCV including volume** (mean-reversion's builder is close-only; unusual-volume needs volume).
- Register in `electron/main/experiences/index.ts` (boot-time `validateExperienceRegistry()` at line ~48 enforces contract shape).
- Catalog seeds: `profile/unusual-volume-default` — scheduled scan, 15m cadence with jitter, `nyse-regular` calendar, SPY/QQQ/AAPL/NVDA — in `electron/main/services/experience-catalog/input-profile-seeds.ts` + `experience-template-seeds.ts`.

**Tests:** experiences/catalog suites (`electron/main/experiences/__tests__/`, `services/experience-catalog/__tests__/`) — registry validation; input-builder unit (volume present in task; 0-bars warn path); composition — session created with `experienceId: "rules-unusual-volume"` auto-provisions the default profile and a first cycle reaches the risk gate under the Phase-1A economics.

**Verification:** create a session from the UI, confirm scheduled scans emit deliveries and ≥1 non-`risk_gate_rejected` decision trace within one market day.

---

## 5. Phase 4 — `docs/prompts/setup-everything.md` rework (docs-only, ~0.5 day)

Current doc mandates a 9-session matrix with **three** EDGAR lanes (roles 1–3, lines ~134–156). Rework:

- **Keep:** `EDGAR-FANOUT-PRIMARY` (the ONLY EDGAR lane), `ETF-REVERSION-PRIMARY`, `ETF-REVERSION-CONTENDER` (inherits the concurrency/shared-account/symbol-contention proof duty — it actually cycles on a schedule instead of waiting on filings), `CRYPTO-BREAKOUT-24X7`, `FUTURES-TREND-4H-LIFECYCLE` (Mock broker), `OPTIONS-FLOW-MULTILEG-LIFECYCLE` (keep sentinel semantics verbatim), `POLYMARKET-DISCOVERY-RESOLUTION`.
- **Cut:** `EDGAR-AI-CONCURRENCY`, `EDGAR-SYMBOL-CONTENTION`. In the legacy rename map (lines ~99–110), map `STRESS-02`/`STRESS-03` to explicit "retire/stop — do not recreate" guidance instead of canonical roles.
- **Add:** `UNUSUAL-VOLUME-PRIMARY` (only after Phase 3 ships; the doc's own rule at Phase-1 item 8 — "if the runtime exposes a new experience … add a new canonical primary role" — makes this consistent).
- **Update:** success-criterion 2's experience enumeration ("all six" → current catalog), the coverage-invariant table (~line 123), the "nine sessions" framing (line ~117), the startup priority ordering in the allocation section (~line 232), and the allocation split accordingly.
- **Leave verbatim:** the entire "Non-negotiable safety boundary" section (lines ~44–56) and the confirm-before-mutate flow.

Verification: dry-read the reworked doc against a live catalog/session listing from the running app — every catalog experience has exactly one primary role; no removed role is referenced anywhere else in the doc (grep the doc for `EDGAR-AI-CONCURRENCY` etc.), and `docs/prompts/stress-test-monitor.md` references still hold.

---

## 6. Sequencing, dependencies, global verification

| Order | Task | Effort | Depends on |
|---|---|---|---|
| 1 | 1A edge gate | ~1 day | — (ship alone, first) |
| 2 | 1B EDGAR | ~0.5 day | — (parallel-safe with 1A) |
| 3 | 2A Polymarket | ~1 day | — |
| 4 | 2B backfill | ~1 day | — |
| 5 | 3 unusual-volume | ~1 day | 2B (backtest gate) + 1A (trades must clear the gate) |
| 6 | 4 doc rework | ~0.5 day | 3 (matrix includes the new lane) |

**Global check after Phases 1–2:** rerun the session matrix for one market day. Success =
1. ≥1 executed paper trade in a rules lane (`trades` table non-empty; `SELECT drop_reason, COUNT(*) FROM session_signal_deliveries GROUP BY 1` shows `risk_gate_rejected` < 100%).
2. EDGAR `signal_source_polls.passed > 0` and EDGAR deliveries exist.
3. Polymarket selector completes discovery without prompt/timeout/validation errors and reaches decision phase.
4. A 6-month SPY backtest runs from the Lab tab with fold metrics and a stable `runHash` on rerun.

**Top risks:**
1. 1A changes gating/sizing for every experience simultaneously → the composition test with the exact production config JSON is non-negotiable; per-session caps are the blast-radius bound.
2. 1B unthrottles ~40 filings/poll into the EDGAR session → AI spend caps bound cost; watch `maxAiSpendUsd` burn day one; `itemCodeWhitelist` is the ready throttle.
3. Backfill rate limits → chunked + resumable via `data_coverage`.
4. Never run action git commands; hand changes back for Ken to commit. Never touch live brokers; everything here is paper-mode.
